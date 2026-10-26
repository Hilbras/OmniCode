import { Link2, Moon, Settings, Sun, Zap } from "lucide-react";
import type { CSSProperties } from "react";
import AIAvatar from "#/components/AIAvatar";
import ViewHeader from "#/components/ViewHeader";
import { APP_DESCRIPTION, APP_NAME, APP_TAGLINE, APP_VERSION } from "#/lib/config";
import { useTheme } from "#/lib/theme";

const GLOW_STYLE: CSSProperties = {
  background: "radial-gradient(circle, var(--glow-color), transparent 65%)",
};

export default function HomePage() {
  const { theme, toggleTheme } = useTheme();

  return (
    <>
      <ViewHeader
        title={APP_NAME}
        isMobile={false}
        right={
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={toggleTheme}
              className="rounded-full border border-theme p-2 txt-muted transition hover:border-gold/30 hover:text-gold"
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            >
              {theme === "dark" ? (
                <Moon className="h-4 w-4" strokeWidth={1.5} />
              ) : (
                <Sun className="h-4 w-4" strokeWidth={1.5} />
              )}
            </button>
            <button
              type="button"
              onClick={() => (window.location.hash = "/settings")}
              className="rounded-xl p-2 txt-muted transition hover:text-gold hover:bg-gold/5"
              aria-label="Open settings"
              title="Settings"
            >
              <Settings className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
        }
      />

      <main className="relative z-10 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="mx-auto flex max-w-6xl flex-col items-center px-6 py-16 md:py-24">
          <div className="mb-6 h-44 w-44 md:h-56 md:w-56">
            <AIAvatar isActive />
          </div>

          {/* Hero glow behind the headline. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 z-0 h-72 w-[820px] max-w-full rounded-full opacity-40 blur-3xl"
            style={GLOW_STYLE}
          />

          <h2 className="relative z-10 text-center text-[24px] md:text-[32px] font-extrabold txt-head mb-3 tracking-tight">
            {APP_NAME}
          </h2>
          <p className="relative z-10 txt-body text-center max-w-xl text-[15px] leading-relaxed mb-10">
            {APP_TAGLINE} {APP_DESCRIPTION}
          </p>

          <div className="relative z-10 flex flex-col sm:flex-row gap-3 w-full max-w-md justify-center mb-12">
            <button
              type="button"
              onClick={() => (window.location.hash = "/chat")}
              className="btn-gold flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl text-[13px] font-semibold transition-transform hover:scale-[1.02]"
            >
              <Zap className="h-4 w-4" />
              Start a session
            </button>
            <button
              type="button"
              onClick={() => (window.location.hash = "/settings")}
              className="flex items-center justify-center gap-2 rounded-2xl border border-gold/30 bg-gold/10 px-6 py-3.5 text-[13px] font-bold text-gold transition-colors hover:bg-gold/20"
            >
              <Settings className="h-4 w-4" strokeWidth={1.5} />
              Open settings
            </button>
          </div>

          <a
            href="https://github.com/Hilbras/OmniCode"
            target="_blank"
            rel="noopener noreferrer"
            className="relative z-10 mb-8 flex items-center gap-1.5 text-[11px] txt-muted hover:text-gold transition-colors"
          >
            <Link2 className="h-3 w-3" />
            Open source on GitHub
          </a>
        </div>
      </main>

      <footer className="relative z-10 shrink-0 border-t border-theme px-6 py-3 txt-faint text-[10px]">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <span>v{APP_VERSION}</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(255,255,255,0.4)]" />
            Local-first · Autonomous AI Development
          </span>
        </div>
      </footer>
    </>
  );
}
