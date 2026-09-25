import { FormEvent, useState } from 'react';
import { ApiError, storeToken, toUserMessage } from '../lib/api';
import { staffLogin, StaffProfile } from '../lib/staffApi';
import { Button } from '../components/ui';

export function LoginPage({ onLoggedIn }: { onLoggedIn: (staff: StaffProfile) => void }) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await staffLogin(identifier, password);
      storeToken(session.sessionToken);
      onLoggedIn(session.staff);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? "Foydalanuvchi nomi yoki parol noto'g'ri." : toUserMessage(err));
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-[420px] flex-col gap-4 px-5 py-12">
      <div className="font-display text-[32px] font-semibold tracking-[0.32em] whitespace-nowrap">CUP</div>
      <h1 className="font-display text-[32px] font-medium">Barista paneli</h1>
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <label className="flex flex-col gap-1.5 text-[14px] font-semibold">
          <span>Foydalanuvchi nomi</span>
          <input autoCapitalize="none" autoComplete="username" autoCorrect="off" onChange={(e) => setIdentifier(e.target.value)} value={identifier} />
        </label>
        <label className="flex flex-col gap-1.5 text-[14px] font-semibold">
          <span>Parol</span>
          <input autoComplete="current-password" onChange={(e) => setPassword(e.target.value)} type="password" value={password} />
        </label>
        {error && <p className="text-[14px] font-semibold text-terracotta-deep">{error}</p>}
        <Button disabled={busy || !identifier || !password} type="submit" variant="primary">
          {busy ? 'Kirilmoqda...' : 'Kirish'}
        </Button>
      </form>
    </main>
  );
}
