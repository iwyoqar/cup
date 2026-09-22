import { ApiError } from './client';

// Never surfaces a raw backend exception string to the user (Phase 1.7 spec section 36) —
// this maps status + a few known backend messages to friendly Uzbek text. Falls back to a
// generic per-status message for anything not specifically recognized.
export function toUserMessage(err: unknown): string {
  if (!(err instanceof ApiError)) {
    return "Kutilmagan xatolik yuz berdi. Qayta urinib ko'ring.";
  }

  if (err.status === 0) {
    return "Server bilan bog'lanib bo'lmadi. Internet aloqangizni tekshiring.";
  }

  const knownByFragment: Array<[string, string]> = [
    ['contains items from another branch', 'Avvalgi filial savatchangizda mahsulotlar bor.'],
    ['not currently available', 'Bu mahsulot hozircha mavjud emas.'],
    ['not currently active', 'Bu filial hozircha faol emas.'],
    ['Branch not found', 'Filial topilmadi.'],
    ['Product not found', 'Mahsulot topilmadi.'],
    ['Cart item not found', "Savatchada bunday mahsulot topilmadi."],
    ['Select a branch', "Avval filialni tanlang."],
    ['cart has expired', "Savatchangiz muddati tugagan. Mahsulotlarni qayta ko'rib chiqing."],
  ];
  for (const [fragment, message] of knownByFragment) {
    if (err.backendMessage.toLowerCase().includes(fragment.toLowerCase())) {
      return message;
    }
  }

  switch (err.status) {
    case 400:
      return "So'rov noto'g'ri yuborildi.";
    case 401:
      return 'Sessiya muddati tugagan. Ilovani qayta oching.';
    case 403:
      return 'Bu amalni bajarish uchun ruxsat yo\'q.';
    case 404:
      return 'Topilmadi.';
    case 409:
      return "Bu amalni bajarib bo'lmadi. Qayta urinib ko'ring.";
    case 422:
      return "Yuborilgan ma'lumotlar noto'g'ri.";
    default:
      return "Server xatoligi. Birozdan so'ng qayta urinib ko'ring.";
  }
}
