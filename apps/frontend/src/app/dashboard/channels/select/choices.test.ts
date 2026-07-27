import { describe, expect, it } from 'vitest';
import type { MetaOauthSelection } from '@/lib/resources/channels';
import { buildChoices } from './choices';

/**
 * The picker exists so nothing is connected by guesswork. These tests pin the
 * two properties that make that true: every connectable asset gets its own row,
 * and each row carries EXACTLY the body the connect endpoint needs — so the
 * operator's click and the request that follows cannot drift apart.
 */

function selection(over: Partial<MetaOauthSelection>): MetaOauthSelection {
  return {
    id: 'sel-1',
    provider: 'facebook',
    expiresAt: '2026-07-27T12:00:00.000Z',
    pages: [],
    wabas: [],
    ...over,
  };
}

describe('buildChoices — Pages', () => {
  it('produces one row per Page, carrying only that pageId', () => {
    const choices = buildChoices(
      selection({
        pages: [
          { pageId: 'p1', pageName: 'Acme Bakery', instagramAccountId: null },
          { pageId: 'p2', pageName: 'Acme Coffee', instagramAccountId: null },
        ],
      }),
    );

    expect(choices).toHaveLength(2);
    expect(choices.map((c) => c.title)).toEqual(['Acme Bakery', 'Acme Coffee']);
    expect(choices.map((c) => c.body)).toEqual([
      { pageId: 'p1' },
      { pageId: 'p2' },
    ]);
    // No WhatsApp fields leak into a Page choice.
    expect(choices[0].body.wabaId).toBeUndefined();
    expect(choices[0].body.phoneNumberId).toBeUndefined();
  });

  it('falls back to a readable title when Meta gives no Page name', () => {
    const [choice] = buildChoices(
      selection({ pages: [{ pageId: 'p1', pageName: null, instagramAccountId: null }] }),
    );
    expect(choice.title).toBe('Untitled Page');
    expect(choice.subtitle).toContain('p1');
  });

  it('shows the Instagram account in the subtitle for the instagram flow', () => {
    const [choice] = buildChoices(
      selection({
        provider: 'instagram',
        pages: [{ pageId: 'p1', pageName: 'Acme', instagramAccountId: 'ig-1' }],
      }),
    );
    expect(choice.subtitle).toContain('ig-1');
    // The connect body is still keyed by the PAGE — the backend resolves the
    // linked Instagram account from it.
    expect(choice.body).toEqual({ pageId: 'p1' });
  });

  it('keys rows uniquely so two Pages never collapse into one', () => {
    const choices = buildChoices(
      selection({
        pages: [
          { pageId: 'p1', pageName: 'Same Name', instagramAccountId: null },
          { pageId: 'p2', pageName: 'Same Name', instagramAccountId: null },
        ],
      }),
    );
    expect(new Set(choices.map((c) => c.key)).size).toBe(2);
  });
});

describe('buildChoices — WhatsApp', () => {
  const twoWabas = selection({
    provider: 'whatsapp',
    wabas: [
      {
        wabaId: 'w1',
        wabaName: 'Acme Bakery Business',
        phones: [
          { phoneNumberId: 'ph1', displayPhoneNumber: '+1 555 0100', verifiedName: 'Bakery' },
          { phoneNumberId: 'ph2', displayPhoneNumber: '+1 555 0101', verifiedName: 'Support' },
        ],
      },
      {
        wabaId: 'w2',
        wabaName: 'Acme Coffee Business',
        phones: [
          { phoneNumberId: 'ph3', displayPhoneNumber: '+1 555 0200', verifiedName: 'Coffee' },
        ],
      },
    ],
  });

  it('produces one row per (WABA, number) PAIR, not one per business', () => {
    // The property that matters: a business with two numbers is two choices.
    // Collapsing to one row per WABA would put the guess back.
    const choices = buildChoices(twoWabas);
    expect(choices).toHaveLength(3);
    expect(choices.map((c) => c.body)).toEqual([
      { wabaId: 'w1', phoneNumberId: 'ph1' },
      { wabaId: 'w1', phoneNumberId: 'ph2' },
      { wabaId: 'w2', phoneNumberId: 'ph3' },
    ]);
  });

  it('always sends BOTH ids, so a number is never detached from its business', () => {
    for (const choice of buildChoices(twoWabas)) {
      expect(choice.body.wabaId).toBeTruthy();
      expect(choice.body.phoneNumberId).toBeTruthy();
      expect(choice.body.pageId).toBeUndefined();
    }
  });

  it('keys rows by the pair, so the same number under two WABAs stays distinct', () => {
    const choices = buildChoices(
      selection({
        provider: 'whatsapp',
        wabas: [
          { wabaId: 'w1', wabaName: null, phones: [{ phoneNumberId: 'same', displayPhoneNumber: null, verifiedName: null }] },
          { wabaId: 'w2', wabaName: null, phones: [{ phoneNumberId: 'same', displayPhoneNumber: null, verifiedName: null }] },
        ],
      }),
    );
    expect(new Set(choices.map((c) => c.key)).size).toBe(2);
  });

  it('labels a number by how a human recognises it', () => {
    const [choice] = buildChoices(twoWabas);
    expect(choice.title).toBe('+1 555 0100');
    expect(choice.subtitle).toContain('Bakery');
    expect(choice.subtitle).toContain('Acme Bakery Business');
  });

  it('falls back to the id when Meta returns no display number', () => {
    const [choice] = buildChoices(
      selection({
        provider: 'whatsapp',
        wabas: [
          {
            wabaId: 'w1',
            wabaName: null,
            phones: [{ phoneNumberId: 'ph9', displayPhoneNumber: null, verifiedName: null }],
          },
        ],
      }),
    );
    expect(choice.title).toBe('ph9');
    expect(choice.subtitle).toContain('w1');
  });

  it('yields nothing when a WABA has no usable numbers', () => {
    expect(
      buildChoices(
        selection({
          provider: 'whatsapp',
          wabas: [{ wabaId: 'w1', wabaName: 'Empty', phones: [] }],
        }),
      ),
    ).toEqual([]);
  });
});
