# Design system — the single source of truth for the dashboard UI

Every page MUST follow these rules. They exist so the product feels like one
app, is obvious to use, and works on a phone. Tailwind only; no new
dependencies; no CSS files beyond `globals.css`.

## 1. Layout & spacing scale

- Page wrapper: `space-y-6` between blocks. Never hand-tune margins per page.
- Section padding: `p-4 sm:p-6` (tighter on phones, roomier on desktop).
- Content max width: `max-w-6xl` for list/detail pages, `max-w-3xl` for
  single-column forms (profile, AI settings). Centre with `mx-auto`.
- Grids: `grid gap-4 sm:grid-cols-2 lg:grid-cols-4` — ALWAYS start at one
  column. Never `sm:grid-cols-4` without a smaller step.
- Radius: `rounded-xl` for cards/panels, `rounded-lg` for controls/rows,
  `rounded-full` only for pills/avatars.
- Borders: `border border-slate-200`. Shadows: `shadow-sm` only (no heavy
  shadows). Card surface is always `bg-white`.

## 2. Typography

| Role | Classes |
|---|---|
| Page title | `text-xl sm:text-2xl font-semibold text-slate-900` |
| Page description | `text-sm text-slate-500` |
| Section title | `text-sm font-semibold text-slate-900` |
| Section label / eyebrow | `text-[11px] font-medium uppercase tracking-wider text-slate-400` |
| Body | `text-sm text-slate-700` |
| Metric value | `text-2xl font-semibold tabular-nums text-slate-900` |
| Muted meta | `text-xs text-slate-500` |

Numbers that change (counts, money, durations) always get `tabular-nums`.

## 3. Colour meaning (never decorative)

- Primary action / active state: `bg-brand-600 text-white` (hover
  `bg-brand-700`).
- Secondary action: `border border-slate-300 bg-white text-slate-700`.
- Destructive: `text-red-600`, confirm buttons `bg-red-600 text-white`.
- Focus ring: `ring-brand-600` — the `FOCUS_RING` constant in `ui.tsx`. Never
  hand-roll a different one.
- Status via `Badge`: green = healthy/active/paid, amber = pending/trial/
  warning, red = failed/expired/error, slate = neutral/inactive, blue = info.
- Never use colour as the ONLY signal — pair it with text or an icon.

### 3a. The brand palette

Defined once in `tailwind.config.ts` as `brand-50 … brand-950`, built around
the Thunder.AI logo blue. Use the token, never a raw hex and never a stock
Tailwind `blue-*` — the point of the scale is that the brand can be retuned in
one file.

| Step | Use it for |
|---|---|
| `brand-50` | Tinted backgrounds (selected cards, subtle callouts). |
| `brand-500` | **Accents and marks only.** The logo blue. |
| `brand-600` | Primary actions, active nav, focus rings, unread badges. |
| `brand-700` | Hover on primary, active tab text. |
| `brand-950` | The logo's near-black backdrop. |

**`brand-500` must never carry white text.** Measured: white on `brand-500` is
3.01:1, below the 4.5:1 floor; `brand-600` is 4.98:1 and `brand-700` is 6.89:1.
That split is the whole reason the scale has both — the bright end is for
things you look at, the darker end for things you read.

`text-slate-900` remains the body and heading colour. Brand blue marks what is
actionable or selected; using it for prose would destroy that signal.

### 3b. The logo

`components/Logo.tsx` exports `Logo` (mark + wordmark) and `LogoMark` (bolt
only). Inline SVG, not an image file: it renders from a 20px favicon to a
36px auth header without going soft, and inherits `currentColor` so one
component serves both light and dark surfaces. `app/icon.svg` is the favicon —
Next picks it up by filename, so there is no `<link>` to keep in sync.

## 4. Required states for every data view

Every page that loads data MUST handle all four, in this order:

1. **Loading** — `Skeleton` blocks shaped like the real content (never a bare
   spinner for a whole page, never a layout jump).
2. **Error** — `Alert variant="error"` with a retry affordance.
3. **Empty** — `EmptyState` with a title, one clarifying sentence, and the
   primary action button when the user can create the first item.
4. **Loaded**.

Row/field-level failures use inline `FieldError` or a toast, never a silent
no-op. Any button that triggers a request shows `loading` and is disabled
while in flight.

## 5. Mobile rules (non-negotiable — test at 375px)

- **No horizontal page scroll at 375px.** Wide content scrolls inside its own
  `overflow-x-auto` container, or switches layout.
- **Tables**: hidden below `md` (`hidden md:table`) and replaced by a stacked
  card list (`md:hidden`, one card per record, label/value pairs). Never ask a
  phone user to scroll a table sideways to reach the action buttons.
- **Tap targets**: minimum 40px (`min-h-10`, or `h-10 w-10` for icon
  buttons). Icon-only buttons need `aria-label`.
- **Toolbars/filters**: stack vertically on phones (`flex flex-col gap-3
  sm:flex-row sm:items-center`); full-width controls (`w-full sm:w-auto`).
- **Modals**: `max-h-[90dvh] overflow-y-auto` with the action row reachable;
  full-width on phones with `p-4` padding, and sticky footer actions when the
  body scrolls.
- **Sticky primary action** on long forms so Save is always reachable.
- Inputs use `text-base sm:text-sm` (16px on phones prevents iOS zoom).
- Long unbreakable strings (URLs, ids, emails) get `break-words` or `truncate`
  with a `title`.

## 6. Accessibility floor

- Every input has a real `<label>` (`Label htmlFor`).
- Focus is always visible: `focus-visible:outline-none focus-visible:ring-2
  focus-visible:ring-slate-900 focus-visible:ring-offset-2`.
- Icon-only controls: `aria-label`. Active nav: `aria-current="page"`.
- Modals: focus trap not required, but Escape must close and the trigger must
  be reachable again.
- Never convey state by colour alone (see §3).

## 7. Shared primitives — extend, never fork

`components/ui.tsx` owns every primitive; import them all from
`@/components/ui`. If a page needs a new repeated pattern, ADD it here and
reuse it everywhere — do not copy a local variant.

Layout & content: `Card, Panel, PageHeader, SectionCard`.
Metrics: `StatCard`.
Forms: `Label, Input, Textarea, Select, Toggle`.
Actions: `Button, CopyButton`.
Lists: `Toolbar, ToolbarSearch, Tabs, DataList, Pagination`.
Feedback: `Alert, FieldError, Badge, Spinner, EmptyState, Skeleton`.
Overlays: `Modal, ConfirmDialog`.

- `StatCard({ label, value, hint?, tone?, icon? })` — dashboard metric card;
  eyebrow label, `tabular-nums` value, `tone` adds a subtle left accent that
  only ever *reinforces* the text (§3).
- `SectionCard({ title?, description?, actions?, padded?, children })` — Panel
  with a header row that stacks on phones. `padded={false}` renders children
  flush so a `DataList` table can reach the card edges.
- `Toolbar({ search?, filters?, actions?, children? })` +
  `ToolbarSearch({ value, onChange, placeholder?, label? })` — the responsive
  search/filter/action bar from §5; `filters` children are forced full-width
  on phones automatically.
- `Tabs({ tabs, value, onChange, size?, label?, idPrefix? })` — controlled
  `role="tab"` strip with arrow-key/Home/End navigation, roving `tabindex`,
  optional per-tab `count`, horizontally scrollable without clipping the
  active underline. Replaces every inline tab-button block.
- `DataList<T>({ items, keyOf, columns, actions?, actionsHeader?, empty?,
  loading?, skeletonRows?, bare?, caption? })` — THE record list: one
  `DataListColumn<T>` array renders a real `<table>` at `md+` and a stacked
  card list below it (§5), plus the loading skeleton and empty state (§4).
  Column fields: `{ key, header, cell(item), align?, hideOnMobile?, primary?,
  className? }` — `primary` is the card title on phones, everything else
  becomes a label/value row; card-footer actions get 40px tap targets. Pass
  `bare` when it already sits inside a `SectionCard`.
- `CopyButton({ value, label?, copiedLabel?, ariaLabel?, size?, variant? })` —
  clipboard copy with a transient "Copied" confirmation and an `aria-label`;
  use for API keys, webhook secrets and ids.
- `Pagination({ page, totalPages, onChange, total? })` — prev/next footer;
  renders nothing when `totalPages <= 1`, so drop it under any list
  unconditionally. `@/lib/types` also exports a `Pagination` *type*: in pages
  that import both, use the `PaginationBar` alias for the component.
- `Input`/`Textarea`/`Select` take `invalid` — it sets `aria-invalid` and the
  red border; pair it with `FieldError`.
- `Modal` takes an optional `footer` slot that stays pinned while the body
  scrolls inside `max-h-[90dvh]` (§5). `ConfirmDialog` uses it.
- `Button` sizes: `md` (default, 40px — use it everywhere) and `sm` (dense
  in-row controls only). `loading` disables the button and swaps the label for
  `loadingLabel` ("Please wait…" by default).
- `EmptyState` takes an optional `icon` above the title.

## 8. Copy rules

- Sentence case for labels and buttons ("Add product", not "ADD PRODUCT").
- Buttons say the action ("Save changes", "Import products"), never "Submit".
- Every empty state explains what the thing is for in one sentence.
- Errors say what happened AND what to do next.
- Never expose internal ids/enums raw in user-facing text — humanize
  (`STARTING_FROM` → "Starting from", `PAST_DUE` → "Past due").
