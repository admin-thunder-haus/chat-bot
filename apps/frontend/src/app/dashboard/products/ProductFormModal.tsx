'use client';

import { useEffect, useState } from 'react';
import { productsApi, type ProductInput } from '@/lib/resources';
import { parseApiError } from '@/lib/form';
import type { Product } from '@/lib/types';
import { ImageUploadField } from '@/components/ImageUploadField';
import {
  Alert,
  Button,
  FieldError,
  Input,
  Label,
  Modal,
  Textarea,
  Toggle,
} from '@/components/ui';

export function ProductFormModal({
  open,
  product,
  onClose,
  onSaved,
}: {
  open: boolean;
  product: Product | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('JOD');
  const [stockQuantity, setStockQuantity] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [isActive, setIsActive] = useState(true);

  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    setFieldErrors({});
    if (product) {
      setName(product.name);
      setSku(product.sku ?? '');
      setCategory(product.category ?? '');
      setDescription(product.description ?? '');
      setPrice(product.price ?? '');
      setCurrency(product.currency);
      setStockQuantity(product.stockQuantity?.toString() ?? '');
      setImageUrl(product.imageUrl ?? '');
      setIsActive(product.isActive);
    } else {
      setName('');
      setSku('');
      setCategory('');
      setDescription('');
      setPrice('');
      setCurrency('JOD');
      setStockQuantity('');
      setImageUrl('');
      setIsActive(true);
    }
  }, [open, product]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setFieldErrors({});

    if (name.trim().length < 1) {
      setFieldErrors({ name: 'Name is required' });
      return;
    }

    const payload: ProductInput = {
      name: name.trim(),
      sku: sku.trim() || null,
      category: category.trim() || null,
      description: description.trim() || null,
      // Empty price means "price on request".
      price: price.trim() ? Number(price) : null,
      currency: currency.trim().toUpperCase(),
      stockQuantity: stockQuantity.trim() ? Number(stockQuantity) : null,
      imageUrl: imageUrl.trim() || null,
      isActive,
    };

    setSaving(true);
    try {
      if (product) {
        await productsApi.update(product.id, payload);
      } else {
        await productsApi.create(payload);
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
      title={product ? 'Edit product' : 'Add product'}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <Alert message={error} />}

        <div>
          <Label htmlFor="prd-name" required>
            Name
          </Label>
          <Input
            id="prd-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={saving}
          />
          <FieldError message={fieldErrors.name} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="prd-sku">SKU</Label>
            <Input
              id="prd-sku"
              value={sku}
              maxLength={64}
              onChange={(e) => setSku(e.target.value)}
              disabled={saving}
            />
            <FieldError message={fieldErrors.sku} />
          </div>
          <div>
            <Label htmlFor="prd-category">Category</Label>
            <Input
              id="prd-category"
              value={category}
              maxLength={60}
              onChange={(e) => setCategory(e.target.value)}
              disabled={saving}
            />
            <FieldError message={fieldErrors.category} />
          </div>
        </div>

        <div>
          <Label htmlFor="prd-desc">Description</Label>
          <Textarea
            id="prd-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={saving}
          />
          <FieldError message={fieldErrors.description} />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="prd-price">Price</Label>
            <Input
              id="prd-price"
              type="number"
              min="0"
              step="0.01"
              placeholder="On request"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              disabled={saving}
            />
            <FieldError message={fieldErrors.price} />
          </div>
          <div>
            <Label htmlFor="prd-currency">Currency</Label>
            <Input
              id="prd-currency"
              value={currency}
              maxLength={3}
              onChange={(e) => setCurrency(e.target.value)}
              disabled={saving}
            />
            <FieldError message={fieldErrors.currency} />
          </div>
          <div>
            <Label htmlFor="prd-stock">Stock</Label>
            <Input
              id="prd-stock"
              type="number"
              min="0"
              step="1"
              placeholder="Untracked"
              value={stockQuantity}
              onChange={(e) => setStockQuantity(e.target.value)}
              disabled={saving}
            />
            <FieldError message={fieldErrors.stockQuantity} />
          </div>
        </div>

        <div>
          <ImageUploadField
            value={imageUrl.trim() || null}
            onChange={(url) => setImageUrl(url ?? '')}
            disabled={saving}
          />
          <FieldError message={fieldErrors.imageUrl} />
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
            {product ? 'Save' : 'Create'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
