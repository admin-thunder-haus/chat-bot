'use client';

import { useEffect, useState } from 'react';
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
  Panel,
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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    businessHoursApi
      .get()
      .then(({ hours }) => active && setHours(hours))
      .catch((err) => active && setError(parseApiError(err).message));
    return () => {
      active = false;
    };
  }, []);

  function updateDay(index: number, patch: Partial<WeeklyDay>) {
    setHours((prev) =>
      prev ? prev.map((d, i) => (i === index ? { ...d, ...patch } : d)) : prev,
    );
  }

  function validate(list: WeeklyDay[]): string | null {
    for (const d of list) {
      if (d.isClosed) continue;
      if (!d.openTime || !d.closeTime) {
        return `${DAY_LABEL[d.dayOfWeek]}: opening and closing times are required.`;
      }
      if (d.closeTime <= d.openTime) {
        return `${DAY_LABEL[d.dayOfWeek]}: closing time must be after opening time.`;
      }
    }
    return null;
  }

  async function handleSave() {
    if (!hours) return;
    setError('');
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

  return (
    <div>
      <PageHeader
        title="Business Hours"
        description="Set your weekly opening hours (Monday to Sunday)."
        actions={
          !readOnly ? (
            <Button onClick={handleSave} loading={saving} disabled={!hours}>
              Save schedule
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

      {!hours ? (
        <div className="space-y-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : (
        <Panel className="divide-y divide-slate-100 p-0">
          {hours.map((day, index) => (
            <div
              key={day.dayOfWeek}
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center"
            >
              <div className="w-32 font-medium text-slate-800">
                {DAY_LABEL[day.dayOfWeek]}
              </div>

              <div className="flex items-center gap-2">
                <Toggle
                  checked={!day.isClosed}
                  disabled={readOnly || saving}
                  onChange={(open) => updateDay(index, { isClosed: !open })}
                  label={`${DAY_LABEL[day.dayOfWeek]} open`}
                />
                <span className="text-sm text-slate-500">
                  {day.isClosed ? 'Closed' : 'Open'}
                </span>
              </div>

              {!day.isClosed && (
                <div className="flex items-center gap-2 sm:ml-auto">
                  <Input
                    type="time"
                    value={day.openTime ?? ''}
                    disabled={readOnly || saving}
                    onChange={(e) => updateDay(index, { openTime: e.target.value })}
                    className="w-32"
                    aria-label={`${DAY_LABEL[day.dayOfWeek]} opening time`}
                  />
                  <span className="text-slate-400">–</span>
                  <Input
                    type="time"
                    value={day.closeTime ?? ''}
                    disabled={readOnly || saving}
                    onChange={(e) => updateDay(index, { closeTime: e.target.value })}
                    className="w-32"
                    aria-label={`${DAY_LABEL[day.dayOfWeek]} closing time`}
                  />
                </div>
              )}
            </div>
          ))}
        </Panel>
      )}
    </div>
  );
}
