import { useState, useEffect, type ReactNode } from 'react';

type Theme = 'dark' | 'light';

export function Shell({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem('omnicode-web-theme');
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });

  useEffect(() => {
    localStorage.setItem('omnicode-web-theme', theme);
    document.documentElement.classList.toggle('theme-light', theme === 'light');
  }, [theme]);

  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden"
      style={{ background: 'var(--color-background)', color: 'var(--color-foreground)', transition: 'background 0.2s var(--wf-ease), color 0.2s var(--wf-ease)' }}
    >
      <header
        className="flex h-[48px] shrink-0 items-center border-b px-4"
        style={{
          background: 'var(--color-header)',
          borderColor: 'var(--color-border)',
          borderBottomWidth: 1,
          transition: 'background 0.2s var(--wf-ease)',
        }}
      >
        <div className="flex items-center gap-2">
          <div
            className="flex h-6 w-6 items-center justify-center rounded-md"
            style={{ background: 'var(--highspeed-model-gradient)', animation: 'breathe var(--wf-beat) infinite' }}
          >
            <span className="text-xs font-bold text-white">O</span>
          </div>
          <span className="text-sm font-semibold tracking-tight" style={{ color: 'var(--color-foreground)' }}>
            Omnicode
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={toggle}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
            style={{
              background: 'var(--color-surface-hover)',
              color: 'var(--color-foreground-subtle)',
              border: '1px solid var(--color-border)',
              cursor: 'pointer',
            }}
            title="Toggle theme"
          >
            <span style={{ fontSize: 11 }}>{theme === 'dark' ? '☀' : '◐'}</span>
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
