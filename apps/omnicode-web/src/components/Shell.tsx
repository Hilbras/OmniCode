import { useEffect, useState, type ReactNode } from 'react';
import { Menu, Moon, PanelRight, Sun, X } from 'lucide-react';
import {
  nextTheme,
  resolveInitialTheme,
  THEME_STORAGE_KEY,
  type Theme,
} from '../design/theme';

export interface ShellProps {
  /** Content of the left rail (sessions, navigation). */
  readonly sidebar?: ReactNode;
  /** Content of the right contextual drawer (files, tasks, connectors). */
  readonly drawer?: ReactNode;
  readonly children: ReactNode;
}

/**
 * The Omnicode web app frame: nav-blur topbar, left session rail, main pane,
 * optional right drawer. Collapses to slide-overs on small viewports. The
 * theme is applied pre-paint by index.html; this component adopts and persists
 * it.
 */
export function Shell({ sidebar, drawer, children }: ShellProps) {
  const [theme, setTheme] = useState<Theme>('dark');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setTheme(
      resolveInitialTheme(
        localStorage.getItem(THEME_STORAGE_KEY),
        window.matchMedia('(prefers-color-scheme: light)').matches,
      ),
    );
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => nextTheme(t));

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-bg text-text">
      <a href="#main" className="skip-link btn-quiet">
        Skip to content
      </a>

      <header className="nav-blur relative z-30 flex h-12 shrink-0 items-center gap-3 border-b px-3">
        {sidebar !== undefined && (
          <button
            type="button"
            aria-label="Open sessions"
            className="btn-quiet lg:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={16} />
          </button>
        )}
        <div className="flex items-center gap-2">
          <div
            className="flex h-6 w-6 items-center justify-center rounded-md"
            style={{
              background: 'linear-gradient(135deg, var(--gold) 0%, var(--gold-bright) 55%, var(--gold) 100%)',
            }}
          >
            <span className="text-xs font-bold" style={{ color: 'var(--gold-ink)' }}>
              O
            </span>
          </div>
          <span className="text-sm font-semibold tracking-tight">Omnicode</span>
          <span className="mono-label hidden sm:inline">web</span>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {drawer !== undefined && (
            <button
              type="button"
              aria-label="Toggle details"
              className="btn-quiet xl:hidden"
              onClick={() => setDrawerOpen(true)}
            >
              <PanelRight size={16} />
            </button>
          )}
          <button
            type="button"
            aria-label="Toggle theme"
            className="theme-toggle flex h-8 w-8 items-center justify-center rounded-lg"
            onClick={toggleTheme}
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {sidebar !== undefined && (
          <>
            <aside className="hidden w-[280px] shrink-0 flex-col overflow-y-auto border-r bg-surface lg:flex">
              {sidebar}
            </aside>
            {sidebarOpen && (
              <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-label="Sessions">
                <button
                  type="button"
                  aria-label="Close sessions"
                  className="absolute inset-0 h-full w-full cursor-default bg-black/40"
                  onClick={() => setSidebarOpen(false)}
                />
                <aside className="absolute inset-y-0 left-0 flex w-[280px] flex-col overflow-y-auto border-r bg-surface">
                  <div className="flex h-12 shrink-0 items-center justify-end px-3">
                    <button
                      type="button"
                      aria-label="Close sessions"
                      className="btn-quiet"
                      onClick={() => setSidebarOpen(false)}
                    >
                      <X size={16} />
                    </button>
                  </div>
                  {sidebar}
                </aside>
              </div>
            )}
          </>
        )}

        <main id="main" className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {children}
        </main>

        {drawer !== undefined && (
          <>
            <aside className="hidden w-[320px] shrink-0 flex-col overflow-y-auto border-l bg-surface xl:flex">
              {drawer}
            </aside>
            {drawerOpen && (
              <div className="fixed inset-0 z-40 xl:hidden" role="dialog" aria-label="Details">
                <button
                  type="button"
                  aria-label="Close details"
                  className="absolute inset-0 h-full w-full cursor-default bg-black/40"
                  onClick={() => setDrawerOpen(false)}
                />
                <aside className="absolute inset-y-0 right-0 flex w-[320px] flex-col overflow-y-auto border-l bg-surface">
                  <div className="flex h-12 shrink-0 items-center justify-end px-3">
                    <button
                      type="button"
                      aria-label="Close details"
                      className="btn-quiet"
                      onClick={() => setDrawerOpen(false)}
                    >
                      <X size={16} />
                    </button>
                  </div>
                  {drawer}
                </aside>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
