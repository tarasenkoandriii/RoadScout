import Link from 'next/link';
import AuthGate from '../../components/AuthGate';
import LogoutButton from '../../components/LogoutButton';

export default function BloggerLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate requireBlogger>
      <div>
        <nav className="border-b px-6 py-3 flex items-center gap-4 text-sm">
          <Link href="/blogger" className="font-medium">
            Кабинет блогера
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
