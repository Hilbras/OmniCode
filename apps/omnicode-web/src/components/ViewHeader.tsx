import type { ReactNode } from "react";
import { Menu } from "lucide-react";

export interface ViewHeaderProps {
  title: string;
  icon?: ReactNode;
  isMobile?: boolean;
  onMenuClick?: () => void;
  right?: ReactNode;
}

export default function ViewHeader({ title, icon, isMobile = false, onMenuClick, right }: ViewHeaderProps) {
  return (
    <header className="top-bar-glass flex items-center justify-between px-5 py-3 shrink-0">
      <div className="flex items-center gap-3 overflow-hidden">
        {isMobile && onMenuClick && (
          <button
            type="button"
            onClick={onMenuClick}
            className="rounded-xl p-1.5 txt-muted hover:text-head hover:bg-gold/5 transition-colors"
            aria-label="Open menu"
          >
            <Menu className="h-4 w-4" strokeWidth={1.5} />
          </button>
        )}
        {icon}
        <h1 className="text-[15px] font-semibold txt-head leading-tight truncate">
          {title}
        </h1>
      </div>
      {right}
    </header>
  );
}
