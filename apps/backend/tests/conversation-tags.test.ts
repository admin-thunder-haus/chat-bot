import request from 'supertest';
import { createApp } from '../src/app';
import {
  setupTenant,
  authHeader,
  makeCustomer,
  makeConversation,
  type Tenant,
} from './helpers';

const app = createApp();
let acme: Tenant;
let globex: Tenant;

beforeEach(async () => {
  acme = await setupTenant('acme');
  globex = await setupTenant('globex');
});

function createTag(token: string, body: Record<string, unknown>) {
  return request(app)
    .post('/api/v1/conversation-tags')
    .set(authHeader(token))
    .send(body);
}

async function acmeConversation() {
  const customer = await makeCustomer(acme.company.id);
  return makeConversation(acme.company.id, customer.id);
}

describe('Conversation tags', () => {
  it('OWNER/ADMIN create tags; AGENT cannot', async () => {
    expect((await createTag(acme.tokens.owner, { name: 'Sales' })).status).toBe(201);
    expect((await createTag(acme.tokens.admin, { name: 'Support' })).status).toBe(201);
    expect((await createTag(acme.tokens.agent, { name: 'Nope' })).status).toBe(403);
  });

  it('rejects a duplicate tag name within a company but allows it in another', async () => {
    await createTag(acme.tokens.owner, { name: 'VIP' });
    expect((await createTag(acme.tokens.owner, { name: 'VIP' })).status).toBe(409);
    expect((await createTag(globex.tokens.owner, { name: 'VIP' })).status).toBe(201);
  });

  it('validates hex color', async () => {
    expect(
      (await createTag(acme.tokens.owner, { name: 'Bad', color: 'red' })).status,
    ).toBe(400);
    expect(
      (await createTag(acme.tokens.owner, { name: 'Good', color: '#33aaff' }))
        .status,
    ).toBe(201);
  });

  it('AGENT can attach and detach existing tags', async () => {
    const tag = await createTag(acme.tokens.owner, { name: 'Urgent' });
    const tagId = tag.body.data.tag.id;
    const conv = await acmeConversation();

    const attach = await request(app)
      .post(`/api/v1/conversations/${conv.id}/tags/${tagId}`)
      .set(authHeader(acme.tokens.agent));
    expect(attach.status).toBe(200);
    expect(attach.body.data.tags.length).toBe(1);

    // Idempotent re-attach.
    const attachAgain = await request(app)
      .post(`/api/v1/conversations/${conv.id}/tags/${tagId}`)
      .set(authHeader(acme.tokens.agent));
    expect(attachAgain.body.data.tags.length).toBe(1);

    const detach = await request(app)
      .delete(`/api/v1/conversations/${conv.id}/tags/${tagId}`)
      .set(authHeader(acme.tokens.agent));
    expect(detach.body.data.tags.length).toBe(0);
  });

  it('cannot attach another tenant’s tag or tag another tenant’s conversation', async () => {
    const acmeTag = await createTag(acme.tokens.owner, { name: 'A' });
    const conv = await acmeConversation();

    // Globex user tagging acme conversation -> 404.
    expect(
      (
        await request(app)
          .post(`/api/v1/conversations/${conv.id}/tags/${acmeTag.body.data.tag.id}`)
          .set(authHeader(globex.tokens.owner))
      ).status,
    ).toBe(404);

    // Acme conversation + globex tag -> 404 (tag not in acme).
    const globexTag = await createTag(globex.tokens.owner, { name: 'B' });
    expect(
      (
        await request(app)
          .post(`/api/v1/conversations/${conv.id}/tags/${globexTag.body.data.tag.id}`)
          .set(authHeader(acme.tokens.owner))
      ).status,
    ).toBe(404);
  });

  it('deletes a tag and removes its assignments', async () => {
    const tag = await createTag(acme.tokens.owner, { name: 'Temp' });
    const tagId = tag.body.data.tag.id;
    const conv = await acmeConversation();
    await request(app)
      .post(`/api/v1/conversations/${conv.id}/tags/${tagId}`)
      .set(authHeader(acme.tokens.owner));

    const del = await request(app)
      .delete(`/api/v1/conversation-tags/${tagId}`)
      .set(authHeader(acme.tokens.owner));
    expect(del.status).toBe(200);

    const detail = await request(app)
      .get(`/api/v1/conversations/${conv.id}`)
      .set(authHeader(acme.tokens.owner));
    expect(detail.body.data.conversation.tagAssignments.length).toBe(0);
  });
});
