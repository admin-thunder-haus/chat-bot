import {
  whatsAppApiClient,
  setWhatsAppTransportForTesting,
  type WhatsAppTransport,
  type WhatsAppHttpRequest,
} from '../src/modules/channels/providers/whatsapp';

/**
 * Registering the business phone number for Cloud API use.
 *
 * Meta requires three things after Embedded Signup — exchange the code,
 * subscribe the app to the WABA's webhooks, and REGISTER the number. Only the
 * first two were done, and the missing one fails in the worst possible way:
 * connecting succeeds, the health check passes because it only proves the token
 * works, and then every single send fails. Nothing in the dashboard points at
 * the cause.
 */

function transport(
  respond: (input: WhatsAppHttpRequest) => {
    status: number;
    ok: boolean;
    json: unknown;
  },
): { transport: WhatsAppTransport; calls: WhatsAppHttpRequest[] } {
  const calls: WhatsAppHttpRequest[] = [];
  return {
    calls,
    transport: {
      async request(input) {
        calls.push(input);
        return respond(input);
      },
    },
  };
}

afterEach(() => setWhatsAppTransportForTesting(null));

describe('registerPhoneNumber', () => {
  it('posts the documented body to the number\'s register node', async () => {
    const t = transport(() => ({ status: 200, ok: true, json: { success: true } }));
    setWhatsAppTransportForTesting(t.transport);

    const res = await whatsAppApiClient.registerPhoneNumber({
      accessToken: 'tok',
      phoneNumberId: '1029384756',
      pin: '123456',
    });

    expect(res.ok).toBe(true);
    const call = t.calls[0];
    expect(call.method).toBe('POST');
    expect(call.url).toContain('/1029384756/register');
    expect(call.body).toEqual({ messaging_product: 'whatsapp', pin: '123456' });
  });

  it('treats an already-registered number as success', async () => {
    // Reconnecting a working number must not look like a failure.
    const t = transport(() => ({
      status: 400,
      ok: false,
      json: {
        error: {
          message: 'Phone number already registered',
          error_subcode: 2388009,
        },
      },
    }));
    setWhatsAppTransportForTesting(t.transport);

    const res = await whatsAppApiClient.registerPhoneNumber({
      accessToken: 'tok',
      phoneNumberId: '1',
      pin: '000000',
    });
    expect(res.ok).toBe(true);
    expect(res.alreadyRegistered).toBe(true);
  });

  it('reports a genuine failure instead of throwing', async () => {
    // A number whose two-step PIN is already set to something else lands here.
    const t = transport(() => ({
      status: 400,
      ok: false,
      json: { error: { message: 'Incorrect PIN', error_subcode: 2388010 } },
    }));
    setWhatsAppTransportForTesting(t.transport);

    const res = await whatsAppApiClient.registerPhoneNumber({
      accessToken: 'tok',
      phoneNumberId: '1',
      pin: '000000',
    });
    expect(res.ok).toBe(false);
    expect(res.detail).toBeTruthy();
  });

  it('never throws on a network failure', async () => {
    setWhatsAppTransportForTesting({
      async request() {
        throw new Error('socket hang up');
      },
    });
    const res = await whatsAppApiClient.registerPhoneNumber({
      accessToken: 'tok',
      phoneNumberId: '1',
      pin: '000000',
    });
    expect(res).toEqual({ ok: false, detail: 'NETWORK' });
  });

  it('never puts the access token in the URL', async () => {
    const t = transport(() => ({ status: 200, ok: true, json: {} }));
    setWhatsAppTransportForTesting(t.transport);
    await whatsAppApiClient.registerPhoneNumber({
      accessToken: 'super-secret-token',
      phoneNumberId: '1',
      pin: '000000',
    });
    expect(t.calls[0].url).not.toContain('super-secret-token');
    expect(t.calls[0].accessToken).toBe('super-secret-token');
  });
});
