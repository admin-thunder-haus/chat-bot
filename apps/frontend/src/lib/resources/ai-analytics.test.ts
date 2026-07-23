import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiApi } from './ai';
import { analyticsApi } from './analytics';
import { documentsApi } from './knowledge-documents';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubFetch(data: unknown) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(jsonResponse(200, { success: true, message: 'ok', data }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('aiApi.suggestions', () => {
  it('POSTs the count to the conversation suggestions endpoint', async () => {
    const fetchMock = stubFetch({ generationId: 'g1', suggestions: ['a', 'b'] });

    const res = await aiApi.suggestions('c1', 2);

    expect(res.suggestions).toEqual(['a', 'b']);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/conversations/c1/ai/suggestions');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ count: 2 }));
  });
});

describe('aiApi.summarize', () => {
  it('POSTs to the conversation summary endpoint and unwraps the result', async () => {
    const fetchMock = stubFetch({
      summary: 'Short recap.',
      generatedAt: '2026-07-23T10:00:00.000Z',
    });

    const res = await aiApi.summarize('c9');

    expect(res.summary).toBe('Short recap.');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/conversations/c9/summary');
    expect(init.method).toBe('POST');
  });
});

describe('analyticsApi.ai', () => {
  it('GETs the analytics endpoint with the days query', async () => {
    const fetchMock = stubFetch({ rangeDays: 30 });

    const res = await analyticsApi.ai(30);

    expect(res).toEqual({ rangeDays: 30 });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('/analytics/ai?days=30');
  });
});

describe('documentsApi.upload', () => {
  it('sends every file under a repeated "files" multipart field', async () => {
    const fetchMock = stubFetch({ documents: [] });

    const files = [
      new File(['a'], 'a.pdf', { type: 'application/pdf' }),
      new File(['b'], 'b.pdf', { type: 'application/pdf' }),
    ];
    await documentsApi.upload(files);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/knowledge-documents');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    const sent = (init.body as FormData).getAll('files');
    expect(sent).toHaveLength(2);
    expect((sent[0] as File).name).toBe('a.pdf');
    expect((sent[1] as File).name).toBe('b.pdf');
    // FormData bodies must not get a JSON Content-Type.
    expect(init.headers['Content-Type']).toBeUndefined();
  });
});

describe('documentsApi.replace', () => {
  it('sends the single replacement file as multipart "files"', async () => {
    const fetchMock = stubFetch({ document: { id: 'd1' } });

    await documentsApi.replace('d1', new File(['x'], 'new.pdf'));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/knowledge-documents/d1/replace');
    const sent = (init.body as FormData).getAll('files');
    expect(sent).toHaveLength(1);
    expect((sent[0] as File).name).toBe('new.pdf');
  });
});
