import type {
  MetaOauthSelection,
  MetaOauthSelectionPage,
} from '@/lib/resources/channels';

/**
 * Flattening the two asset shapes into one list of pickable rows.
 *
 * Kept separate from the page because the flattening rule is the part with
 * actual consequences: a WABA with three numbers is THREE choices, not one.
 * Collapsing it to one row per business would silently reintroduce the guess
 * this whole screen exists to remove — the operator would pick the right
 * business and still get the wrong number.
 */

export interface Choice {
  key: string;
  title: string;
  subtitle: string | null;
  /** Exactly the body the connect endpoint expects for this asset. */
  body: { pageId?: string; wabaId?: string; phoneNumberId?: string };
}

export function pageChoices(
  pages: MetaOauthSelectionPage[],
  provider: string,
): Choice[] {
  return pages.map((p) => ({
    key: p.pageId,
    title: p.pageName ?? 'Untitled Page',
    subtitle:
      provider === 'instagram' && p.instagramAccountId
        ? `Instagram account ${p.instagramAccountId} · Page ${p.pageId}`
        : `Page ID ${p.pageId}`,
    body: { pageId: p.pageId },
  }));
}

export function wabaChoices(selection: MetaOauthSelection): Choice[] {
  return selection.wabas.flatMap((w) =>
    w.phones.map((ph) => ({
      key: `${w.wabaId}:${ph.phoneNumberId}`,
      title: ph.displayPhoneNumber ?? ph.phoneNumberId,
      subtitle:
        [ph.verifiedName, w.wabaName ?? `WABA ${w.wabaId}`]
          .filter(Boolean)
          .join(' · ') || null,
      body: { wabaId: w.wabaId, phoneNumberId: ph.phoneNumberId },
    })),
  );
}

/** All pickable rows for a selection, whichever provider it came from. */
export function buildChoices(selection: MetaOauthSelection): Choice[] {
  return selection.provider === 'whatsapp'
    ? wabaChoices(selection)
    : pageChoices(selection.pages, selection.provider);
}
