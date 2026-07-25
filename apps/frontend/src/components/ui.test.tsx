import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  CopyButton,
  DataList,
  EmptyState,
  Pagination,
  Tabs,
  type DataListColumn,
} from './ui';

/* -------------------------------------------------------------------------- */
/* DataList                                                                   */
/* -------------------------------------------------------------------------- */

type Row = { id: string; name: string; sku: string; stock: number };

const ROWS: Row[] = [
  { id: 'a', name: 'Widget', sku: 'W-1', stock: 4 },
  { id: 'b', name: 'Gadget', sku: 'G-2', stock: 0 },
];

const COLUMNS: DataListColumn<Row>[] = [
  { key: 'name', header: 'Name', cell: (r) => r.name, primary: true },
  { key: 'sku', header: 'SKU', cell: (r) => r.sku },
  {
    key: 'stock',
    header: 'Stock',
    align: 'right',
    hideOnMobile: true,
    cell: (r) => r.stock,
  },
];

function renderList(overrides: Partial<Parameters<typeof DataList<Row>>[0]> = {}) {
  return render(
    <DataList<Row>
      items={ROWS}
      keyOf={(r) => r.id}
      columns={COLUMNS}
      {...overrides}
    />,
  );
}

describe('DataList', () => {
  it('renders a real table with a header cell per column', () => {
    renderList();

    const table = screen.getByRole('table');
    expect(table).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual(
      ['Name', 'SKU', 'Stock'],
    );
    // Header row + one row per record.
    expect(screen.getAllByRole('row')).toHaveLength(ROWS.length + 1);
  });

  it('adds an actions column only when an actions renderer is given', () => {
    const { unmount } = renderList();
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).toBeNull();
    unmount();

    renderList({ actions: (r) => <button type="button">Edit {r.name}</button> });
    expect(
      screen.getByRole('columnheader', { name: 'Actions' }),
    ).toBeInTheDocument();
    // Rendered once in the table cell and once in the mobile card footer.
    expect(
      screen.getAllByRole('button', { name: 'Edit Widget' }),
    ).toHaveLength(2);
  });

  it('mirrors every record into a mobile card, skipping hideOnMobile columns', () => {
    renderList();

    // Primary value: once in the table cell, once as the card title.
    expect(screen.getAllByText('Widget')).toHaveLength(2);
    // Non-primary visible column: table header + one card label per record.
    expect(screen.getAllByText('SKU')).toHaveLength(1 + ROWS.length);
    // hideOnMobile column value appears in the table only.
    expect(screen.getAllByText('4')).toHaveLength(1);

    // The cards are a list of one item per record.
    expect(screen.getAllByRole('listitem')).toHaveLength(ROWS.length);
  });

  it('renders skeleton rows shaped like the content while loading', () => {
    const { container } = renderList({ loading: true, skeletonRows: 3 });

    // Header row + 3 skeleton rows, and no real data yet.
    expect(screen.getAllByRole('row')).toHaveLength(4);
    expect(screen.queryByText('Widget')).toBeNull();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(
      3,
    );
  });

  it('shows the empty slot instead of a table when there are no items', () => {
    renderList({
      items: [],
      empty: <EmptyState title="No products yet" />,
    });

    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('No products yet')).toBeInTheDocument();
  });

  it('falls back to a default empty state when no slot is provided', () => {
    renderList({ items: [] });
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/* Tabs                                                                       */
/* -------------------------------------------------------------------------- */

const TABS = [
  { key: 'appointments', label: 'Appointments' },
  { key: 'orders', label: 'Orders', count: 3 },
  { key: 'tickets', label: 'Tickets' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

function renderTabs(value: TabKey = 'appointments') {
  const onChange = vi.fn();
  render(
    <Tabs<TabKey> tabs={TABS} value={value} onChange={onChange} label="Sections" />,
  );
  return onChange;
}

describe('Tabs', () => {
  it('marks the selected tab with aria-selected and exposes a tablist', () => {
    renderTabs('orders');

    expect(screen.getByRole('tablist', { name: 'Sections' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Orders/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Appointments' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('reports the clicked tab', async () => {
    const user = userEvent.setup();
    const onChange = renderTabs();

    await user.click(screen.getByRole('tab', { name: 'Tickets' }));
    expect(onChange).toHaveBeenCalledWith('tickets');
  });

  it('moves through tabs with the arrow keys, Home and End', async () => {
    const user = userEvent.setup();
    const onChange = renderTabs('orders');
    const orders = screen.getByRole('tab', { name: /Orders/ });
    orders.focus();

    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('tickets');

    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('appointments');

    await user.keyboard('{End}');
    expect(onChange).toHaveBeenLastCalledWith('tickets');

    await user.keyboard('{Home}');
    expect(onChange).toHaveBeenLastCalledWith('appointments');
  });

  it('keeps only the selected tab in the tab order', () => {
    renderTabs('tickets');
    expect(screen.getByRole('tab', { name: 'Tickets' })).toHaveAttribute(
      'tabindex',
      '0',
    );
    expect(screen.getByRole('tab', { name: 'Appointments' })).toHaveAttribute(
      'tabindex',
      '-1',
    );
  });
});

/* -------------------------------------------------------------------------- */
/* CopyButton                                                                 */
/* -------------------------------------------------------------------------- */

function stubClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
    writable: true,
  });
}

describe('CopyButton', () => {
  it('writes the value to the clipboard and confirms it', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    render(<CopyButton value="ak_live_secret" label="Copy key" />);

    const button = screen.getByRole('button', {
      name: /copy key to clipboard/i,
    });
    await user.click(button);

    expect(writeText).toHaveBeenCalledWith('ak_live_secret');
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('tells the user what to do when the clipboard is unavailable', async () => {
    const user = userEvent.setup();
    stubClipboard(() => Promise.reject(new Error('blocked')));

    render(<CopyButton value="abc" />);
    await user.click(screen.getByRole('button', { name: /copy to clipboard/i }));

    expect(await screen.findByText('Copy failed')).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/* Pagination                                                                 */
/* -------------------------------------------------------------------------- */

describe('Pagination', () => {
  it('renders nothing when there is a single page', () => {
    const { container } = render(
      <Pagination page={1} totalPages={1} onChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the readable position and the total', () => {
    render(<Pagination page={2} totalPages={7} onChange={vi.fn()} total={64} />);
    expect(screen.getByText(/Page 2 of 7/)).toBeInTheDocument();
    expect(screen.getByText(/64 total/)).toBeInTheDocument();
  });

  it('disables Previous on the first page and Next on the last', () => {
    const { unmount } = render(
      <Pagination page={1} totalPages={3} onChange={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
    unmount();

    render(<Pagination page={3} totalPages={3} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('steps one page at a time', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Pagination page={2} totalPages={5} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(onChange).toHaveBeenCalledWith(3);

    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(onChange).toHaveBeenCalledWith(1);
  });
});
