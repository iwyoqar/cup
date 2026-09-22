import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

// Creates one repeatable test customer so POST /orders has a valid customerId to reference
// without building authentication/registration, which is out of scope for Phase 0.
const TEST_CUSTOMER_ID = 'test-customer-phase0';

async function main() {
  const prisma = new PrismaClient();
  try {
    const customer = await prisma.customer.upsert({
      where: { id: TEST_CUSTOMER_ID },
      create: { id: TEST_CUSTOMER_ID, displayName: 'Phase 0 Test Customer' },
      update: {},
    });
    // eslint-disable-next-line no-console
    console.log(`Seeded test customer: ${customer.id}`);

    // Phase 3: idempotently bootstrap the first Admin row from env vars, only when both are
    // provided. `update: {}` is deliberate — re-running seed must never reset an existing
    // admin's password. Never logs the password itself, only the email.
    const bootstrapEmail = process.env.ADMIN_BOOTSTRAP_EMAIL;
    const bootstrapPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD;
    if (bootstrapEmail && bootstrapPassword) {
      const passwordHash = await bcrypt.hash(bootstrapPassword, 10);
      const admin = await prisma.admin.upsert({
        where: { email: bootstrapEmail },
        create: { email: bootstrapEmail, passwordHash, role: 'SUPER_ADMIN' },
        update: {},
      });
      // eslint-disable-next-line no-console
      console.log(`Seeded admin: ${admin.email} (password unchanged if this admin already existed)`);
    } else {
      // eslint-disable-next-line no-console
      console.log('ADMIN_BOOTSTRAP_EMAIL/ADMIN_BOOTSTRAP_PASSWORD not set — skipping admin bootstrap.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
