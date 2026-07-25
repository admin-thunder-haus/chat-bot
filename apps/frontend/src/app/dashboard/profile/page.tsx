'use client';

import { useCallback, useEffect, useState } from 'react';
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
  SectionCard,
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
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError('');
    setLoadFailed(false);
    try {
      const { company } = await companyApi.getProfile();
      setForm(toForm(company));
      setInitial(toForm(company));
    } catch (err) {
      setError(parseApiError(err).message);
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = Boolean(
    form && initial && JSON.stringify(form) !== JSON.stringify(initial),
  );

  function update(key: keyof FormState, value: string) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError('');
    setFieldErrors({});

    if (form.name.trim().length < 2) {
      setFieldErrors({ name: 'Enter at least 2 characters.' });
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

  const saveButton = (
    <Button
      type="submit"
      form="profile-form"
      loading={saving}
      loadingLabel="Saving…"
      disabled={!dirty}
    >
      Save changes
    </Button>
  );

  const textField = (
    key: keyof FormState,
    label: string,
    opts: {
      required?: boolean;
      type?: string;
      placeholder?: string;
      hint?: string;
    } = {},
  ) =>
    form && (
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
          invalid={Boolean(fieldErrors[key])}
          onChange={(e) => update(key, e.target.value)}
        />
        <FieldError message={fieldErrors[key]} />
        {opts.hint && !fieldErrors[key] && (
          <p className="mt-1 text-xs text-slate-500">{opts.hint}</p>
        )}
      </div>
    );

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Company profile"
        description="Details about your business that the assistant quotes to customers."
        actions={
          !readOnly && form ? (
            // On phones the sticky bar at the end of the form carries Save.
            <span className="hidden sm:block">{saveButton}</span>
          ) : undefined
        }
      />

      <div className="space-y-6">
        {readOnly && (
          <Alert
            variant="info"
            message="You have read-only access to this page. Ask an owner or admin to make changes."
          />
        )}
        {error && (
          <Alert>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span>{error}</span>
              {loadFailed && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void load()}
                  className="sm:shrink-0"
                >
                  Try again
                </Button>
              )}
            </div>
          </Alert>
        )}
        {dirty && !readOnly && (
          <Alert
            variant="warning"
            message="You have unsaved changes — save them before you leave this page."
          />
        )}

        {!form ? (
          loadFailed ? null : (
            <>
              <Skeleton className="h-64 rounded-xl" />
              <Skeleton className="h-56 rounded-xl" />
              <Skeleton className="h-56 rounded-xl" />
            </>
          )
        ) : (
          <form id="profile-form" onSubmit={handleSubmit} className="space-y-6">
            <SectionCard
              title="Identity"
              description="How the assistant refers to your business."
            >
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  {textField('name', 'Company name', { required: true })}
                  {textField('displayName', 'Display name', {
                    hint: 'Used in customer-facing replies when set.',
                  })}
                </div>
                <div>
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={form.description}
                    disabled={readOnly || saving}
                    invalid={Boolean(fieldErrors.description)}
                    placeholder="What your business does, in a sentence or two."
                    onChange={(e) => update('description', e.target.value)}
                  />
                  <FieldError message={fieldErrors.description} />
                </div>
                {textField('industry', 'Industry')}
              </div>
            </SectionCard>

            <SectionCard
              title="Contact details"
              description="The assistant shares these when a customer asks how to reach you."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                {textField('email', 'Contact email', { type: 'email' })}
                {textField('phone', 'Phone')}
                {textField('whatsappNumber', 'WhatsApp number')}
                {textField('websiteUrl', 'Website URL', {
                  placeholder: 'https://example.com',
                })}
              </div>
            </SectionCard>

            <SectionCard
              title="Location and time"
              description="Used for directions and for interpreting your business hours."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                {textField('address', 'Address')}
                {textField('city', 'City')}
                {textField('country', 'Country')}
                {textField('timezone', 'Timezone', {
                  placeholder: 'Asia/Amman',
                  hint: 'IANA name, e.g. Asia/Amman or Europe/Berlin.',
                })}
              </div>
            </SectionCard>

            <SectionCard
              title="Language"
              description="Which language the assistant defaults to when it cannot tell."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                {textField('defaultLanguage', 'Default language', {
                  placeholder: 'auto',
                  hint: 'ar, en, or auto to detect per message.',
                })}
                {textField('responseLanguage', 'Response language', {
                  placeholder: 'auto',
                  hint: 'ar, en, or auto to match the customer.',
                })}
              </div>
            </SectionCard>

            {/* Sticky save so it stays reachable on a phone (§5). */}
            {!readOnly && (
              <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur sm:hidden">
                <span className="text-xs text-slate-500">
                  {dirty ? 'Unsaved changes' : 'All changes saved'}
                </span>
                {saveButton}
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
