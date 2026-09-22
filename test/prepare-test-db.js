// Runs once before the test suite (wired as the npm "pretest" script) to give repository
// and integration tests a clean, migrated SQLite database, entirely separate from dev.db.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'prisma', 'test.db');
for (const suffix of ['', '-journal', '-wal', '-shm']) {
  const candidate = dbPath + suffix;
  if (fs.existsSync(candidate)) {
    fs.unlinkSync(candidate);
  }
}

const databaseUrl = `file:${dbPath.replace(/\\/g, '/')}`;

execSync('npx prisma migrate deploy', {
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: databaseUrl },
});
