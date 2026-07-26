'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { companyApi } from '@/lib/resources';
import { parseApiError } from '@/lib/form';
import { useToast } from '@/components/toast';
import {
  Alert,
  Button,
  FieldError,
  Input,
  Label,
  Modal,
  SectionCard,
} from '@/components/ui';

/**
 * Export and permanent deletion — the two GDPR obligations, deliberately side by
 * side so the destructive one is never the only option on screen.
 *
 * OWNER-only, mirroring the API (which enforces it independently — this is a UI
 * courtesy, not the security boundary). The whole section is hidden for other
 * roles rather than shown-and-disabled: an agent has no reason to know the
 * button exists.
 */
export function DangerZoneSection() {
  const { user, company, logout } = useAuth();
  const { notify } = useToast();
  const router = useRouter();

  const [exporting, setExporting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typedName, setTypedName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  if (user?.role !== 'OWNER' || !company) return null;

  const nameMatches =
    typedName.trim().toLowerCase() === company.name.trim().toLowerCase();

  async function handleExport() {
    setExporting(true);
    try {
      await companyApi.exportData();
      notify('Your data export has been downloaded', 'success');
    } catch (err) {
      notify(parseApiError(err).message, 'error');
    } finally {
      setExporting(false);
    }
  }

  function openConfirm() {
    setTypedName('');
    setError('');
    setConfirmOpen(true);
  }

  async function handleDelete() {
    if (!nameMatches) return;
    setDeleting(true);
    setError('');
    try {
      await companyApi.deleteCompany(typedName.trim());
      // The account is gone; clear local auth state and leave the dashboard
      // rather than letting the next request 401 into a confusing redirect.
      await logout().catch(() => undefined);
      router.replace('/login');
    } catch (err) {
      setError(parseApiError(err).message);
      setDeleting(false);
    }
  }

  return (
    <>
      <SectionCard
        title="Your data"
        description="Download everything in this workspace, or close the account permanently."
      >
        <div className="space-y-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="sm:pr-6">
              <p className="text-sm font-medium text-slate-900">
                Export workspace data
              </p>
              <p className="mt-1 text-sm text-slate-500">
                A JSON file with your company profile, team, customers,
                conversations, messages and catalogue. Credentials and file
                contents are not included.
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={handleExport}
              loading={exporting}
              loadingLabel="Preparing…"
              className="w-full sm:w-auto sm:shrink-0"
            >
              Download export
            </Button>
          </div>

          <div className="rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-medium text-red-900">
              Delete this company
            </p>
            <p className="mt-1 text-sm text-red-800">
              Permanently removes the company, every team member, and all
              customers, conversations, messages, documents and connected
              channels. This cannot be undone — download your export first.
            </p>
            <div className="mt-3">
              <Button
                type="button"
                variant="danger"
                onClick={openConfirm}
                className="w-full sm:w-auto"
              >
                Delete company…
              </Button>
            </div>
          </div>
        </div>
      </SectionCard>

      <Modal
        open={confirmOpen}
        onClose={() => (deleting ? undefined : setConfirmOpen(false))}
        title="Delete this company permanently?"
        footer={
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setConfirmOpen(false)}
              disabled={deleting}
              className="w-full sm:w-auto"
            >
              Keep my company
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={handleDelete}
              // Disabled until the name matches: the typed confirmation is the
              // whole safeguard, and the API rejects a mismatch anyway.
              disabled={!nameMatches}
              loading={deleting}
              loadingLabel="Deleting…"
              className="w-full sm:w-auto"
            >
              Delete everything
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {error && <Alert message={error} />}
          <p className="text-sm text-slate-600">
            This deletes all data for{' '}
            <span className="font-medium text-slate-900 break-words">
              {company.name}
            </span>{' '}
            immediately and cannot be reversed. You will be signed out.
          </p>
          <div>
            <Label htmlFor="confirmName" required>
              Type the company name to confirm
            </Label>
            <Input
              id="confirmName"
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              placeholder={company.name}
              autoComplete="off"
              invalid={typedName.length > 0 && !nameMatches}
            />
            <FieldError
              message={
                typedName.length > 0 && !nameMatches
                  ? 'This does not match the company name yet.'
                  : undefined
              }
            />
          </div>
        </div>
      </Modal>
    </>
  );
}
