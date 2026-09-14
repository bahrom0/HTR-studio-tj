import type { Metadata } from 'next';
import './globals.css';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import { AppShell, LocaleProvider } from '@/components/app-shell';

export const metadata: Metadata = {
  title: 'TJOCR — Распознавание таджикского рукописного текста',
  description: 'Современный сервис распознавания рукописного таджикского текста. Быстрая загрузка, интерактивный редактор строк и экспорт в DOCX.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className={GeistSans.className}>
        <LocaleProvider>
          <AppShell>{children}</AppShell>
        </LocaleProvider>
      </body>
    </html>
  );
}
