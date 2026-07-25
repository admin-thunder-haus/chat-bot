'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Compact "⋯" popover that holds secondary controls on narrow screens.
 *
 * LOCAL primitive: a generalised `Menu`/`Popover` belongs in the shared UI file
 * once a second screen needs it — it is kept here so the shared file is not
 * touched while it is being extended elsewhere.
 *
 * `children` receives a `close` callback so a control that completes an action
 * (Archive, for example) can dismiss the panel, while controls the user may
 * change several times in a row (selects, toggles) leave it open.
 */
export function OverflowMenu({
  label,
  children,
}: {
  label: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  // Escape closes the panel and returns focus to the trigger (§6).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
      >
        <span aria-hidden="true" className="text-lg leading-none">
          ⋯
        </span>
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-30"
            aria-hidden="true"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-label={label}
            className="absolute right-0 z-40 mt-1 w-64 max-w-[calc(100vw-1.5rem)] space-y-3 rounded-xl border border-slate-200 bg-white p-3 shadow-lg"
          >
            {children(close)}
          </div>
        </>
      )}
    </div>
  );
}

/** Labelled row inside an `OverflowMenu` panel. */
export function OverflowMenuRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-slate-400">
        {label}
      </p>
      {children}
    </div>
  );
}
