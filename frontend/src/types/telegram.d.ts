// Minimal local declaration for the official Telegram WebApp JS API (loaded via the
// <script> tag in index.html — see core.telegram.org/bots/webapps). Only the surface this
// app actually uses; deliberately not a full re-implementation of Telegram's SDK types.

export interface TelegramThemeParams {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
  secondary_bg_color?: string;
}

export interface TelegramWebAppUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { user?: TelegramWebAppUser };
  colorScheme: 'light' | 'dark';
  themeParams: TelegramThemeParams;
  viewportHeight: number;
  viewportStableHeight: number;
  ready(): void;
  expand(): void;
  close(): void;
  // Opens a t.me link (e.g. the native share dialog) inside Telegram. Optional: not every client exposes it.
  openTelegramLink?(url: string): void;
  // Bot API 6.1+ / 6.9+ (hex). Optional: older Telegram clients simply do not expose them.
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  onEvent(eventType: 'themeChanged' | 'viewportChanged', callback: () => void): void;
  offEvent(eventType: 'themeChanged' | 'viewportChanged', callback: () => void): void;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}
