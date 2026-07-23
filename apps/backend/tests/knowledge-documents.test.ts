import request from 'supertest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createApp } from '../src/app';
import { authHeader, setupTenant, type Tenant } from './helpers';
import { prisma } from './setup';
import { aiRetrievalService } from '../src/modules/ai/ai-retrieval.service';
import { chunkText } from '../src/modules/knowledge-documents/knowledge-documents.service';

/**
 * PDF knowledge documents: upload/extract/chunk, management, and retrieval
 * integration (uploaded content becomes AI-answerable).
 */

const app = createApp();
let acme: Tenant;
let globex: Tenant;

beforeEach(async () => {
  acme = await setupTenant('acme');
  globex = await setupTenant('globex');
});

/** Build a real one-page PDF containing the given lines of text. */
async function makePdf(lines: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  lines.forEach((line, i) => {
    page.drawText(line, { x: 50, y: 720 - i * 24, size: 12, font });
  });
  return Buffer.from(await doc.save());
}

function upload(token: string, files: { name: string; buffer: Buffer }[]) {
  const req = request(app).post('/api/v1/knowledge-documents').set(authHeader(token));
  for (const f of files) {
    req.attach('files', f.buffer, { filename: f.name, contentType: 'application/pdf' });
  }
  return req;
}

describe('POST /api/v1/knowledge-documents', () => {
  it('uploads multiple PDFs, extracts text, and chunks them', async () => {
    const warranty = await makePdf([
      'Warranty policy: all POS hardware includes a 24 month warranty.',
      'Extended warranty can be purchased within 30 days.',
    ]);
    const returns = await makePdf([
      'Return policy: unused products can be returned within 14 days.',
    ]);

    const res = await upload(acme.tokens.owner, [
      { name: 'warranty.pdf', buffer: warranty },
      { name: 'returns.pdf', buffer: returns },
    ]);

    expect(res.status).toBe(201);
    const docs = res.body.data.documents;
    expect(docs).toHaveLength(2);
    for (const doc of docs) {
      expect(doc.status).toBe('READY');
      expect(doc.pageCount).toBe(1);
      expect(doc.chunkCount).toBeGreaterThan(0);
      expect(doc.extractedCharacters).toBeGreaterThan(20);
      expect(doc.data).toBeUndefined();
    }
  });

  it('AGENT cannot upload; any role can list', async () => {
    const pdf = await makePdf(['hello']);
    const denied = await upload(acme.tokens.agent, [
      { name: 'x.pdf', buffer: pdf },
    ]);
    expect(denied.status).toBe(403);

    const list = await request(app)
      .get('/api/v1/knowledge-documents')
      .set(authHeader(acme.tokens.agent));
    expect(list.status).toBe(200);
  });

  it('rejects non-PDF files', async () => {
    const res = await request(app)
      .post('/api/v1/knowledge-documents')
      .set(authHeader(acme.tokens.owner))
      .attach('files', Buffer.from('not a pdf'), {
        filename: 'notes.txt',
        contentType: 'text/plain',
      });
    expect(res.status).toBe(400);
  });

  it('marks unreadable files as FAILED without crashing', async () => {
    const res = await request(app)
      .post('/api/v1/knowledge-documents')
      .set(authHeader(acme.tokens.owner))
      .attach('files', Buffer.from('%PDF-1.4 garbage'), {
        filename: 'broken.pdf',
        contentType: 'application/pdf',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.documents[0].status).toBe('FAILED');
    expect(res.body.data.documents[0].failureReason).toBeTruthy();
  });
});

describe('retrieval integration', () => {
  it('uploaded PDF content is retrievable for the AI', async () => {
    const pdf = await makePdf([
      'The premium subscription includes unlimited zorbification credits.',
    ]);
    await upload(acme.tokens.owner, [{ name: 'plans.pdf', buffer: pdf }]);

    const result = await aiRetrievalService.retrieve(
      acme.company.id,
      'do you offer zorbification credits?',
    );
    expect(result.documentChunks.length).toBeGreaterThan(0);
    expect(result.documentChunks[0].content).toContain('zorbification');
    expect(result.documentChunks[0].fileName).toBe('plans.pdf');
  });

  it('does not leak documents across tenants', async () => {
    const pdf = await makePdf(['Secret acme zorbification pricing.']);
    await upload(acme.tokens.owner, [{ name: 'secret.pdf', buffer: pdf }]);

    const result = await aiRetrievalService.retrieve(
      globex.company.id,
      'zorbification pricing',
    );
    expect(result.documentChunks).toHaveLength(0);
  });

  it('deactivated documents are excluded from retrieval', async () => {
    const pdf = await makePdf(['Legacy zorbification policy details.']);
    const uploaded = await upload(acme.tokens.owner, [
      { name: 'legacy.pdf', buffer: pdf },
    ]);
    const id = uploaded.body.data.documents[0].id as string;

    await request(app)
      .patch(`/api/v1/knowledge-documents/${id}/status`)
      .set(authHeader(acme.tokens.owner))
      .send({ isActive: false });

    const result = await aiRetrievalService.retrieve(
      acme.company.id,
      'zorbification policy',
    );
    expect(result.documentChunks).toHaveLength(0);
  });
});

describe('management', () => {
  it('replace swaps content and re-extracts', async () => {
    const original = await makePdf(['Original glimfrost terms.']);
    const uploaded = await upload(acme.tokens.owner, [
      { name: 'terms.pdf', buffer: original },
    ]);
    const id = uploaded.body.data.documents[0].id as string;

    const replacement = await makePdf(['Updated blorvane conditions.']);
    const res = await request(app)
      .post(`/api/v1/knowledge-documents/${id}/replace`)
      .set(authHeader(acme.tokens.owner))
      .attach('files', replacement, {
        filename: 'terms-v2.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.document.fileName).toBe('terms-v2.pdf');
    expect(res.body.data.document.status).toBe('READY');

    const old = await aiRetrievalService.retrieve(acme.company.id, 'glimfrost terms');
    expect(old.documentChunks).toHaveLength(0);
    const fresh = await aiRetrievalService.retrieve(acme.company.id, 'blorvane conditions');
    expect(fresh.documentChunks.length).toBeGreaterThan(0);
  });

  it('delete removes the document and its chunks', async () => {
    const pdf = await makePdf(['Disposable snarfblat manual.']);
    const uploaded = await upload(acme.tokens.owner, [
      { name: 'manual.pdf', buffer: pdf },
    ]);
    const id = uploaded.body.data.documents[0].id as string;

    const del = await request(app)
      .delete(`/api/v1/knowledge-documents/${id}`)
      .set(authHeader(acme.tokens.owner));
    expect(del.status).toBe(200);

    const chunks = await prisma.knowledgeDocumentChunk.count({
      where: { documentId: id },
    });
    expect(chunks).toBe(0);

    const foreign = await request(app)
      .delete(`/api/v1/knowledge-documents/${id}`)
      .set(authHeader(globex.tokens.owner));
    expect(foreign.status).toBe(404);
  });

  it('download returns the original bytes', async () => {
    const pdf = await makePdf(['Download me.']);
    const uploaded = await upload(acme.tokens.owner, [
      { name: 'dl.pdf', buffer: pdf },
    ]);
    const id = uploaded.body.data.documents[0].id as string;

    const res = await request(app)
      .get(`/api/v1/knowledge-documents/${id}/download`)
      .set(authHeader(acme.tokens.owner))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c) => chunks.push(c as Buffer));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(Buffer.compare(res.body as Buffer, pdf)).toBe(0);
  });
});

describe('chunkText', () => {
  it('splits long text into overlapping chunks under the size cap', () => {
    const text = Array.from({ length: 200 })
      .map((_, i) => `Sentence number ${i} about warranties and returns.`)
      .join(' ');
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1500);
  });

  it('returns empty for whitespace-only text', () => {
    expect(chunkText('   \n\n  ')).toEqual([]);
  });
});
