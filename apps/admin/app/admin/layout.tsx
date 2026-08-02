import Link from 'next/link';
import AuthGate from '../../components/AuthGate';
import LogoutButton from '../../components/LogoutButton';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate requireAdmin>
      <div>
        <nav className="border-b px-6 py-3 flex items-center gap-4 text-sm">
          <Link href="/admin/cameras" className="font-medium">
            Камеры
          </Link>
          <Link href="/admin/parser" className="font-medium">
            Парсер
          </Link>
          <Link href="/admin/parser/log" className="font-medium">
            Журнал импорта
          </Link>
          <Link href="/admin/parser/review" className="font-medium">
            Очередь ревью
          </Link>
          <Link href="/admin/monitoring" className="font-medium">
            Мониторинг
          </Link>
          <Link href="/admin/situational" className="font-medium">
            Ситуация на дорогах
          </Link>
          <Link href="/admin/home-verifications" className="font-medium">
            Верификация «Мой дом»
          </Link>
          <Link href="/admin/camera-submissions" className="font-medium">
            Заявки на камеры
          </Link>
          <Link href="/admin/aggregator-sites" className="font-medium">
            Сайты-агрегаторы
          </Link>
          <Link href="/admin/world-map" className="font-medium">
            Карта мира
          </Link>
          <Link href="/admin/btw-dev-tools" className="font-medium">
            BTW: подмена координат
          </Link>
          <Link href="/" className="ml-auto text-gray-500">
            Публичная страница ↗
          </Link>
          <LogoutButton />
        </nav>
        {children}
      </div>
    </AuthGate>
  );
}
