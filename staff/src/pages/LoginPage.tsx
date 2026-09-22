import { FormEvent, useState } from 'react';
import { ApiError, storeToken, toUserMessage } from '../lib/api';
import { staffLogin, StaffProfile } from '../lib/staffApi';

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
    <main className="login">
      <div className="brand">CUP</div>
      <h1 className="login__title">Barista paneli</h1>
      <form className="login__form" onSubmit={submit}>
        <label className="field">
          <span>Foydalanuvchi nomi</span>
          <input autoCapitalize="none" autoComplete="username" autoCorrect="off" onChange={(e) => setIdentifier(e.target.value)} value={identifier} />
        </label>
        <label className="field">
          <span>Parol</span>
          <input autoComplete="current-password" onChange={(e) => setPassword(e.target.value)} type="password" value={password} />
        </label>
        {error && <p className="error-text">{error}</p>}
        <button className="button button--primary" disabled={busy || !identifier || !password} type="submit">
          {busy ? 'Kirilmoqda...' : 'Kirish'}
        </button>
      </form>
    </main>
  );
}
