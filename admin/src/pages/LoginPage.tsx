import { useState } from 'react';
import { login } from '../lib/adminAuth';
import { storeToken, ApiError } from '../lib/api';
import { AdminProfile } from '../lib/types';

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
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-card__mark">CUP</div>
        <h1>Admin sign in</h1>
        <p className="hint-text">Manage customers, loyalty, campaigns and the Poster connection.</p>
        <div className="field">
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
        <div className="field">
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
        {error && <p className="error-text" role="alert">{error}</p>}
        <button className="button-primary" disabled={isSubmitting} type="submit">
          {isSubmitting ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
