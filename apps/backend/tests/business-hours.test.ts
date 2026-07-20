import request from 'supertest';
import { createApp } from '../src/app';
import { setupTenant, authHeader, type Tenant } from './helpers';

const app = createApp();
let acme: Tenant;
let globex: Tenant;

beforeEach(async () => {
  acme = await setupTenant('acme');
  globex = await setupTenant('globex');
});

const fullWeek = {
  hours: [
    { dayOfWeek: 'MONDAY', isClosed: false, openTime: '09:00', closeTime: '17:00' },
    { dayOfWeek: 'TUESDAY', isClosed: false, openTime: '09:00', closeTime: '17:00' },
    { dayOfWeek: 'WEDNESDAY', isClosed: false, openTime: '09:00', closeTime: '17:00' },
    { dayOfWeek: 'THURSDAY', isClosed: false, openTime: '09:00', closeTime: '17:00' },
    { dayOfWeek: 'FRIDAY', isClosed: true, openTime: null, closeTime: null },
    { dayOfWeek: 'SATURDAY', isClosed: true, openTime: null, closeTime: null },
    { dayOfWeek: 'SUNDAY', isClosed: false, openTime: '10:00', closeTime: '14:00' },
  ],
};

function putSchedule(token: string, body: object) {
  return request(app)
    .put('/api/v1/business-hours')
    .set(authHeader(token))
    .send(body);
}

describe('Business hours', () => {
  it('GET returns all 7 days (defaults to closed) initially', async () => {
    const res = await request(app)
      .get('/api/v1/business-hours')
      .set(authHeader(acme.tokens.owner));
    expect(res.status).toBe(200);
    expect(res.body.data.hours.length).toBe(7);
    expect(res.body.data.hours[0].dayOfWeek).toBe('MONDAY');
    expect(res.body.data.hours[6].dayOfWeek).toBe('SUNDAY');
  });

  it('OWNER can save a full weekly schedule', async () => {
    const res = await putSchedule(acme.tokens.owner, fullWeek);
    expect(res.status).toBe(200);
    expect(res.body.data.hours.length).toBe(7);
    const friday = res.body.data.hours.find(
      (h: { dayOfWeek: string }) => h.dayOfWeek === 'FRIDAY',
    );
    expect(friday.isClosed).toBe(true);
    expect(friday.openTime).toBeNull();
  });

  it('rejects an invalid time format', async () => {
    const res = await putSchedule(acme.tokens.owner, {
      hours: [
        { dayOfWeek: 'MONDAY', isClosed: false, openTime: '9am', closeTime: '17:00' },
      ],
    });
    expect(res.status).toBe(400);
  });

  it('rejects close time before open time', async () => {
    const res = await putSchedule(acme.tokens.owner, {
      hours: [
        { dayOfWeek: 'MONDAY', isClosed: false, openTime: '18:00', closeTime: '09:00' },
      ],
    });
    expect(res.status).toBe(400);
  });

  it('rejects a closed day that has times', async () => {
    const res = await putSchedule(acme.tokens.owner, {
      hours: [
        { dayOfWeek: 'MONDAY', isClosed: true, openTime: '09:00', closeTime: '17:00' },
      ],
    });
    expect(res.status).toBe(400);
  });

  it('rejects an open day missing times', async () => {
    const res = await putSchedule(acme.tokens.owner, {
      hours: [{ dayOfWeek: 'MONDAY', isClosed: false }],
    });
    expect(res.status).toBe(400);
  });

  it('rejects duplicate days in the same request', async () => {
    const res = await putSchedule(acme.tokens.owner, {
      hours: [
        { dayOfWeek: 'MONDAY', isClosed: false, openTime: '09:00', closeTime: '17:00' },
        { dayOfWeek: 'MONDAY', isClosed: true, openTime: null, closeTime: null },
      ],
    });
    expect(res.status).toBe(400);
  });

  it('AGENT cannot update the schedule', async () => {
    const res = await putSchedule(acme.tokens.agent, fullWeek);
    expect(res.status).toBe(403);
  });

  it('can update a single day via PATCH', async () => {
    const res = await request(app)
      .patch('/api/v1/business-hours/MONDAY')
      .set(authHeader(acme.tokens.owner))
      .send({ isClosed: false, openTime: '08:00', closeTime: '12:00' });
    expect(res.status).toBe(200);
    expect(res.body.data.day.openTime).toBe('08:00');
  });

  it('rejects an invalid day param', async () => {
    const res = await request(app)
      .patch('/api/v1/business-hours/FUNDAY')
      .set(authHeader(acme.tokens.owner))
      .send({ isClosed: true, openTime: null, closeTime: null });
    expect(res.status).toBe(400);
  });

  it('isolates schedules between tenants', async () => {
    await putSchedule(acme.tokens.owner, fullWeek);
    const res = await request(app)
      .get('/api/v1/business-hours')
      .set(authHeader(globex.tokens.owner));
    // Globex never configured hours -> all closed defaults.
    expect(res.body.data.hours.every((h: { isClosed: boolean }) => h.isClosed)).toBe(
      true,
    );
  });
});
