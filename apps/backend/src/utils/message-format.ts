/**
 * Outgoing message normalizer.
 *
 * Messaging channels (Telegram, Messenger, Instagram, WhatsApp) render the text
 * we send LITERALLY — markdown is not interpreted, so `*bold*` arrives as
 * `*bold*` and `### Heading` arrives with the hashes. The prompt already tells
 * the model to avoid markdown; this is the defensive second layer so a stray
 * token can never reach a customer.
 *
 * Guarantees:
 * - Idempotent: formatting an already-formatted string changes nothing.
 * - Never mangles Arabic (or any non-Latin) text, emoji, URLs, or a literal
 *   `*`/`_` inside a word (`2*3`, `snake_case`) — emphasis is only unwrapped at
 *   real word boundaries, the way markdown itself defines it.
 * - Only applied to AI-GENERATED outbound text. Agent-typed messages are sent
 *   exactly as the agent wrote them.
 */

export interface FormatOutgoingOptions {
  /** Marker used for converted markdown list items (default '• '). */
  bullet?: string;
}

/** Characters allowed immediately BEFORE an emphasis opener. */
const OPEN_BOUNDARY = String.raw`\s(\[{<"'«‹„、(,:;!?—–-`;
/** Characters allowed immediately AFTER an emphasis closer. */
const CLOSE_BOUNDARY = String.raw`\s)\]}>"'»›”、),.،؟!?:;—–`;

/**
 * Build an "unwrap emphasis" regex for a delimiter (e.g. `**`). The opener must
 * start a word (line start or a boundary char) and be followed by a non-space;
 * the closer must follow a non-space and end a word. That is what keeps `2*3`
 * and `snake_case` intact.
 */
function emphasisPattern(delimiter: string): RegExp {
  const d = delimiter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const inner = delimiter[0] === '*' ? String.raw`[^*\n]` : String.raw`[^_\n]`;
  return new RegExp(
    `(^|[${OPEN_BOUNDARY}])${d}(?![\\s${d[d.length - 1]}])(${inner}+?)(?<![\\s])${d}(?=$|[${CLOSE_BOUNDARY}])`,
    'gm',
  );
}

const BOLD_STAR = emphasisPattern('**');
const ITALIC_STAR = emphasisPattern('*');
const BOLD_UNDERSCORE = emphasisPattern('__');
const ITALIC_UNDERSCORE = emphasisPattern('_');

/** ```lang fenced block -> its inner text (fences dropped, content kept). */
const CODE_FENCE = /```[^\n`]*\n?([\s\S]*?)```/g;
/** `inline code` -> its inner text. */
const INLINE_CODE = /`([^`\n]+)`/g;
/** Leading markdown heading marker (`#` .. `######` + at least one space). */
const HEADING = /^[ \t]*#{1,6}[ \t]+/gm;
/** Markdown list marker at the start of a line (`- `, `* `, `+ `). */
const LIST_MARKER = /^([ \t]*)[-*+][ \t]+/gm;
/** Trailing spaces/tabs on a line. */
const TRAILING_SPACE = /[ \t]+$/gm;

/**
 * Strip markdown from text that is about to be sent to a customer and give
 * lists a readable one-item-per-line shape.
 */
export function formatOutgoingText(
  text: string,
  opts: FormatOutgoingOptions = {},
): string {
  const bullet = opts.bullet ?? '• ';

  let out = text.replace(/\r\n?/g, '\n');

  // Trailing whitespace goes FIRST: it keeps a bare "###" separator line (used
  // by the suggestions protocol) from looking like an empty heading.
  out = out.replace(TRAILING_SPACE, '');

  // Code: keep the content, drop the markers.
  out = out.replace(CODE_FENCE, '$1');
  out = out.replace(INLINE_CODE, '$1');
  // An unbalanced fence the model left behind.
  out = out.replace(/```+/g, '');

  out = out.replace(HEADING, '');

  // Lists before emphasis so a leading "* " is never mistaken for an opener.
  out = out.replace(LIST_MARKER, `$1${bullet}`);

  // Longest delimiters first (`**` before `*`, `__` before `_`).
  out = out.replace(BOLD_STAR, '$1$2');
  out = out.replace(ITALIC_STAR, '$1$2');
  out = out.replace(BOLD_UNDERSCORE, '$1$2');
  out = out.replace(ITALIC_UNDERSCORE, '$1$2');

  // At most one blank line between blocks.
  out = out.replace(/\n{3,}/g, '\n\n');

  return out.trim();
}
