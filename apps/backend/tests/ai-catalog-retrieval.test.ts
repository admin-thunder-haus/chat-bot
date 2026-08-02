import { prisma } from './setup';
import { setupTenant, type Tenant } from './helpers';
import { aiRetrievalService } from '../src/modules/ai/ai-retrieval.service';
import { aiPromptService } from '../src/modules/ai/ai-prompt.service';
import { buildDefaultSettings } from '../src/modules/ai-settings/ai-settings.types';

/**
 * "What products do you have?" must return the products.
 *
 * Production incident: a company with seven real products was told
 * "Product A – 50 JOD, Product B – 30 JOD, Product C – 45 JOD". Retrieval had
 * returned an empty catalogue and the model filled the gap rather than
 * reporting it.
 *
 * The cause was not the term search failing — no product is called "products",
 * so that was always going to miss. It was the safety net: an empty result
 * triggers a catalogue fallback, but the check asked whether ANY category
 * matched, and one knowledge-base entry matching was enough to count. So the
 * question reached the model with a knowledge snippet and no catalogue at all,
 * which is the one shape that invites invention.
 */

let acme: Tenant;

beforeEach(async () => {
  acme = await setupTenant('acme');
  await prisma.product.createMany({
    data: [
      { companyId: acme.company.id, name: 'POS Terminal X1', price: '350', currency: 'JOD', sortOrder: 1 },
      { companyId: acme.company.id, name: 'Barcode Scanner B2', price: '45', currency: 'JOD', sortOrder: 2 },
    ],
  });
  await prisma.businessService.createMany({
    data: [
      { companyId: acme.company.id, name: 'Standard Consultation', price: '25', currency: 'JOD', sortOrder: 1 },
      { companyId: acme.company.id, name: 'AI Chatbot Setup', price: '300', currency: 'JOD', sortOrder: 2 },
    ],
  });
});

/** The exact shape that broke: something else matches, the catalogue does not. */
async function seedDistractingKnowledge(): Promise<void> {
  await prisma.knowledgeBaseEntry.create({
    data: {
      companyId: acme.company.id,
      title: 'Returns and refunds',
      // Must contain the word the question searches on ("products"), or this
      // seeds nothing: with no category matching, the old code fell back to the
      // catalogue and the bug never appeared. The entry matching is the whole
      // point — that is what used to suppress the fallback.
      content:
        'All products may be returned within fourteen days of purchase.',
      isActive: true,
    },
  });
}

describe('a catalogue question returns the catalogue', () => {
  it('reproduces the incident: a knowledge match no longer empties the catalogue', async () => {
    await seedDistractingKnowledge();

    const r = await aiRetrievalService.retrieve(
      acme.company.id,
      'What the products you have',
    );

    // The knowledge entry still matches on "have"/"you" — that is what used to
    // count as "something matched" and skip the fallback.
    expect(r.products.map((p) => p.name)).toEqual(
      expect.arrayContaining(['POS Terminal X1', 'Barcode Scanner B2']),
    );
  });

  it('answers the Arabic form too', async () => {
    await seedDistractingKnowledge();
    const r = await aiRetrievalService.retrieve(
      acme.company.id,
      'شو المنتجات عندكم؟',
    );
    expect(r.products.length).toBeGreaterThan(0);
  });

  it('returns both sides for a general "what do you offer"', async () => {
    await seedDistractingKnowledge();
    const r = await aiRetrievalService.retrieve(
      acme.company.id,
      'what do you offer?',
    );
    expect(r.products.length).toBeGreaterThan(0);
    expect(r.services.length).toBeGreaterThan(0);
  });

  it('fills only the empty side, keeping a real term match intact', async () => {
    // Asking about services by name must not drag in every product, but the
    // question is still a catalogue question, so the other side is offered.
    const r = await aiRetrievalService.retrieve(
      acme.company.id,
      'tell me about the AI Chatbot Setup service',
    );
    expect(r.services.map((s) => s.name)).toContain('AI Chatbot Setup');
    expect(r.services.map((s) => s.name)).not.toContain('Standard Consultation');
  });

  it('leaves non-catalogue questions alone', async () => {
    await seedDistractingKnowledge();
    const r = await aiRetrievalService.retrieve(
      acme.company.id,
      'what is your returns policy',
    );
    // A returns question is answered from knowledge; padding it with the whole
    // catalogue would just be noise.
    expect(r.knowledge.length).toBeGreaterThan(0);
    expect(r.products).toHaveLength(0);
  });

  it('reports an empty catalogue as empty rather than inventing one', async () => {
    const empty = await setupTenant('globex');
    const r = await aiRetrievalService.retrieve(
      empty.company.id,
      'what products do you have?',
    );
    expect(r.products).toHaveLength(0);
    expect(r.services).toHaveLength(0);
  });
});

describe('the prompt forbids filling an empty catalogue', () => {
  const p = aiPromptService.buildSystemPrompt({
    companyName: 'Acme',
    contextText: '(no company information available)',
    settings: buildDefaultSettings('c1'),
    injectionSuspected: false,
  });

  it('names the placeholder shapes it must never produce', () => {
    // "Never invent" was already there and was not enough — the exact failure
    // mode has to be named.
    expect(p).toMatch(/NEVER produce placeholder names/i);
    expect(p).toContain('"Product A"');
    expect(p).toMatch(/An empty catalogue is a fact to report, never a blank to fill/i);
  });

  it('requires every name written to appear verbatim in the context', () => {
    expect(p).toMatch(
      /Every product or service name you write must appear verbatim in COMPANY INFORMATION/i,
    );
  });
});
