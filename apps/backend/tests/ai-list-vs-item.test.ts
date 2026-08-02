import { aiContextService } from '../src/modules/ai/ai-context.service';
import { aiPromptService } from '../src/modules/ai/ai-prompt.service';
import { buildDefaultSettings } from '../src/modules/ai-settings/ai-settings.types';
import type { RetrievalResult } from '../src/modules/ai/ai-retrieval.service';

/**
 * A list is text; one item gets the photo.
 *
 * A message carries at most one photo, so a five-line price list used to ship
 * with a picture of whichever name happened to score best. That reads as "this
 * one is the answer" and leaves the customer wondering why the other four have
 * none. The honest attachment for a list is nothing — the customer names what
 * they want to see, and THAT reply carries the photo.
 *
 * The hard part is telling a list from a single item without stripping photos
 * off replies that deserve one, which is what the shared-token cases below pin.
 */

function retrieval(over: Partial<RetrievalResult>): RetrievalResult {
  return {
    services: [],
    products: [],
    faqs: [],
    knowledge: [],
    documents: [],
    usedFallback: false,
    ...over,
  } as RetrievalResult;
}

let seq = 0;
function svc(name: string, imageUrl: string | null = 'https://img.test/s.png') {
  seq += 1;
  return {
    id: `svc-${seq}-${name}`,
    companyId: 'c1',
    name,
    description: null,
    price: null,
    currency: 'JOD',
    durationMinutes: null,
    imageUrl,
    isActive: true,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as RetrievalResult['services'][number];
}

function prod(name: string, imageUrl: string | null = 'https://img.test/p.png') {
  seq += 1;
  return {
    id: `prd-${seq}-${name}`,
    companyId: 'c1',
    name,
    description: null,
    sku: null,
    category: null,
    price: null,
    currency: 'JOD',
    stockQuantity: null,
    imageUrl,
    isActive: true,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as RetrievalResult['products'][number];
}

describe('a reply listing several items carries no photo', () => {
  it('drops the attachment when two names are spelled out in full', () => {
    const r = retrieval({
      services: [svc('Premium Wash'), svc('Engine Detail')],
    });
    expect(
      aiContextService.findRecommendedAttachment(
        'We offer Premium Wash and Engine Detail.',
        r,
      ),
    ).toBeNull();
  });

  it('drops it for a bulleted list even when the names are translated', () => {
    // The whole-name count cannot see an Arabic rendering of an English name,
    // so the bullet layout is the second, independent signal.
    const r = retrieval({
      services: [svc('Premium Wash'), svc('Engine Detail')],
    });
    expect(
      aiContextService.findRecommendedAttachment(
        'خدماتنا:\n• غسيل ممتاز – 10 دينار\n• تنظيف محرك – 15 دينار',
        r,
      ),
    ).toBeNull();
  });

  it('drops it when a listed item has no image of its own', () => {
    // Otherwise the one item that happens to have a photo illustrates the
    // whole list, which is exactly the confusing outcome.
    const r = retrieval({
      services: [svc('Premium Wash'), svc('Engine Detail', null)],
    });
    expect(
      aiContextService.findRecommendedAttachment(
        'We offer Premium Wash and Engine Detail.',
        r,
      ),
    ).toBeNull();
  });

  it('drops it across a mixed services-and-products list', () => {
    const r = retrieval({
      services: [svc('Premium Wash')],
      products: [prod('Car Shampoo')],
    });
    expect(
      aiContextService.findRecommendedAttachment(
        'Services:\n• Premium Wash – 10 JOD\n\nProducts:\n• Car Shampoo – 4 JOD',
        r,
      ),
    ).toBeNull();
  });
});

describe('a reply about ONE item still carries its photo', () => {
  it('attaches when only one name is spelled out', () => {
    const r = retrieval({ services: [svc('Premium Wash'), svc('Engine Detail')] });
    const hit = aiContextService.findRecommendedAttachment(
      'Premium Wash is 10 JOD and takes about 30 minutes.',
      r,
    );
    expect(hit?.sourceName).toBe('Premium Wash');
  });

  it('is not fooled by another item sharing a word', () => {
    // Regression: counting any token overlap as a second item stripped the
    // photo here, because "Basic Wash" shares "wash" with the named service.
    const r = retrieval({
      services: [svc('Basic Wash', null), svc('Premium Wash')],
    });
    const hit = aiContextService.findRecommendedAttachment(
      'I recommend our Premium Wash for that.',
      r,
    );
    expect(hit?.sourceName).toBe('Premium Wash');
  });

  it('still attaches on a partial, translated mention', () => {
    // No whole-name match at all here, so the list checks must not fire.
    const r = retrieval({ products: [prod('CRM Pro License')] });
    const hit = aiContextService.findRecommendedAttachment(
      'سعر ترخيص CRM Pro هو 120 دينار أردني.',
      r,
    );
    expect(hit?.sourceName).toBe('CRM Pro License');
  });

  it('treats a single bullet as detail, not a list', () => {
    const r = retrieval({ services: [svc('Premium Wash')] });
    const hit = aiContextService.findRecommendedAttachment(
      'Premium Wash – 10 JOD\n• includes interior vacuum',
      r,
    );
    expect(hit?.sourceName).toBe('Premium Wash');
  });
});

describe('countNamedItems separates "named nothing" from "named several"', () => {
  it('is 0 when the reply names none of them', () => {
    const r = retrieval({ services: [svc('Premium Wash')] });
    expect(
      aiContextService.countNamedItems('We are open until 8pm.', r),
    ).toBe(0);
  });

  it('is non-zero once something is named, so no photo is guessed', () => {
    // The guess exists for replies that name nothing matchable. Guessing on a
    // list would illustrate it with one of its own rows.
    const r = retrieval({
      services: [svc('Premium Wash'), svc('Engine Detail')],
    });
    expect(
      aiContextService.countNamedItems(
        'We offer Premium Wash and Engine Detail.',
        r,
      ),
    ).toBeGreaterThan(0);
  });
});

describe('the prompt asks for the layout this logic assumes', () => {
  const p = aiPromptService.buildSystemPrompt({
    companyName: 'Acme',
    contextText: 'Services: Premium Wash – 10 JOD.',
    settings: buildDefaultSettings('c1'),
    injectionSuspected: false,
  });

  it('requires bare "Name – Price" lines in a list', () => {
    expect(p).toMatch(/LISTING SEVERAL ITEMS/);
    expect(p).toMatch(/NOTHING after the price/i);
  });

  it('names the copying it has to stop, not just the outcome', () => {
    // "No descriptions" alone lost to the example in the context, which lists
    // every item as "Name – Price – Description"; the model reproduced that
    // line and a six-item menu arrived as six paragraphs. Verified fixed
    // against gpt-4o-mini.
    expect(p).toMatch(
      /do NOT copy the description that follows the price in COMPANY INFORMATION/i,
    );
    expect(p).toMatch(/Stop at the price/i);
  });

  it('requires services and products to be grouped', () => {
    expect(p).toMatch(/Group them under a "Services:" line and a "Products:" line/i);
  });

  it('requires full detail for a single item', () => {
    expect(p).toMatch(/ONE ITEM \(the customer asked about a specific/i);
    expect(p).toMatch(/then what it includes on its own short lines/i);
  });

  it('tells the model a list is text-only, so it stops promising photos', () => {
    expect(p).toMatch(/A reply that lists several items is sent as text only/i);
    expect(p).toMatch(/invite the customer to name the one they want to see/i);
  });
});
