import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

// Companion to seed.ts's admin bootstrap, which deliberately never overwrites an existing
// admin's password (`update: {}`). This is the explicit escape hatch for when that password
// needs to change on purpose — e.g. ADMIN_BOOTSTRAP_PASSWORD was rotated after the admin row
// already existed, so seed.ts alone can no longer apply it. Never logs the password itself.
async function main() {
  const prisma = new PrismaClient();
  try {
    const email = process.env.ADMIN_BOOTSTRAP_EMAIL;
    const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
    if (!email || !password) {
      throw new Error('ADMIN_BOOTSTRAP_EMAIL/ADMIN_BOOTSTRAP_PASSWORD must both be set.');
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const admin = await prisma.admin.upsert({
      where: { email },
      create: { email, passwordHash, role: 'SUPER_ADMIN' },
      update: { passwordHash, isActive: true },
    });
    // eslint-disable-next-line no-console
    console.log(`Password reset for: ${admin.email}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
