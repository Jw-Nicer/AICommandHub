'use client';

import { useState } from 'react';
import { signInWithEmail, signUpWithEmail, signInWithMagicLink } from '@/lib/firebase';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup' | 'magic'>('signin');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
      if (mode === 'magic') {
        const result = await signInWithMagicLink(email);
        if (result.error) throw result.error;
        setMessage('Check your email for the sign-in link.');
      } else if (mode === 'signup') {
        const result = await signUpWithEmail(email, password);
        if (result.error) throw result.error;
      } else {
        const result = await signInWithEmail(email, password);
        if (result.error) throw result.error;
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    }

    setLoading(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-bg-primary">
      <div className="w-full max-w-sm">
        <h1 className="text-[24px] font-bold text-text-primary text-center mb-2">POCP</h1>
        <p className="text-[14px] text-text-secondary text-center mb-8">
          Parallel Operations Control Plane
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full px-4 py-3 rounded-lg bg-bg-secondary text-text-primary text-[15px] border border-bg-secondary outline-none focus:border-modify"
          />

          {mode !== 'magic' && (
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full px-4 py-3 rounded-lg bg-bg-secondary text-text-primary text-[15px] border border-bg-secondary outline-none focus:border-modify"
            />
          )}

          {error && (
            <p className="text-[13px] text-reject">{error}</p>
          )}
          {message && (
            <p className="text-[13px] text-approve">{message}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-lg bg-modify text-white text-[15px] font-medium disabled:opacity-50"
          >
            {loading ? 'Loading...' : mode === 'signup' ? 'Sign Up' : mode === 'magic' ? 'Send Magic Link' : 'Sign In'}
          </button>
        </form>

        <div className="mt-6 flex flex-col items-center gap-2 text-[13px]">
          {mode === 'signin' && (
            <>
              <button onClick={() => setMode('signup')} className="text-modify">
                Create an account
              </button>
              <button onClick={() => setMode('magic')} className="text-text-secondary">
                Sign in with magic link
              </button>
            </>
          )}
          {mode === 'signup' && (
            <button onClick={() => setMode('signin')} className="text-modify">
              Already have an account? Sign in
            </button>
          )}
          {mode === 'magic' && (
            <button onClick={() => setMode('signin')} className="text-modify">
              Sign in with password
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
