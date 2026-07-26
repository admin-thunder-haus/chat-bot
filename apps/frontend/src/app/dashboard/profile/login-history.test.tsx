import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiClientError } from '@/lib/api';
import type { LoginHistoryEntry } from '@/lib/types';
import { LoginHistorySection } from './LoginHistorySection';

/**
 * The sign-in activity section. The properties worth pinning are the ones a
 * careless refactor breaks silently: all four data states are handled (§4), and
 * no outcome enum ever reaches the screen as-is (§8).
 */

const list = vi.fn();

vi.mock('@/lib/resources', () => ({
  loginHistoryApi: { list: () => list() },
}));

const ROWS: LoginHistoryEntry[] = [
  {
    id: 'e1',
    outcome: 'SUCCESS',
    ipAddress: '203.0.113.9',
    userAgent: 'Mozilla/5.0 (Macintosh) Safari/605',
    createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  },
  {
    id: 'e2',
    outcome: 'INVALID_PASSWORD',
    ipAddress: '198.51.100.4',
    userAgent: null,
    createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  },
  {
    id: 'e3',
    outcome: 'EMAIL_NOT_VERIFIED',
    ipAddress: null,
    userAgent: null,
    createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  },
];

beforeEach(() => {
  list.mockReset().mockResolvedValue({ events: ROWS, limit: 20 });
});

describe('Recent sign-in activity', () => {
  it('shows a shaped skeleton while loading, never a bare spinner', () => {
    // Never resolves: the component is pinned in its loading state.
    list.mockReturnValue(new Promise(() => {}));
    const { container } = render(<LoginHistorySection />);

    expect(screen.getByText('Recent sign-in activity')).toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows an error with a working retry when the fetch fails', async () => {
    const user = userEvent.setup();
    list.mockRejectedValueOnce(new ApiClientError('Server unavailable', 500));

    render(<LoginHistorySection />);

    expect(
      await screen.findByText(/sign-in history could not be loaded/i),
    ).toBeInTheDocument();

    // Retry must actually re-request and then render the rows.
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(list).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('explains what the section is for when there is nothing to show', async () => {
    list.mockResolvedValue({ events: [], limit: 20 });
    render(<LoginHistorySection />);

    expect(
      await screen.findByText(/no sign-ins recorded yet/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('renders one row per attempt with the IP address', async () => {
    render(<LoginHistorySection />);

    const table = await screen.findByRole('table');
    // Header row + one row per record.
    expect(table.querySelectorAll('tbody tr')).toHaveLength(ROWS.length);
    expect(screen.getAllByText('203.0.113.9').length).toBeGreaterThan(0);
    // A missing IP is shown as a dash, never as "null".
    expect(screen.queryByText(/null/)).not.toBeInTheDocument();
  });

  it('humanizes every outcome and never renders the raw enum', async () => {
    render(<LoginHistorySection />);
    await screen.findByRole('table');

    for (const label of [
      'Signed in',
      'Wrong password',
      'Email not verified',
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }

    await waitFor(() => {
      for (const raw of [
        'SUCCESS',
        'INVALID_PASSWORD',
        'EMAIL_NOT_VERIFIED',
      ]) {
        expect(screen.queryByText(raw)).not.toBeInTheDocument();
      }
    });
  });
});
