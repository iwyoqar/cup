import { getTelegramWebApp } from '../../lib/telegram/webapp';

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
    <div className="screen">
      <div className="masthead__bar" style={{ margin: '0 calc(var(--gutter) * -1)', padding: '0 var(--gutter)' }}>
        <span className="brand-mark">CUP</span>
      </div>
      <div className="empty empty--block">
        <h1 className="empty__title">Ro'yxatdan o'tish talab qilinadi</h1>
        <p className="hint-text">
          Avval telefon raqamingizni tasdiqlang. Buning uchun botga qayting va /start buyrug'ini yuboring, so'ng
          telefon raqamingizni ulashing.
        </p>
        <button className="button-primary" onClick={handleGoToBot} type="button">
          Telegram botga o'tish
        </button>
      </div>
    </div>
  );
}
