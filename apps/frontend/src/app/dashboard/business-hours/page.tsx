'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { canWrite } from '@/lib/permissions';
import { businessHoursApi } from '@/lib/resources';
import { parseApiError } from '@/lib/form';
import { useToast } from '@/components/toast';
import type { WeeklyDay } from '@/lib/types';
import {
  Alert,
  Button,
  Input,
  PageHeader,
  SectionCard,
  Skeleton,
  Toggle,
} from '@/components/ui';

const DAY_LABEL: Record<string, string> = {
  MONDAY: 'Monday',
  TUESDAY: 'Tuesday',
  WEDNESDAY: 'Wednesday',
  THURSDAY: 'Thursday',
  FRIDAY: 'Friday',
  SATURDAY: 'Saturday',
  SUNDAY: 'Sunday',
};

export default function BusinessHoursPage() {
  const { user } = useAuth();
  const { notify } = useToast();
  const readOnly = !canWrite(user?.role);

  const [hours, setHours] = useState<WeeklyDay[] | null>(null);
  const [error, setError] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError('');
    setLoadFailed(false);
    try {
      const { hours: loaded } = await businessHoursApi.get();
      setHours(loaded);
    } catch (err) {
      setError(parseApiError(err).message);
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function updateDay(index: number, patch: Partial<WeeklyDay>) {
    setHours((prev) =>
      prev ? prev.map((d, i) => (i === index ? { ...d, ...patch } : d)) : prev,
    );
  }

  function validate(list: WeeklyDay[]): string | null {
    for (const d of list) {
      if (d.isClosed) continue;
      if (!d.openTime || !d.closeTime) {
        return `${DAY_LABEL[d.dayOfWeek]}: enter both an opening and a closing time, or mark the day closed.`;
      }
      if (d.closeTime <= d.openTime) {
        return `${DAY_LABEL[d.dayOfWeek]}: the closing time must be after the opening time.`;
      }
    }
    return null;
  }

  async function handleSave() {
    if (!hours) return;
    setError('');
    setLoadFailed(false);
    const validationError = validate(hours);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    try {
      const payload = hours.map((d) => ({
        dayOfWeek: d.dayOfWeek,
        isClosed: d.isClosed,
        openTime: d.isClosed ? null : d.openTime,
        closeTime: d.isClosed ? null : d.closeTime,
      }));
      const { hours: saved } = await businessHoursApi.save(payload);
      setHours(saved);
      notify('Business hours saved', 'success');
    } catch (err) {
      setError(parseApiError(err).message);
    } finally {
      setSaving(false);
    }
  }

  const saveButton = (
    <Button
      onClick={handleSave}
      loading={saving}
      loadingLabel="Saving…"
      disabled={!hours}
    >
      Save schedule
    </Button>
  );

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Business hours"
        description="Your weekly opening times, so the assistant can tell customers when you are open."
        actions={
          !readOnly ? (
            // On phones the sticky bar below the schedule carries Save.
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

        {!hours ? (
          loadFailed ? null : (
            <div className="space-y-3">
              {Array.from({ length: 7 }).map((_, i) => (
                <Skeleton key={i} className="h-16 rounded-xl" />
              ))}
            </div>
          )
        ) : (
          <>
            <SectionCard
              title="Weekly schedule"
              description="Turn a day off to mark it closed. Times use your company timezone."
              padded={false}
            >
              <ul className="divide-y divide-slate-100">
                {hours.map((day, index) => {
                  const label = DAY_LABEL[day.dayOfWeek] ?? day.dayOfWeek;
                  return (
                    <li
                      key={day.dayOfWeek}
                      className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4 sm:px-6"
                    >
                      <div className="flex items-center gap-3 sm:w-44 sm:shrink-0">
                        <Toggle
                          checked={!day.isClosed}
                          disabled={readOnly || saving}
                          onChange={(open) =>
                            updateDay(index, { isClosed: !open })
                          }
                          label={`${label}: open`}
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800">
                            {label}
                          </p>
                          <p className="text-xs text-slate-500">
                            {day.isClosed ? 'Closed' : 'Open'}
                          </p>
                        </div>
                      </div>

                      {day.isClosed ? (
                        <p className="text-sm text-slate-500 sm:ml-auto">
                          Closed all day
                        </p>
                      ) : (
                        <div className="flex min-w-0 items-center gap-2 sm:ml-auto">
                          <Input
                            type="time"
                            value={day.openTime ?? ''}
                            disabled={readOnly || saving}
                            onChange={(e) =>
                              updateDay(index, { openTime: e.target.value })
                            }
                            className="min-w-0 flex-1 sm:w-32 sm:flex-none"
                            aria-label={`${label}: opening time`}
                          />
                          <span className="text-slate-400" aria-hidden="true">
                            –
                          </span>
                          <Input
                            type="time"
                            value={day.closeTime ?? ''}
                            disabled={readOnly || saving}
                            onChange={(e) =>
                              updateDay(index, { closeTime: e.target.value })
                            }
                            className="min-w-0 flex-1 sm:w-32 sm:flex-none"
                            aria-label={`${label}: closing time`}
                          />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </SectionCard>

            {/* Sticky save so it stays reachable on a phone (§5). */}
            {!readOnly && (
              <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur sm:hidden">
                <span className="text-xs text-slate-500">
                  Changes apply after saving
                </span>
                {saveButton}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
