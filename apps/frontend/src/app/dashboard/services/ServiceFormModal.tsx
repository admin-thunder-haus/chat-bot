'use client';

import { useEffect, useState } from 'react';
import { servicesApi, type ServiceInput } from '@/lib/resources';
import { parseApiError } from '@/lib/form';
import type { Service, ServicePriceType } from '@/lib/types';
import {
  Alert,
  Button,
  FieldError,
  Input,
  Label,
  Modal,
  Select,
  Textarea,
  Toggle,
} from '@/components/ui';

const PRICE_TYPES: { value: ServicePriceType; label: string }[] = [
  { value: 'FIXED', label: 'Fixed price' },
  { value: 'STARTING_FROM', label: 'Starting from' },
  { value: 'VARIABLE', label: 'Variable' },
  { value: 'CONTACT_US', label: 'Contact us' },
  { value: 'FREE', label: 'Free' },
];

const PRICED = new Set<ServicePriceType>(['FIXED', 'STARTING_FROM']);

export function ServiceFormModal({
  open,
  service,
  onClose,
  onSaved,
}: {
  open: boolean;
  service: Service | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [priceType, setPriceType] = useState<ServicePriceType>('FIXED');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('JOD');
  const [duration, setDuration] = useState('');
  const [isActive, setIsActive] = useState(true);

  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    setFieldErrors({});
    if (service) {
      setName(service.name);
      setDescription(service.description ?? '');
      setPriceType(service.priceType);
      setPrice(service.price ?? '');
      setCurrency(service.currency);
      setDuration(service.durationMinutes?.toString() ?? '');
      setIsActive(service.isActive);
    } else {
      setName('');
      setDescription('');
      setPriceType('FIXED');
      setPrice('');
      setCurrency('JOD');
      setDuration('');
      setIsActive(true);
    }
  }, [open, service]);

  const showPrice = PRICED.has(priceType);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setFieldErrors({});

    if (name.trim().length < 1) {
      setFieldErrors({ name: 'Name is required' });
      return;
    }
    if (showPrice && price.trim() === '') {
      setFieldErrors({ price: 'Price is required for this price type' });
      return;
    }

    const payload: ServiceInput = {
      name: name.trim(),
      description: description.trim() || null,
      priceType,
      currency: currency.trim().toUpperCase(),
      durationMinutes: duration.trim() ? Number(duration) : null,
      isActive,
      // Only send a price for priced types; backend nulls it otherwise.
      price: showPrice ? Number(price) : null,
    };

    setSaving(true);
    try {
      if (service) {
        await servicesApi.update(service.id, payload);
      } else {
        await servicesApi.create(payload);
      }
      onSaved();
    } catch (err) {
      const parsed = parseApiError(err);
      setError(parsed.message);
      setFieldErrors(parsed.fieldErrors);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={service ? 'Edit service' : 'Add service'}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <Alert message={error} />}

        <div>
          <Label htmlFor="svc-name" required>
            Name
          </Label>
          <Input
            id="svc-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={saving}
          />
          <FieldError message={fieldErrors.name} />
        </div>

        <div>
          <Label htmlFor="svc-desc">Description</Label>
          <Textarea
            id="svc-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={saving}
          />
          <FieldError message={fieldErrors.description} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="svc-priceType">Price type</Label>
            <Select
              id="svc-priceType"
              value={priceType}
              onChange={(e) => setPriceType(e.target.value as ServicePriceType)}
              disabled={saving}
            >
              {PRICE_TYPES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </div>

          {showPrice && (
            <div>
              <Label htmlFor="svc-price" required>
                Price
              </Label>
              <Input
                id="svc-price"
                type="number"
                min="0"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                disabled={saving}
              />
              <FieldError message={fieldErrors.price} />
            </div>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="svc-currency">Currency</Label>
            <Input
              id="svc-currency"
              value={currency}
              maxLength={3}
              onChange={(e) => setCurrency(e.target.value)}
              disabled={saving || !showPrice}
            />
            <FieldError message={fieldErrors.currency} />
          </div>
          <div>
            <Label htmlFor="svc-duration">Duration (minutes)</Label>
            <Input
              id="svc-duration"
              type="number"
              min="1"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              disabled={saving}
            />
            <FieldError message={fieldErrors.durationMinutes} />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Toggle checked={isActive} onChange={setIsActive} label="Active" />
          <span className="text-sm text-slate-700">Active</span>
        </div>

        <div className="mt-2 flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            {service ? 'Save' : 'Create'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
