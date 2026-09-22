// Admin.role values that count as a full administrator (the seeded owner account is SUPER_ADMIN; the
// schema default is ADMIN). Anything else stored in Admin.role gets NO staff-panel or staff-management
// access — an unknown role fails closed.
export const ADMIN_ROLES: readonly string[] = ['ADMIN', 'SUPER_ADMIN'];

export function isAdminRole(role: string | null | undefined): boolean {
  return !!role && ADMIN_ROLES.includes(role);
}
