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

async function acmeConversation() {
  const customer = await makeCustomer(acme.company.id);
  return makeConversation(acme.company.id, customer.id);
}

function addNote(token: string, convId: string, content: string) {
  return request(app)
    .post(`/api/v1/conversations/${convId}/notes`)
    .set(authHeader(token))
    .send({ content });
}

describe('Internal notes', () => {
  it('adds a note and records NOTE_ADDED activity', async () => {
    const conv = await acmeConversation();
    const res = await addNote(acme.tokens.agent, conv.id, 'Call back tomorrow');
    expect(res.status).toBe(201);

    const activity = await request(app)
      .get(`/api/v1/conversations/${conv.id}/activity`)
      .set(authHeader(acme.tokens.owner));
    const types = activity.body.data.activities.map(
      (a: { activityType: string }) => a.activityType,
    );
    expect(types).toContain('NOTE_ADDED');
  });

  it('never exposes notes through the messages endpoint', async () => {
    const conv = await acmeConversation();
    await addNote(acme.tokens.owner, conv.id, 'Secret internal note');
    const messages = await request(app)
      .get(`/api/v1/conversations/${conv.id}/messages`)
      .set(authHeader(acme.tokens.owner));
    expect(messages.body.data.items.length).toBe(0);
  });

  it('lets an author edit their own note', async () => {
    const conv = await acmeConversation();
    const note = await addNote(acme.tokens.agent, conv.id, 'draft');
    const res = await request(app)
      .patch(`/api/v1/conversations/${conv.id}/notes/${note.body.data.note.id}`)
      .set(authHeader(acme.tokens.agent))
      .send({ content: 'final' });
    expect(res.status).toBe(200);
    expect(res.body.data.note.content).toBe('final');
  });

  it('prevents an AGENT from editing another user’s note', async () => {
    const conv = await acmeConversation();
    const note = await addNote(acme.tokens.owner, conv.id, 'owner note');
    const res = await request(app)
      .patch(`/api/v1/conversations/${conv.id}/notes/${note.body.data.note.id}`)
      .set(authHeader(acme.tokens.agent))
      .send({ content: 'hijack' });
    expect(res.status).toBe(403);
  });

  it('lets OWNER/ADMIN manage any note', async () => {
    const conv = await acmeConversation();
    const note = await addNote(acme.tokens.agent, conv.id, 'agent note');
    const noteId = note.body.data.note.id;

    const edit = await request(app)
      .patch(`/api/v1/conversations/${conv.id}/notes/${noteId}`)
      .set(authHeader(acme.tokens.owner))
      .send({ content: 'edited by owner' });
    expect(edit.status).toBe(200);

    const del = await request(app)
      .delete(`/api/v1/conversations/${conv.id}/notes/${noteId}`)
      .set(authHeader(acme.tokens.admin));
    expect(del.status).toBe(200);
  });

  it('is tenant-isolated', async () => {
    const conv = await acmeConversation();
    expect(
      (
        await request(app)
          .get(`/api/v1/conversations/${conv.id}/notes`)
          .set(authHeader(globex.tokens.owner))
      ).status,
    ).toBe(404);
    expect((await addNote(globex.tokens.owner, conv.id, 'x')).status).toBe(404);
  });
});
