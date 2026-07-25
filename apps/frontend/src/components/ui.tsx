'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

/**
 * Shared UI primitives. Every dashboard page composes these — never fork a
 * local copy (see `docs/DESIGN-SYSTEM.md` §7). Rules encoded here: spacing
 * scale (§1), typography (§2), colour meaning (§3), the four data states (§4),
 * mobile behaviour (§5) and the accessibility floor (§6).
 */

/** The focus treatment every interactive primitive shares (§6). */
const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2';

/* -------------------------------------------------------------------------- */
/* Layout                                                                     */
/* -------------------------------------------------------------------------- */

/** Centred single-purpose card — use for auth/standalone screens, not pages. */
export function Card({ children }: { children: ReactNode }) {
  return (
    <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
      {children}
    </div>
  );
}

/** Bare white surface — use when you need a card with no header row. */
export function Panel({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white p-6 shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

/** Top-of-page title block — use once per page, above the content. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
          {actions}
        </div>
      )}
    </div>
  );
}

/**
 * Panel with a title/description/actions header that stacks on phones — use
 * for every titled block of content (§7). `padded={false}` renders children
 * flush so a `DataList` table can reach the card edges.
 */
export function SectionCard({
  title,
  description,
  actions,
  children,
  padded = true,
  className = '',
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  padded?: boolean;
  className?: string;
}) {
  const hasHeader = Boolean(title || description || actions);
  return (
    <section
      className={`overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}
    >
      {hasHeader && (
        <div
          className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${
            padded
              ? 'p-4 pb-0 sm:p-6 sm:pb-0'
              : 'border-b border-slate-200 p-4 sm:p-6'
          }`}
        >
          <div className="min-w-0">
            {title && (
              <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
            )}
            {description && (
              <p className="mt-1 text-sm text-slate-500">{description}</p>
            )}
          </div>
          {actions && (
            <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
              {actions}
            </div>
          )}
        </div>
      )}
      <div className={padded ? 'p-4 sm:p-6' : ''}>{children}</div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Metrics                                                                    */
/* -------------------------------------------------------------------------- */

type StatTone = 'neutral' | 'positive' | 'warning' | 'negative' | 'info';

const STAT_TONE_CLASSES: Record<StatTone, string> = {
  neutral: '',
  positive: 'border-l-4 border-l-green-500',
  warning: 'border-l-4 border-l-amber-500',
  negative: 'border-l-4 border-l-red-500',
  info: 'border-l-4 border-l-blue-500',
};

/**
 * Dashboard metric card: eyebrow label + `tabular-nums` value + optional hint.
 * `tone` adds a subtle left accent — it reinforces the text, never replaces it
 * (§3), so keep the meaning in `label`/`hint` too.
 */
export function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
  icon,
  className = '',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: StatTone;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6 ${STAT_TONE_CLASSES[tone]} ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
          {label}
        </p>
        {icon && (
          <span className="shrink-0 text-slate-400" aria-hidden="true">
            {icon}
          </span>
        )}
      </div>
      <p className="mt-2 break-words text-2xl font-semibold tabular-nums text-slate-900">
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Form controls                                                              */
/* -------------------------------------------------------------------------- */

/** Real `<label>` for a control — every input needs one (§6). */
export function Label({
  htmlFor,
  children,
  required,
}: {
  htmlFor: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1 block text-sm font-medium text-slate-700"
    >
      {children}
      {required && <span className="ml-0.5 text-red-500">*</span>}
    </label>
  );
}

// `text-base sm:text-sm` keeps iOS from zooming on focus (§5); `min-h-10`
// satisfies the 40px tap target.
const fieldClasses = `w-full rounded-lg border px-3 py-2 text-base outline-none transition disabled:bg-slate-100 disabled:text-slate-500 sm:text-sm ${FOCUS_RING}`;
const fieldValid = 'border-slate-300 focus-visible:border-slate-900';
const fieldInvalid =
  'border-red-300 focus-visible:border-red-600 focus-visible:ring-red-600';

function fieldClassName(invalid: boolean | undefined, extra: string): string {
  return `${fieldClasses} ${invalid ? fieldInvalid : fieldValid} ${extra}`;
}

/** Text input. Pass `invalid` alongside a `FieldError` to show a bad value. */
export function Input({
  invalid,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      {...props}
      aria-invalid={props['aria-invalid'] ?? (invalid ? true : undefined)}
      className={fieldClassName(invalid, `min-h-10 ${className ?? ''}`)}
    />
  );
}

/** Multi-line input. Same `invalid` contract as `Input`. */
export function Textarea({
  invalid,
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      {...props}
      aria-invalid={props['aria-invalid'] ?? (invalid ? true : undefined)}
      className={fieldClassName(invalid, `min-h-[96px] ${className ?? ''}`)}
    />
  );
}

/** Native select. Same `invalid` contract as `Input`. */
export function Select({
  invalid,
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select
      {...props}
      aria-invalid={props['aria-invalid'] ?? (invalid ? true : undefined)}
      className={fieldClassName(invalid, `min-h-10 ${className ?? ''}`)}
    >
      {props.children}
    </select>
  );
}

/** On/off switch for a single boolean setting. Always pass `label`. */
export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50 ${FOCUS_RING} ${
        checked ? 'bg-slate-900' : 'bg-slate-300'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Buttons                                                                    */
/* -------------------------------------------------------------------------- */

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'sm' | 'md';

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'bg-slate-900 text-white hover:bg-slate-700',
  secondary:
    'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50',
  danger: 'bg-red-600 text-white hover:bg-red-500',
  ghost: 'text-slate-600 hover:bg-slate-100',
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'min-h-8 px-2.5 py-1.5 text-xs',
  md: 'min-h-10 px-4 py-2 text-sm',
};

/**
 * The only button in the app. `md` meets the 40px tap target (§5); use `sm`
 * only for dense in-row controls. Any button that fires a request gets
 * `loading` so it disables itself while in flight (§4).
 */
export function Button({
  children,
  loading,
  loadingLabel = 'Please wait…',
  variant = 'primary',
  size = 'md',
  fullWidth,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  loadingLabel?: string;
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      aria-busy={loading ? true : undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING} ${
        VARIANT_CLASSES[variant]
      } ${SIZE_CLASSES[size]} ${fullWidth ? 'w-full' : ''} ${
        props.className ?? ''
      }`}
    >
      {loading && <Spinner size={size === 'sm' ? 12 : 14} />}
      {loading ? loadingLabel : children}
    </button>
  );
}

/**
 * Copies `value` to the clipboard and confirms it inline — use for API keys,
 * webhook secrets and ids the user must paste elsewhere.
 */
export function CopyButton({
  value,
  label = 'Copy',
  copiedLabel = 'Copied',
  ariaLabel,
  size = 'sm',
  variant = 'secondary',
  className = '',
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
  ariaLabel?: string;
  size?: Size;
  variant?: Variant;
  className?: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const t = setTimeout(() => setState('idle'), 1800);
    return () => clearTimeout(t);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      // Clipboard access can be blocked (insecure context, permissions) — tell
      // the user what to do instead rather than failing silently.
      setState('failed');
    }
  }

  const text =
    state === 'copied' ? copiedLabel : state === 'failed' ? 'Copy failed' : label;

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      onClick={() => void copy()}
      aria-label={ariaLabel ?? `${label} to clipboard`}
      className={className}
    >
      <span aria-live="polite">{text}</span>
    </Button>
  );
}

/* -------------------------------------------------------------------------- */
/* Toolbar                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The search + filters + primary-action bar above a list. Stacks vertically on
 * phones and makes its children full-width there (§5). Use the `search` /
 * `filters` / `actions` slots, or pass free-form `children`.
 */
export function Toolbar({
  search,
  filters,
  actions,
  children,
  className = '',
}: {
  search?: ReactNode;
  filters?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col gap-3 sm:flex-row sm:items-center ${className}`}
    >
      {search && <div className="w-full sm:max-w-xs">{search}</div>}
      {filters && (
        <div className="flex flex-col gap-3 [&>*]:w-full sm:flex-row sm:items-center sm:[&>*]:w-auto">
          {filters}
        </div>
      )}
      {children}
      {actions && (
        <div className="flex flex-col gap-2 sm:ml-auto sm:flex-row sm:items-center">
          {actions}
        </div>
      )}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="11" cy="11" r="6.5" />
      <path d="M15.8 15.8 20.5 20.5" />
    </svg>
  );
}

/**
 * Search field for `Toolbar`'s `search` slot: labelled for screen readers,
 * full-width on phones, and it hands you the string directly.
 */
export function ToolbarSearch({
  value,
  onChange,
  placeholder = 'Search…',
  label = 'Search',
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  id?: string;
}) {
  const generated = useId();
  const inputId = id ?? `search-${generated}`;
  return (
    <div className="relative">
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
        <SearchIcon />
      </span>
      <Input
        id={inputId}
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="pl-9"
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tabs                                                                       */
/* -------------------------------------------------------------------------- */

export type TabItem<T extends string = string> = {
  key: T;
  label: ReactNode;
  /** Optional count pill (e.g. unread) rendered after the label. */
  count?: number;
  disabled?: boolean;
  /** `id` of the panel this tab controls, if you render one. */
  panelId?: string;
};

const TAB_SIZE_CLASSES: Record<Size, string> = {
  sm: 'min-h-10 px-3 py-2 text-sm',
  md: 'min-h-10 px-4 py-3 text-sm',
};

/**
 * Accessible tab strip (the pattern DetailsDrawer/Operations used inline).
 * Controlled: renders real `role="tab"` buttons with arrow-key navigation and
 * scrolls horizontally on phones without clipping the active underline.
 */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  size = 'md',
  label = 'Tabs',
  idPrefix,
  className = '',
}: {
  tabs: readonly TabItem<T>[];
  value: T;
  onChange: (key: T) => void;
  size?: Size;
  label?: string;
  idPrefix?: string;
  className?: string;
}) {
  const generated = useId();
  const prefix = idPrefix ?? `tabs-${generated}`;
  const listRef = useRef<HTMLDivElement>(null);

  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const enabled = tabs.filter((t) => !t.disabled);
    if (enabled.length === 0) return;
    const current = enabled.findIndex((t) => t.key === value);
    let nextIndex: number;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      nextIndex = (current + 1 + enabled.length) % enabled.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      nextIndex = (current - 1 + enabled.length) % enabled.length;
    } else if (e.key === 'Home') {
      nextIndex = 0;
    } else if (e.key === 'End') {
      nextIndex = enabled.length - 1;
    } else {
      return;
    }
    const next = enabled[nextIndex];
    if (!next || next.key === value) return;
    e.preventDefault();
    onChange(next.key);
    listRef.current
      ?.querySelector<HTMLButtonElement>(`[data-tab-key="${next.key}"]`)
      ?.focus();
  }

  return (
    <div className={`border-b border-slate-200 ${className}`}>
      <div className="-mb-px overflow-x-auto">
        <div
          ref={listRef}
          role="tablist"
          aria-label={label}
          onKeyDown={onKeyDown}
          className="flex w-max min-w-full"
        >
          {tabs.map((tab) => {
            const active = tab.key === value;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                id={`${prefix}-${tab.key}`}
                data-tab-key={tab.key}
                aria-selected={active}
                aria-controls={tab.panelId}
                tabIndex={active ? 0 : -1}
                disabled={tab.disabled}
                onClick={() => onChange(tab.key)}
                className={`inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap border-b-2 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING} ${
                  TAB_SIZE_CLASSES[size]
                } ${
                  active
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {tab.label}
                {typeof tab.count === 'number' && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[11px] tabular-nums ${
                      active
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Data list (desktop table + mobile cards)                                   */
/* -------------------------------------------------------------------------- */

export type DataListColumn<T> = {
  /** Stable identity for the column (also the React key). */
  key: string;
  header: ReactNode;
  cell: (item: T) => ReactNode;
  align?: 'left' | 'center' | 'right';
  /** Drop this column from the mobile cards (keep the table lean too). */
  hideOnMobile?: boolean;
  /** Marks the column used as the card title on phones. Pick exactly one. */
  primary?: boolean;
  /** Extra classes for this column's table cell + card value. */
  className?: string;
};

const ALIGN_CLASSES = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
} as const;

/**
 * THE list primitive: one column definition renders a real `<table>` at `md+`
 * and a stacked card list below it (§5), plus the loading and empty states
 * (§4). Give it `bare` when it already sits inside a `SectionCard`.
 */
export function DataList<T>({
  items,
  keyOf,
  columns,
  actions,
  actionsHeader = 'Actions',
  empty,
  loading,
  skeletonRows = 4,
  bare = false,
  caption,
  className = '',
}: {
  items: readonly T[];
  keyOf: (item: T) => string;
  columns: readonly DataListColumn<T>[];
  actions?: (item: T) => ReactNode;
  actionsHeader?: ReactNode;
  empty?: ReactNode;
  loading?: boolean;
  skeletonRows?: number;
  bare?: boolean;
  caption?: string;
  className?: string;
}) {
  const surface = bare
    ? ''
    : 'rounded-xl border border-slate-200 bg-white shadow-sm';
  const mobileColumns = columns.filter((c) => !c.hideOnMobile);
  const primary = mobileColumns.find((c) => c.primary) ?? mobileColumns[0];
  const detailColumns = mobileColumns.filter((c) => c !== primary);

  const head = (
    <thead className="border-b border-slate-200 text-[11px] font-medium uppercase tracking-wider text-slate-400">
      <tr>
        {columns.map((c) => (
          <th
            key={c.key}
            scope="col"
            className={`px-4 py-3 font-medium ${
              ALIGN_CLASSES[c.align ?? 'left']
            }`}
          >
            {c.header}
          </th>
        ))}
        {actions && (
          <th scope="col" className="px-4 py-3 text-right font-medium">
            {actionsHeader}
          </th>
        )}
      </tr>
    </thead>
  );

  if (loading) {
    const rows = Array.from({ length: Math.max(1, skeletonRows) });
    return (
      <div className={className} aria-busy="true">
        <div className={`hidden overflow-x-auto md:block ${surface}`}>
          <table className="w-full text-sm">
            {caption && <caption className="sr-only">{caption}</caption>}
            {head}
            <tbody>
              {rows.map((_, i) => (
                <tr key={i} className="border-b border-slate-100 last:border-0">
                  {columns.map((c) => (
                    <td key={c.key} className="px-4 py-3">
                      <Skeleton className="h-4 w-full max-w-[10rem]" />
                    </td>
                  ))}
                  {actions && (
                    <td className="px-4 py-3">
                      <Skeleton className="ml-auto h-8 w-24" />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="space-y-3 md:hidden">
          {rows.map((_, i) => (
            <li
              key={i}
              className={bare ? 'space-y-2' : `${surface} space-y-2 p-4`}
            >
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-3/5" />
              <Skeleton className="h-3 w-1/2" />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={className}>
        {empty ?? (
          <EmptyState
            title="Nothing here yet"
            description="Records will show up here as soon as there are any."
          />
        )}
      </div>
    );
  }

  return (
    <div className={className}>
      {/* Desktop: a real table (§5 — hidden below md). */}
      <div className={`hidden overflow-x-auto md:block ${surface}`}>
        <table className="w-full text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          {head}
          <tbody>
            {items.map((item) => (
              <tr
                key={keyOf(item)}
                className="border-b border-slate-100 text-slate-700 last:border-0"
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-4 py-3 ${ALIGN_CLASSES[c.align ?? 'left']} ${
                      c.className ?? ''
                    }`}
                  >
                    {c.cell(item)}
                  </td>
                ))}
                {actions && (
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {actions(item)}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phones: one card per record, label/value pairs (§5). */}
      <ul className="space-y-3 md:hidden">
        {items.map((item) => (
          <li
            key={keyOf(item)}
            className={bare ? '' : `${surface} p-4`}
          >
            {primary && (
              <div className="min-w-0 break-words text-sm font-medium text-slate-900">
                {primary.cell(item)}
              </div>
            )}
            {detailColumns.length > 0 && (
              <dl className="mt-2 space-y-1.5">
                {detailColumns.map((c) => (
                  <div key={c.key} className="flex justify-between gap-3">
                    <dt className="shrink-0 text-xs text-slate-500">
                      {c.header}
                    </dt>
                    <dd
                      className={`min-w-0 break-words text-right text-sm text-slate-700 ${
                        c.className ?? ''
                      }`}
                    >
                      {c.cell(item)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {actions && (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 [&_button]:min-h-10">
                {actions(item)}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Pagination                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Prev/next footer for a paged list. Renders nothing when there is a single
 * page, so you can drop it under any list unconditionally.
 *
 * NOTE: `@/lib/types` also exports a `Pagination` *type*. In pages that import
 * both, use the `PaginationBar` alias for this component.
 */
export function Pagination({
  page,
  totalPages,
  onChange,
  total,
  className = '',
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  total?: number;
  className?: string;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav
      aria-label="Pagination"
      className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${className}`}
    >
      <p className="text-sm tabular-nums text-slate-500">
        Page {page} of {totalPages}
        {typeof total === 'number' && ` · ${total} total`}
      </p>
      <div className="flex items-center gap-2">
        <Button
          size="md"
          variant="secondary"
          className="flex-1 sm:flex-none"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          Previous
        </Button>
        <Button
          size="md"
          variant="secondary"
          className="flex-1 sm:flex-none"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </nav>
  );
}

/** Alias for `Pagination` — use it when the `Pagination` type is also imported. */
export const PaginationBar = Pagination;

/* -------------------------------------------------------------------------- */
/* Feedback                                                                   */
/* -------------------------------------------------------------------------- */

type AlertVariant = 'error' | 'success' | 'info' | 'warning';

const ALERT_CLASSES: Record<AlertVariant, string> = {
  error: 'border-red-200 bg-red-50 text-red-700',
  success: 'border-green-200 bg-green-50 text-green-700',
  info: 'border-blue-200 bg-blue-50 text-blue-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
};

/** Block-level message. Use `variant="error"` + a retry button for load failures (§4). */
export function Alert({
  message,
  variant = 'error',
  children,
}: {
  message?: string;
  variant?: AlertVariant;
  children?: ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border px-3 py-2 text-sm ${ALERT_CLASSES[variant]}`}
    >
      {message}
      {children}
    </div>
  );
}

/** Inline validation message under a field — pair with `invalid` on the control. */
export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-red-600">{message}</p>;
}

/** Status pill. Colours carry meaning (§3) — always keep the word too. */
export function Badge({
  children,
  color = 'slate',
}: {
  children: ReactNode;
  color?: 'slate' | 'green' | 'red' | 'amber' | 'blue';
}) {
  const map = {
    slate: 'bg-slate-100 text-slate-700',
    green: 'bg-green-100 text-green-700',
    red: 'bg-red-100 text-red-700',
    amber: 'bg-amber-100 text-amber-800',
    blue: 'bg-blue-100 text-blue-700',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${map[color]}`}
    >
      {children}
    </span>
  );
}

/** Inline activity indicator. Never a bare page-level spinner (§4). */
export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      className="inline-block animate-spin rounded-full border-2 border-current border-t-transparent"
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}

/** The "no records yet" state: what the thing is for + the first action (§4). */
export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
      {icon && (
        <span className="mb-3 text-slate-400" aria-hidden="true">
          {icon}
        </span>
      )}
      <p className="text-sm font-medium text-slate-800">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Grey placeholder block — shape it like the content it replaces (§4). */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded-md bg-slate-200 ${className}`} />
  );
}

/* -------------------------------------------------------------------------- */
/* Modal + confirm                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Centred dialog. Escape and backdrop close it; the body scrolls inside
 * `90dvh` and the optional `footer` stays pinned so actions stay reachable on
 * phones (§5).
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 p-4 pb-0 sm:p-6 sm:pb-0">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={`-mr-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 ${FOCUS_RING}`}
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {children}
        </div>
        {footer && (
          <div className="shrink-0 border-t border-slate-200 bg-white p-4 sm:px-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              {footer}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Destructive confirmation. Say what will happen in `message` (§8). */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  loading,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">{message}</p>
    </Modal>
  );
}
