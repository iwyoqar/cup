import { useState } from 'react';
import { login } from '../lib/adminAuth';
import { storeToken, ApiError } from '../lib/api';
import { AdminProfile } from '../lib/types';
import { Button } from '../ui';

interface LoginPageProps {
  onLoggedIn: (admin: AdminProfile) => void;
}

export function LoginPage({ onLoggedIn }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const session = await login(email, password);
      storeToken(session.sessionToken);
      onLoggedIn(session.admin);
    } catch (err) {
      setError(err instanceof ApiError ? err.backendMessage : 'Login failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-black bg-[radial-gradient(60rem_30rem_at_50%_-10%,color-mix(in_srgb,var(--color-terracotta)_18%,transparent),transparent)] px-4 py-6">
      <form className="flex w-full max-w-[400px] animate-dialog-in flex-col gap-4 rounded-xl bg-white px-6 py-8 shadow-pop" onSubmit={handleSubmit}>
        <div className="mb-0.5 pl-[0.32em] text-center font-display text-[26px] tracking-[0.32em]">CUP</div>
        <h1 className="text-center font-display text-[26px] leading-tight font-medium">Admin sign in</h1>
        <p className="text-center text-[13px] leading-snug text-muted">Manage customers, loyalty, campaigns and the Poster connection.</p>
        <div className="flex flex-col gap-1.5 [&>label]:text-xs [&>label]:font-semibold [&>label]:text-muted">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
          />
        </div>
        <div className="flex flex-col gap-1.5 [&>label]:text-xs [&>label]:font-semibold [&>label]:text-muted">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        {error && <p className="text-[13px] font-semibold text-err" role="alert">{error}</p>}
        <Button className="w-full" disabled={isSubmitting} type="submit" variant="primary">
          {isSubmitting ? 'Signing in...' : 'Sign in'}
        </Button>
      </form>
    </div>
  );
}
