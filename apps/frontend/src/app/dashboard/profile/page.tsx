'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { canWrite } from '@/lib/permissions';
import { companyApi } from '@/lib/resources';
import { parseApiError } from '@/lib/form';
import { useToast } from '@/components/toast';
import type { Company } from '@/lib/types';
import {
  Alert,
  Button,
  FieldError,
  Input,
  Label,
  PageHeader,
  Panel,
  Skeleton,
  Textarea,
} from '@/components/ui';

type FormState = {
  name: string;
  displayName: string;
  description: string;
  industry: string;
  email: string;
  phone: string;
  whatsappNumber: string;
  websiteUrl: string;
  address: string;
  city: string;
  country: string;
  timezone: string;
  defaultLanguage: string;
  responseLanguage: string;
};

function toForm(c: Company): FormState {
  return {
    name: c.name ?? '',
    displayName: c.displayName ?? '',
    description: c.description ?? '',
    industry: c.industry ?? '',
    email: c.email ?? '',
    phone: c.phone ?? '',
    whatsappNumber: c.whatsappNumber ?? '',
    websiteUrl: c.websiteUrl ?? '',
    address: c.address ?? '',
    city: c.city ?? '',
    country: c.country ?? '',
    timezone: c.timezone ?? '',
    defaultLanguage: c.defaultLanguage ?? '',
    responseLanguage: c.responseLanguage ?? '',
  };
}

export default function ProfilePage() {
  const { user } = useAuth();
  const { notify } = useToast();
  const readOnly = !canWrite(user?.role);

  const [form, setForm] = useState<FormState | null>(null);
  const [initial, setInitial] = useState<FormState | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    companyApi
      .getProfile()
      .then(({ company }) => {
        if (!active) return;
        setForm(toForm(company));
        setInitial(toForm(company));
      })
      .catch((err) => active && setError(parseApiError(err).message));
    return () => {
      active = false;
    };
  }, []);

  const dirty = form && initial && JSON.stringify(form) !== JSON.stringify(initial);

  function update(key: keyof FormState, value: string) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError('');
    setFieldErrors({});

    if (form.name.trim().length < 2) {
      setFieldErrors({ name: 'Name must be at least 2 characters' });
      return;
    }

    setSaving(true);
    try {
      const { company } = await companyApi.updateProfile(form);
      setForm(toForm(company));
      setInitial(toForm(company));
      notify('Profile saved', 'success');
    } catch (err) {
      const parsed = parseApiError(err);
      setError(parsed.message);
      setFieldErrors(parsed.fieldErrors);
    } finally {
      setSaving(false);
    }
  }

  if (!form) {
    return (
      <div>
        <PageHeader title="Company Profile" />
        <Panel>
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        </Panel>
      </div>
    );
  }

  const textField = (
    key: keyof FormState,
    label: string,
    opts: { required?: boolean; type?: string; placeholder?: string } = {},
  ) => (
    <div>
      <Label htmlFor={key} required={opts.required}>
        {label}
      </Label>
      <Input
        id={key}
        type={opts.type ?? 'text'}
        value={form[key]}
        placeholder={opts.placeholder}
        disabled={readOnly || saving}
        onChange={(e) => update(key, e.target.value)}
      />
      <FieldError message={fieldErrors[key]} />
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Company Profile"
        description="Details about your business the assistant can reference."
        actions={
          !readOnly ? (
            <Button
              type="submit"
              form="profile-form"
              loading={saving}
              disabled={!dirty}
            >
              Save changes
            </Button>
          ) : undefined
        }
      />

      {readOnly && (
        <div className="mb-4">
          <Alert variant="info" message="You have read-only access to this page." />
        </div>
      )}
      {error && (
        <div className="mb-4">
          <Alert message={error} />
        </div>
      )}
      {dirty && !readOnly && (
        <div className="mb-4">
          <Alert variant="warning" message="You have unsaved changes." />
        </div>
      )}

      <form id="profile-form" onSubmit={handleSubmit}>
        <Panel className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            {textField('name', 'Company name', { required: true })}
            {textField('displayName', 'Display / business name')}
          </div>

          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={form.description}
              disabled={readOnly || saving}
              onChange={(e) => update('description', e.target.value)}
            />
            <FieldError message={fieldErrors.description} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {textField('industry', 'Industry')}
            {textField('email', 'Contact email', { type: 'email' })}
            {textField('phone', 'Phone')}
            {textField('whatsappNumber', 'WhatsApp number')}
            {textField('websiteUrl', 'Website URL', {
              placeholder: 'https://example.com',
            })}
            {textField('address', 'Address')}
            {textField('city', 'City')}
            {textField('country', 'Country')}
            {textField('timezone', 'Timezone', { placeholder: 'Asia/Amman' })}
            {textField('defaultLanguage', 'Default language', {
              placeholder: 'ar / en / auto',
            })}
            {textField('responseLanguage', 'Response language', {
              placeholder: 'ar / en / auto',
            })}
          </div>
        </Panel>
      </form>
    </div>
  );
}
