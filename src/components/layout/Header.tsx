import { useEffect, useRef } from "react";
import { Menu, Search, X } from "lucide-react";
import { BrandLogo } from "./BrandLogo";

export interface HeaderProps {
  expanded: boolean;
  toggle: () => void;
  query: string;
  setQuery: (q: string) => void;
  open?: (modalName: string) => void;
  onHome: () => void;
}

export default function Header({
  expanded,
  toggle,
  query,
  setQuery,
  onHome,
}: HeaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Do not intercept if a modal dialog is currently active
        const hasOpenDialog = !!document.querySelector("dialog[open], [role='dialog']");
        if (hasOpenDialog) return;

        const activeEl = document.activeElement;

        // Do not intercept if active focus is inside a dialog or modal
        if (activeEl?.closest("dialog, [role='dialog']")) return;

        // Do not intercept if active focus is inside the video player or its controls
        if (activeEl?.closest(".player, .controls")) return;

        const isEditable =
          activeEl instanceof HTMLInputElement ||
          activeEl instanceof HTMLTextAreaElement ||
          activeEl instanceof HTMLSelectElement ||
          (activeEl instanceof HTMLElement && activeEl.isContentEditable);

        // Do not intercept if focus is inside an editable field or already in the search input
        if (!isEditable && inputRef.current && activeEl !== inputRef.current) {
          e.preventDefault();
          inputRef.current.focus();
        }
      }
    }

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  return (
    <header>
      <div className="header-brand">
        <button
          id="nav-toggle"
          className={`icon-button hamburger ${expanded ? "expanded" : ""}`}
          onClick={toggle}
          aria-label="Toggle navigation"
          aria-expanded={expanded}
          aria-controls="sidebar"
        >
          <Menu />
        </button>
        <BrandLogo onHome={onHome} />
      </div>
      <form
        className="search"
        role="search"
        onSubmit={(e) => e.preventDefault()}
      >
        <Search size={19} aria-hidden="true" />
        <input
          ref={inputRef}
          aria-label="Search"
          placeholder="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              if (query) {
                setQuery("");
              } else {
                inputRef.current?.blur();
              }
            }
          }}
        />
        {query && (
          <button
            type="button"
            aria-label="Clear search"
            className="icon-button"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </form>
    </header>
  );
}
