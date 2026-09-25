import { useCallback, useEffect, useState } from 'react';
import { useTelegramWebApp, getTelegramWebApp } from '../lib/telegram/webapp';
import { authenticateWithTelegram } from '../lib/api/auth';
import { fetchBranches } from '../lib/api/branches';
import { fetchCart, setCartBranch, clearCart as clearCartRequest } from '../lib/api/cart';
import { setToken, setReauthenticator, ApiError } from '../lib/api/client';
import { toUserMessage } from '../lib/api/errors';
import { Branch, CartView as CartViewModel } from '../types/api';
import { StatusScreen } from './StatusScreen';
import { RegistrationRequired } from '../features/auth/RegistrationRequired';
import { BranchSelect } from '../features/branches/BranchSelect';
import { CatalogView } from '../features/catalog/CatalogView';
import { CartView } from '../features/cart/CartView';
import { CheckoutFlow } from '../features/checkout/CheckoutFlow';
import { OrderStatusView } from '../features/orders/OrderStatusView';
import { AccountView } from '../features/account/AccountView';
import { useCartSync } from '../features/cart/useCartSync';
import { refreshCatalogIfStale } from '../lib/catalog/catalogCache';
import { buttonPrimary } from './buttonStyles';
import { cx } from '../lib/cx';

// Phase 1.7 spec section 11/12 state machine. "ready" is split further into a `view` (catalog/
// cart/checkout/order/account) since the customer moves between those without re-running auth/
// branch resolution — see section 40's minimal nav (Catalog, Cart), extended by Phase 1.8 with
// checkout/order status, and Phase 2 with the account/order-history screen. The SAME
// OrderStatusView is reused for both "just checked out" and "opened from order history" — it
// always just fetches+polls by orderId, so which entry point reached it doesn't matter.
type Phase = 'booting' | 'authenticating' | 'registration_required' | 'branch_selection' | 'ready' | 'error';
type View = 'catalog' | 'cart' | 'checkout' | 'order' | 'account';

export function AppShell() {
  const webApp = useTelegramWebApp();
  const [phase, setPhase] = useState<Phase>('booting');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Phase 9: the cart the UI shows is the confirmed server cart with the customer's not-yet-confirmed
  // taps laid over it (see features/cart/cartSync.ts). Everything that used to call setCart with a
  // backend response now calls setServerCart with it — same data, same authority.
  const { sync: cartSync, state: cartState } = useCartSync();
  const cart = cartState.cart;
  const setCart = cartSync.setServerCart;
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [isSwitchingBranch, setIsSwitchingBranch] = useState(false);
  const [branchActionError, setBranchActionError] = useState<string | null>(null);
  const [branchActionBusy, setBranchActionBusy] = useState(false);
  const [pendingBranchConflict, setPendingBranchConflict] = useState<Branch | null>(null);
  const [view, setView] = useState<View>('catalog');
  const [orderId, setOrderId] = useState<string | null>(null);

  const proceedFromCart = useCallback(async (loadedCart: CartViewModel) => {
    if (loadedCart.branch) {
      setCart(loadedCart);
      setPhase('ready');
      setView('catalog');
      return;
    }

    const activeBranches = (await fetchBranches()).filter((b) => b.isActive);
    setBranches(activeBranches);

    if (activeBranches.length === 1) {
      const onlyBranch = activeBranches[0];
      const updatedCart = await setCartBranch(onlyBranch.id);
      setCart(updatedCart);
      setPhase('ready');
      setView('catalog');
      return;
    }

    setCart(loadedCart);
    setIsSwitchingBranch(false);
    setPhase('branch_selection');
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      // The menu is public and independent of the session, so it is fetched in parallel with auth
      // instead of after auth -> me -> cart. Failure here is not fatal: CatalogView retries/reports.
      refreshCatalogIfStale()?.catch(() => undefined);

      const initData = webApp?.initData;
      if (!webApp || !initData) {
        // Not launched inside Telegram (or Telegram hasn't attached initData yet) — nothing
        // this app can authenticate against. See spec section 30: never fall back to
        // initDataUnsafe as a substitute for the real signed initData.
        if (webApp) {
          setPhase('error');
          setErrorMessage('Ilovani Telegram orqali qayta oching.');
        }
        return;
      }

      setPhase('authenticating');
      try {
        const session = await authenticateWithTelegram(initData);
        if (cancelled) return;
        setToken(session.sessionToken);
        setReauthenticator(async () => {
          const refreshed = await authenticateWithTelegram(initData);
          return refreshed.sessionToken;
        });

        // POST /auth/telegram already returns the same public profile GET /auth/me would (both are
        // PublicCustomerProfile of the verified customer), so the extra round trip is redundant.
        if (!session.customer.phone) {
          setPhase('registration_required');
          return;
        }

        const loadedCart = await fetchCart();
        if (cancelled) return;
        await proceedFromCart(loadedCart);
      } catch (err) {
        if (cancelled) return;
        setPhase('error');
        setErrorMessage(toUserMessage(err));
      }
    }

    boot();
    return () => {
      cancelled = true;
    };
    // webApp is stable for the lifetime of the app (see useTelegramWebApp) — this effect is
    // meant to run exactly once per real launch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webApp]);

  const handleSelectBranch = async (branch: Branch) => {
    setBranchActionBusy(true);
    setBranchActionError(null);
    try {
      const updatedCart = await setCartBranch(branch.id);
      setCart(updatedCart);
      setPendingBranchConflict(null);
      setPhase('ready');
      setView('catalog');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.backendMessage.includes('another branch')) {
        // Spec section 15: never silently clear or move cart items — surface the conflict and
        // let the customer explicitly choose to clear before switching.
        setPendingBranchConflict(branch);
        setBranchActionError(toUserMessage(err));
      } else {
        setBranchActionError(toUserMessage(err));
      }
    } finally {
      setBranchActionBusy(false);
    }
  };

  const handleConfirmClearAndSwitch = async () => {
    if (!pendingBranchConflict) return;
    setBranchActionBusy(true);
    setBranchActionError(null);
    try {
      await clearCartRequest();
      const updatedCart = await setCartBranch(pendingBranchConflict.id);
      setCart(updatedCart);
      setPendingBranchConflict(null);
      setPhase('ready');
      setView('catalog');
    } catch (err) {
      setBranchActionError(toUserMessage(err));
    } finally {
      setBranchActionBusy(false);
    }
  };

  // Spec section 10: the backend is authoritative for cart state after checkout — this
  // re-fetches rather than manually clearing the locally-held cart, so CatalogView/CartBar
  // reflect exactly what the backend actually cleared (only the items that were part of THIS
  // checkout, per CartService's replay-safe cleanup).
  const handleOrderCreated = async (createdOrderId: string) => {
    setOrderId(createdOrderId);
    setView('order');
    try {
      setCart(await fetchCart());
    } catch {
      // Non-fatal: the order screen doesn't depend on cart state, and the next catalog/cart
      // visit will naturally re-fetch it too.
    }
  };

  const handleOpenBranchSwitcher = async () => {
    setBranchActionError(null);
    setPendingBranchConflict(null);
    setIsSwitchingBranch(true);
    setPhase('branch_selection');
    if (!branches) {
      try {
        setBranches((await fetchBranches()).filter((b) => b.isActive));
      } catch (err) {
        setBranchActionError(toUserMessage(err));
      }
    }
  };

  if (phase === 'booting' || phase === 'authenticating') {
    return (
      <div className="mx-auto flex min-h-dvh max-w-[560px] flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        <StatusScreen title="CUP Coffee" message="Tayyorlanmoqda..." isLoading />
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="mx-auto flex min-h-dvh max-w-[560px] flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        <StatusScreen
          title="Xatolik"
          message={errorMessage ?? "Noma'lum xatolik yuz berdi."}
          actionLabel={webApp ? 'Yopish' : undefined}
          onAction={webApp ? () => getTelegramWebApp()?.close() : undefined}
        />
      </div>
    );
  }

  if (phase === 'registration_required') {
    return (
      <div className="mx-auto flex min-h-dvh max-w-[560px] flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        <RegistrationRequired />
      </div>
    );
  }

  if (phase === 'branch_selection') {
    return (
      <div className="mx-auto flex min-h-dvh max-w-[560px] flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        {pendingBranchConflict ? (
          <div className="flex flex-1 flex-col gap-6 px-4 pt-3 pb-8">
            <div className="-mx-4 flex min-h-11 items-center gap-2 px-4">
              <button className="min-h-11 cursor-pointer py-2.5 text-small font-semibold tracking-[0.02em] text-black" onClick={() => setPendingBranchConflict(null)} type="button">
                ← Orqaga
              </button>
            </div>
            <h1 className="font-display text-display leading-[1.08] font-medium tracking-[-0.01em]">Filialni almashtirish</h1>
            <p className="text-small leading-[1.45] text-muted">{branchActionError}</p>
            <button className={cx(buttonPrimary, 'w-full')} disabled={branchActionBusy} onClick={handleConfirmClearAndSwitch} type="button">
              Savatni tozalab, filialni almashtirish
            </button>
          </div>
        ) : (
          <BranchSelect
            branches={branches ?? []}
            isSubmitting={branchActionBusy}
            onSelect={handleSelectBranch}
            onCancel={isSwitchingBranch && cart?.branch ? () => { setPhase('ready'); setView('catalog'); } : undefined}
          />
        )}
      </div>
    );
  }

  if (phase === 'ready' && cart) {
    if (view === 'order' && orderId) {
      return (
        <OrderStatusView
          orderId={orderId}
          onBackToMenu={() => {
            setOrderId(null);
            setView('catalog');
          }}
        />
      );
    }
    if (view === 'checkout') {
      return (
        <div className="mx-auto flex min-h-dvh max-w-[560px] flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
          <CheckoutFlow
            cart={cart}
            onCartUpdated={setCart}
            onOrderCreated={handleOrderCreated}
            onCancel={() => setView('cart')}
          />
        </div>
      );
    }
    if (view === 'cart') {
      return (
        <div className="mx-auto flex min-h-dvh max-w-[560px] flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
          <CartView
            cart={cart}
            sync={cartSync}
            isSyncing={cartState.isSyncing}
            syncError={cartState.error}
            onBack={() => setView('catalog')}
            onCheckout={() => setView('checkout')}
          />
        </div>
      );
    }
    if (view === 'account') {
      return (
        <AccountView
          onOpenOrder={(historicalOrderId) => {
            setOrderId(historicalOrderId);
            setView('order');
          }}
          onBack={() => setView('catalog')}
        />
      );
    }
    return (
      <CatalogView
        branchName={cart.branch?.name ?? ''}
        cart={cart}
        sync={cartSync}
        syncError={cartState.error}
        onOpenCart={() => setView('cart')}
        onChangeBranch={handleOpenBranchSwitcher}
        onOpenAccount={() => setView('account')}
      />
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-[560px] flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <StatusScreen title="CUP Coffee" message="Tayyorlanmoqda..." isLoading />
    </div>
  );
}
