// Centralized so wording stays consistent and easy to review/change in one place. Kept as
// plain constants — no i18n framework, since Phase 1.6 is Uzbek-only by explicit instruction.

export const SHARE_PHONE_BUTTON_TEXT = '📱 Telefon raqamimni yuborish';
export const OPEN_MINI_APP_BUTTON_TEXT = "☕ CUP Coffee'ni ochish";
// Phase 1.9: distinct label from the greeting's Mini App button — this one appears on an order
// status notification, not a greeting, so it reads as "go look at THIS order" (spec section 26).
export const VIEW_ORDER_BUTTON_TEXT = "Buyurtmani ko'rish";

export const PHONE_REQUEST_MESSAGE = "Ro'yxatdan o'tish uchun telefon raqamingizni yuboring.";
export const WRONG_CONTACT_MESSAGE = "Iltimos, o'zingizning telefon raqamingizni yuboring.";
export const GENERIC_ERROR_MESSAGE = "Ro'yxatdan o'tishda xatolik yuz berdi. Iltimos, qaytadan urinib ko'ring.";
export const REGISTRATION_COMPLETE_MESSAGE = "Rahmat! Ro'yxatdan o'tish yakunlandi.";
export const WELCOME_BACK_MESSAGE = 'Xush kelibsiz!';
export const HELP_MESSAGE = "CUP Coffee botiga xush kelibsiz. Ro'yxatdan o'tish uchun /start buyrug'ini yuboring.";
export const MINI_APP_NOT_CONFIGURED_MESSAGE =
  "Ro'yxatdan o'tish muvaffaqiyatli yakunlandi. Ilova hozircha sozlanmagan — tez orada ishga tushadi.";
