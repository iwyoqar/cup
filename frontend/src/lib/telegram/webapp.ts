import { useEffect, useMemo } from 'react';
import { TelegramThemeParams, TelegramWebApp } from '../../types/telegram';

// Single abstraction point for the Telegram WebApp JS API (Phase 1.7 spec section 31) — no
// component reaches into window.Telegram directly.
export function getTelegramWebApp(): TelegramWebApp | null {
  return window.Telegram?.WebApp ?? null;
}

// Applies Telegram's theme CSS variables to the document root and keeps them in sync if the
// user switches Telegram's theme while the Mini App is open (spec section 9).
export function useTelegramTheme(webApp: TelegramWebApp | null): void {
  useEffect(() => {
    if (!webApp) {
      return;
    }
    const apply = () => {
      applyThemeVars(webApp.themeParams);
      document.documentElement.dataset.tgColorScheme = webApp.colorScheme;
    };
    apply();
    webApp.onEvent('themeChanged', apply);
    return () => webApp.offEvent('themeChanged', apply);
  }, [webApp]);
}

function applyThemeVars(theme: TelegramThemeParams): void {
  const root = document.documentElement.style;
  const map: Record<string, string | undefined> = {
    '--tg-theme-bg-color': theme.bg_color,
    '--tg-theme-text-color': theme.text_color,
    '--tg-theme-hint-color': theme.hint_color,
    '--tg-theme-link-color': theme.link_color,
    '--tg-theme-button-color': theme.button_color,
    '--tg-theme-button-text-color': theme.button_text_color,
    '--tg-theme-secondary-bg-color': theme.secondary_bg_color,
  };
  for (const [name, value] of Object.entries(map)) {
    if (value) {
      root.setProperty(name, value);
    }
  }
}

// Phase 10: the brand surface is always white, so Telegram's own header/background are matched to
// it (otherwise a dark-theme Telegram would frame the white app in a dark bar). The colour is read
// from the rendered page background, so the design token stays the single source of truth.
function brandSurfaceHex(): string | null {
  const channels = getComputedStyle(document.body).backgroundColor.match(/\d+/g);
  if (!channels || channels.length < 3) {
    return null;
  }
  return `#${channels
    .slice(0, 3)
    .map((c) => Number(c).toString(16).padStart(2, '0'))
    .join('')}`;
}

// ready()/expand() must run exactly once, as early as possible (spec section 4 and 31).
export function useTelegramReady(webApp: TelegramWebApp | null): void {
  useEffect(() => {
    if (!webApp) {
      return;
    }
    webApp.ready();
    webApp.expand();
    try {
      const surface = brandSurfaceHex();
      if (surface) {
        webApp.setHeaderColor?.(surface);
        webApp.setBackgroundColor?.(surface);
      }
    } catch {
      // Cosmetic only — never let an unsupported client method affect startup.
    }
  }, [webApp]);
}

export function useTelegramWebApp(): TelegramWebApp | null {
  const webApp = useMemo(() => getTelegramWebApp(), []);
  useTelegramReady(webApp);
  useTelegramTheme(webApp);
  return webApp;
}
