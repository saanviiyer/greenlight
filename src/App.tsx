import { useEffect, useState } from 'react';
import { BookingPage } from './pages/BookingPage';
import { Dashboard } from './pages/Dashboard';

function usePath(): [string, (p: string) => void] {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = (p: string) => {
    window.history.pushState({}, '', p);
    setPath(p);
  };
  return [path, navigate];
}

export function App() {
  const [path, navigate] = usePath();

  const isDashboard = path.startsWith('/dashboard');
  const route = isDashboard ? 'dashboard' : 'book';

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <button
            onClick={() => navigate('/book')}
            className="flex items-center gap-2 text-lg font-semibold text-slate-900"
          >
            <span className="inline-block h-3 w-3 rounded-full bg-brand-500" />
            Greenlight
          </button>
          <nav className="flex gap-1 text-sm">
            <button
              onClick={() => navigate('/book')}
              className={`rounded-md px-3 py-1.5 font-medium ${
                route === 'book'
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Book a time
            </button>
            <button
              onClick={() => navigate('/dashboard')}
              className={`rounded-md px-3 py-1.5 font-medium ${
                route === 'dashboard'
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Owner dashboard
            </button>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        {route === 'dashboard' ? <Dashboard /> : <BookingPage />}
      </main>

      <footer className="mx-auto max-w-5xl px-4 pb-10 text-center text-xs text-slate-400">
        Greenlight. Requests are reviewed by the owner before a meeting is confirmed.
      </footer>
    </div>
  );
}
