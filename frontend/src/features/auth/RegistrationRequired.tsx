import { getTelegramWebApp } from '../../lib/telegram/webapp';
import { buttonPrimary } from '../../app/buttonStyles';
import { cx } from '../../lib/cx';

// Phase 1.6 established that Customer.phone == null means registration is incomplete, and the
// ONLY authoritative way to register is the Telegram Bot's native contact-share flow — this
// screen deliberately does not invent an in-app phone form (spec section 6). Closing the Mini
// App returns the user to the bot chat it was launched from, where /start starts that flow.
export function RegistrationRequired() {
  const handleGoToBot = () => {
    const webApp = getTelegramWebApp();
    if (webApp) {
      webApp.close();
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 pt-3 pb-8">
      <div className="-mx-4 flex min-h-11 items-center justify-between px-4">
        <span className="font-display text-[20px] font-semibold tracking-[0.32em] after:ml-1 after:inline-block after:size-1.5 after:rounded-full after:bg-terracotta after:content-['']">CUP</span>
      </div>
      <div className="flex flex-col items-start gap-3 rounded-lg bg-cream px-6 py-8">
        <h1 className="font-display text-title leading-[1.1] font-medium">Ro'yxatdan o'tish talab qilinadi</h1>
        <p className="text-small leading-[1.45] text-muted-cream">
          Avval telefon raqamingizni tasdiqlang. Buning uchun botga qayting va /start buyrug'ini yuboring, so'ng
          telefon raqamingizni ulashing.
        </p>
        <button className={cx(buttonPrimary, 'mt-2 w-auto')} onClick={handleGoToBot} type="button">
          Telegram botga o'tish
        </button>
      </div>
    </div>
  );
}
