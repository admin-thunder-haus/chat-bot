'use client';

import { useState } from 'react';
import { Alert, Button, Input, Label, Select } from '@/components/ui';
import { mockInboundApi, type MockInboundResult } from '@/lib/resources';
import { parseApiError } from '@/lib/form';
import type { ChannelType } from '@/lib/types';

export function MockInboundForm({
  onSuccess,
}: {
  onSuccess: (result: MockInboundResult) => void;
}) {
  const [channelType, setChannelType] = useState<ChannelType>('MANUAL');
  const [externalCustomerId, setExternalCustomerId] = useState('demo-customer-001');
  const [externalMessageId, setExternalMessageId] = useState('');
  const [fullName, setFullName] = useState('Ahmad Ali');
  const [phone, setPhone] = useState('+962790000000');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [content, setContent] = useState('Hello, I want to know your prices.');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = await mockInboundApi.send({
        channelType,
        externalCustomerId: externalCustomerId.trim(),
        customer: {
          fullName: fullName.trim() || undefined,
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
          username: username.trim() || undefined,
        },
        message: {
          // Default a unique-ish id if left blank so repeated tests differ.
          externalMessageId:
            externalMessageId.trim() || `mock-${externalCustomerId}-${content.length}`,
          content: content.trim(),
        },
      });
      onSuccess(result);
    } catch (err) {
      setError(parseApiError(err).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert message={error} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="mi-channel">Channel</Label>
          <Select
            id="mi-channel"
            value={channelType}
            onChange={(e) => setChannelType(e.target.value as ChannelType)}
          >
            <option value="MANUAL">Manual</option>
            <option value="WEBCHAT">Web chat</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="mi-extcust">External customer ID</Label>
          <Input
            id="mi-extcust"
            value={externalCustomerId}
            onChange={(e) => setExternalCustomerId(e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="mi-name">Customer name</Label>
          <Input id="mi-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="mi-phone">Phone</Label>
          <Input id="mi-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="mi-email">Email</Label>
          <Input id="mi-email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="mi-username">Username</Label>
          <Input
            id="mi-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="mi-extmsg">External message ID</Label>
          <Input
            id="mi-extmsg"
            value={externalMessageId}
            placeholder="auto-generated if blank"
            onChange={(e) => setExternalMessageId(e.target.value)}
          />
        </div>
      </div>
      <div>
        <Label htmlFor="mi-content">Message</Label>
        <textarea
          id="mi-content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={3}
          required
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900"
        />
      </div>
      <Button type="submit" loading={busy} disabled={!content.trim() || !externalCustomerId.trim()}>
        Send mock inbound message
      </Button>
    </form>
  );
}
