import { LifecycleState } from './staffApi';

// CUP's canonical money unit is whole UZS (see backend src/modules/poster/poster-money.ts) — no conversion.
export function formatSom(amount: number): string {
  return `${amount.toLocaleString('ru-RU')} so'm`;
}

export const formatNumber = (n: number): string => n.toLocaleString('ru-RU');

const MONTHS = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyun', 'Iyul', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek'];

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate().toString().padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate().toString().padStart(2, '0')} ${MONTHS[d.getMonth()]}, ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

export const formatBirthday = (b: { month: number; day: number }): string => `${b.day} ${MONTHS[b.month - 1]}`;

export function daysAgo(days: number | null): string {
  if (days === null) return '—';
  if (days === 0) return 'Bugun';
  if (days === 1) return 'Kecha';
  return `${days} kun oldin`;
}

// Same neutral labels the customer app uses (no invented pickup/readiness meaning).
const STATUS_LABELS: Record<string, string> = {
  pending: 'Qabul qilinmoqda',
  sent_to_poster: 'Yuborildi',
  accepted: 'Qabul qilindi',
  preparing: 'Yangilanmoqda',
  ready: 'Yangilanmoqda',
  completed: 'Yakunlandi',
  cancelled: 'Bekor qilindi',
  failed: 'Amalga oshmadi',
  uncertain: 'Tekshirilmoqda',
};

export function statusLabel(status: string | null): string {
  return status ? (STATUS_LABELS[status] ?? 'Yangilanmoqda') : '';
}

export const LIFECYCLE_LABELS: Record<LifecycleState, string> = {
  NEW: 'Yangi',
  ACTIVE: 'Faol',
  LOYAL: 'Sodiq',
  AT_RISK: 'Xavf ostida',
  DORMANT: 'Uxlab qolgan',
  CHURNED: 'Yo‘qotilgan',
};

export const SIGNAL_LABELS: Record<string, string> = {
  FIRST_PURCHASE: 'Birinchi xarid',
  SECOND_PURCHASE: 'Ikkinchi xarid',
  HIGH_VALUE_CUSTOMER: 'Yuqori qiymatli mijoz',
  RISING_CUSTOMER: 'O‘sayotgan mijoz',
  AT_RISK: 'Xavf ostida',
  DORMANT: 'Uxlab qolgan',
  CHURNED: 'Yo‘qotilgan',
  REWARD_AVAILABLE: 'Bonus mavjud',
  REFERRAL_SUCCESS: 'Muvaffaqiyatli taklif',
  LOYALTY_LEVEL_UP: 'Yangi daraja',
  BIRTHDAY_UPCOMING: 'Tug‘ilgan kun yaqin',
};

export const OPPORTUNITY_LABELS: Record<string, string> = {
  WIN_BACK: 'Qaytarish',
  SECOND_PURCHASE: 'Ikkinchi xarid',
  REWARD_REDEMPTION: 'Bonusni ishlatish',
  VIP_RETENTION: 'VIP mijozni saqlash',
  REFERRAL: 'Do‘st taklif qilish',
  BIRTHDAY: 'Tug‘ilgan kun',
  LOYALTY_UPGRADE: 'Daraja oshirish',
};

export const PRIORITY_LABELS: Record<string, string> = { HIGH: 'Yuqori', MEDIUM: 'O‘rta', LOW: 'Past' };

export const REFERRAL_STATUS_LABELS: Record<string, string> = {
  ATTRIBUTED: 'Taklif orqali kelgan',
  REGISTERED: 'Ro‘yxatdan o‘tgan',
  QUALIFIED: 'Birinchi xaridni qilgan',
  REWARDED: 'Bonus berilgan',
  EXPIRED: 'Muddati tugagan',
  REJECTED: 'Rad etilgan',
  INVALID: 'Yaroqsiz',
};

export function benefitText(b: { type: string; value: number | null; product: { name: string } | null; quantity: number | null }): string {
  switch (b.type) {
    case 'PERCENT_DISCOUNT':
      return `${b.value}% chegirma`;
    case 'FIXED_DISCOUNT':
      return `${formatSom(b.value ?? 0)} chegirma`;
    case 'FREE_PRODUCT':
      return `Bepul ${b.product?.name ?? 'mahsulot'} × ${b.quantity ?? 1}`;
    case 'LOYALTY_POINTS':
      return `+${formatNumber(b.value ?? 0)} ball`;
    default:
      return '';
  }
}
