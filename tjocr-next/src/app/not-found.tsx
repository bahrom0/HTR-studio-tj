import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-24 text-center">
      <div className="text-xs font-mono uppercase tracking-wider text-app-text-secondary mb-2">
        404
      </div>
      <h1 className="text-3xl font-medium tracking-tight text-app-text mb-4">
        Страница не найдена
      </h1>
      <p className="text-sm text-app-text-secondary max-w-sm mb-8">
        Запрашиваемая страница не существует или была перемещена.
      </p>
      <Link href="/">
        <Button variant="outline">
          Вернуться на главную
        </Button>
      </Link>
    </div>
  );
}
