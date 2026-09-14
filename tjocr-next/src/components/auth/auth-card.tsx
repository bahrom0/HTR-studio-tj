'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from '@/components/app-shell';

type AuthMode = 'register' | 'login';

export function AuthCard() {
  const { dictionary: t } = useLocale();
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isRegister = mode === 'register';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/v1/auth/${isRegister ? 'register' : 'login'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          ...(isRegister ? { passwordConfirmation } : {}),
        }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: { messageKey?: string } } | null;
      if (!response.ok) {
        setError(payload?.error?.messageKey || t.auth.genericError);
        return;
      }

      router.replace('/app');
      router.refresh();
    } catch {
      setError(t.auth.networkError);
    } finally {
      setIsSubmitting(false);
    }
  }

  function switchMode() {
    setMode((current) => (current === 'register' ? 'login' : 'register'));
    setError(null);
    setPassword('');
    setPasswordConfirmation('');
  }

  return (
    <section className="auth-card" aria-labelledby="auth-title">
      <div className="auth-card__mark" aria-hidden="true">TJOCR</div>
      <h1 id="auth-title">{isRegister ? t.auth.registerTitle : t.auth.loginTitle}</h1>
      <p className="auth-card__description">{isRegister ? t.auth.registerDescription : t.auth.loginDescription}</p>

      <form className="auth-form" onSubmit={handleSubmit}>
        <label className="auth-field">
          <span>{t.auth.emailLabel}</span>
          <input
            className="auth-input"
            type="email"
            name="email"
            autoComplete="email"
            placeholder={t.auth.emailPlaceholder}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label className="auth-field">
          <span>{t.auth.passwordLabel}</span>
          <input
            className="auth-input"
            type="password"
            name="password"
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {isRegister ? (
          <label className="auth-field">
            <span>{t.auth.passwordConfirmationLabel}</span>
            <input
              className="auth-input"
              type="password"
              name="passwordConfirmation"
              autoComplete="new-password"
              value={passwordConfirmation}
              onChange={(event) => setPasswordConfirmation(event.target.value)}
              required
            />
          </label>
        ) : null}

        {error ? <p className="auth-message auth-message--error" role="alert">{error}</p> : null}

        <button className="button button--primary button--large auth-submit" type="submit" disabled={isSubmitting}>
          {isSubmitting ? t.auth.submitting : isRegister ? t.auth.registerAction : t.auth.loginAction}
          {!isSubmitting ? <ArrowRight aria-hidden="true" size={16} /> : null}
        </button>
      </form>

      <p className="auth-switch">
        {isRegister ? t.auth.haveAccount : t.auth.needAccount}{' '}
        <button type="button" className="auth-switch__button" onClick={switchMode}>
          {isRegister ? t.auth.loginLink : t.auth.registerLink}
        </button>
      </p>
      <Link className="auth-guest-link" href="/app">
        {t.auth.continueAsGuest}
      </Link>
    </section>
  );
}
