'use client';

import Link from 'next/link';
import { Moon, Sun } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { dictionaries, type Dictionary, type Locale } from '@/i18n';

type Theme = 'light' | 'dark';

type LocaleContextValue = {
  locale: Locale;
  dictionary: Dictionary;
  theme: Theme;
  setLocale: (locale: Locale) => void;
  toggleTheme: () => void;
};

function readPreference(key: string) {
  const cookie = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(`${key}=`))
    ?.slice(key.length + 1);

  if (cookie) return decodeURIComponent(cookie);

  try {
    return window.localStorage?.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function writePreference(key: string, value: string) {
  document.cookie = `${key}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax`;

  try {
    window.localStorage?.setItem(key, value);
  } catch {
    // Some privacy modes disable localStorage; the cookie remains sufficient.
  }
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [locale, setLocaleState] = useState<Locale>('ru');
  const [theme, setTheme] = useState<Theme>('light');
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    const storedLocale = readPreference('tjocr-locale');
    const storedTheme = readPreference('tjocr-theme');

    if (storedLocale === 'ru' || storedLocale === 'tg') setLocaleState(storedLocale);
    if (storedTheme === 'light' || storedTheme === 'dark') setTheme(storedTheme);
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!isHydrated) return;

    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.lang = locale;
    writePreference('tjocr-theme', theme);
    writePreference('tjocr-locale', locale);
  }, [isHydrated, locale, theme]);

  const value = useMemo(
    () => ({
      locale,
      dictionary: dictionaries[locale],
      theme,
      setLocale: (nextLocale: Locale) => setLocaleState(nextLocale),
      toggleTheme: () => setTheme((current) => (current === 'dark' ? 'light' : 'dark')),
    }),
    [locale, theme],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const value = useContext(LocaleContext);
  if (!value) throw new Error('useLocale must be used inside LocaleProvider');
  return value;
}

function Brand() {
  const { dictionary: t } = useLocale();

  return (
    <Link className="brand" href="/" aria-label={t.common.brandLabel}>
      <span className="brand-word">TJOCR</span>
    </Link>
  );
}

function LocaleAndThemeControls() {
  const { locale, theme, dictionary: t, setLocale, toggleTheme } = useLocale();

  return (
    <div className="header-tools">
      <div className="locale-switch" role="group" aria-label={t.common.language}>
        <button
          type="button"
          className={locale === 'ru' ? 'locale-button locale-button--active' : 'locale-button'}
          aria-pressed={locale === 'ru'}
          onClick={() => setLocale('ru')}
        >
          RU
        </button>
        <button
          type="button"
          className={locale === 'tg' ? 'locale-button locale-button--active' : 'locale-button'}
          aria-pressed={locale === 'tg'}
          onClick={() => setLocale('tg')}
        >
          TG
        </button>
      </div>
      <button
        type="button"
        className="theme-button"
        onClick={toggleTheme}
        aria-label={theme === 'dark' ? t.common.lightTheme : t.common.darkTheme}
        title={theme === 'dark' ? t.common.lightTheme : t.common.darkTheme}
      >
        {theme === 'dark' ? <Sun aria-hidden="true" size={16} /> : <Moon aria-hidden="true" size={16} />}
      </button>
    </div>
  );
}

export function AppShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const { dictionary: t } = useLocale();
  const isLanding = pathname === '/';

  return (
    <>
      <a className="skip-link" href="#main-content">
        {t.common.skipToContent}
      </a>
      <header className="site-header">
        <div className="site-header__inner">
          <Brand />
          <nav className="site-nav" aria-label={t.nav.primary}>
            {isLanding ? (
              <a href="#process">{t.nav.howItWorks}</a>
            ) : (
              <Link className={pathname === '/app' ? 'site-nav__active' : undefined} href="/app">
                {t.nav.home}
              </Link>
            )}
            <Link className={pathname.startsWith('/auth') ? 'site-nav__active' : undefined} href="/auth">
              {t.nav.account}
            </Link>
          </nav>
          <LocaleAndThemeControls />
        </div>
      </header>
      <main id="main-content">{children}</main>
    </>
  );
}
