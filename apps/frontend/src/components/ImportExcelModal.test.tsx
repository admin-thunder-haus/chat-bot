import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportExcelModal } from './ImportExcelModal';
import { ToastProvider } from './toast';
import type { ImportPreview } from '@/lib/types';

const COLUMNS = ['name', 'price'];

function makeFile(): File {
  return new File(['fake'], 'services.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function validPreview(): ImportPreview {
  return {
    rows: [
      { rowNumber: 2, data: { name: 'Haircut' }, raw: { name: 'Haircut', price: 15 }, errors: [] },
    ],
    summary: { totalRows: 1, validRows: 1, invalidRows: 0 },
  };
}

function invalidPreview(): ImportPreview {
  return {
    rows: [
      {
        rowNumber: 2,
        data: null,
        raw: { price: 15 },
        errors: [{ field: 'name', message: 'Name is required' }],
      },
    ],
    summary: { totalRows: 1, validRows: 0, invalidRows: 1 },
  };
}

function renderModal(overrides: Partial<Parameters<typeof ImportExcelModal>[0]> = {}) {
  const props = {
    open: true,
    title: 'Import services',
    templateColumns: COLUMNS,
    onClose: vi.fn(),
    onPreview: vi.fn().mockResolvedValue(validPreview()),
    onCommit: vi
      .fn()
      .mockResolvedValue({ created: 1, updated: 0, deleted: 0, total: 1 }),
    onImported: vi.fn(),
    ...overrides,
  };
  render(
    <ToastProvider>
      <ImportExcelModal {...props} />
    </ToastProvider>,
  );
  return props;
}

async function pickFileAndPreview() {
  const user = userEvent.setup();
  const fileInput = document.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  await user.upload(fileInput, makeFile());
  await user.click(screen.getByRole('button', { name: /generate preview/i }));
  return user;
}

describe('ImportExcelModal', () => {
  it('disables Import until a valid preview exists, then commits in merge mode', async () => {
    const props = renderModal();
    expect(screen.getByRole('button', { name: /^import$/i })).toBeDisabled();

    const user = await pickFileAndPreview();
    await screen.findByText('1 valid');

    const importBtn = screen.getByRole('button', { name: /^import$/i });
    expect(importBtn).toBeEnabled();
    await user.click(importBtn);

    await waitFor(() => {
      expect(props.onCommit).toHaveBeenCalledWith(expect.any(File), 'merge');
      expect(props.onImported).toHaveBeenCalled();
      expect(props.onClose).toHaveBeenCalled();
    });
  });

  it('keeps Import disabled when the preview contains invalid rows', async () => {
    renderModal({ onPreview: vi.fn().mockResolvedValue(invalidPreview()) });
    await pickFileAndPreview();

    await screen.findByText('1 invalid');
    expect(screen.getByText(/name: Name is required/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^import$/i })).toBeDisabled();
  });

  it('requires the confirmation checkbox before a replace import', async () => {
    const props = renderModal();
    const user = await pickFileAndPreview();
    await screen.findByText('1 valid');

    await user.click(screen.getByLabelText(/replace all existing entries/i));
    const importBtn = screen.getByRole('button', { name: /^import$/i });
    expect(importBtn).toBeDisabled();

    await user.click(
      screen.getByLabelText(/deletes all existing records first/i),
    );
    expect(importBtn).toBeEnabled();

    await user.click(importBtn);
    await waitFor(() => {
      expect(props.onCommit).toHaveBeenCalledWith(expect.any(File), 'replace');
    });
  });
});
