import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Company, User, UserRole } from '@/lib/types';
import { DangerZoneSection } from './DangerZoneSection';

/**
 * The destructive corner of the profile page. What is worth pinning is that it
 * CANNOT fire by accident: hidden entirely for non-owners, and the confirm
 * button stays disabled until the company name is typed correctly.
 */

const replace = vi.fn();
const notify = vi.fn();
const logout = vi.fn();
const exportData = vi.fn();
const deleteCompany = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
}));

vi.mock('@/lib/resources', () => ({
  companyApi: {
    exportData: (...a: unknown[]) => exportData(...a),
    deleteCompany: (...a: unknown[]) => deleteCompany(...a),
  },
}));

vi.mock('@/components/toast', () => ({
  useToast: () => ({ notify }),
}));

const COMPANY = { id: 'co1', name: 'Acme Co' } as Company;

let role: UserRole = 'OWNER';

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    user: { id: 'u1', role } as User,
    company: COMPANY,
    logout,
    features: { billing: false, aiActions: true },
    initializing: false,
  }),
}));

beforeEach(() => {
  role = 'OWNER';
  replace.mockClear();
  notify.mockClear();
  logout.mockReset().mockResolvedValue(undefined);
  exportData.mockReset().mockResolvedValue(undefined);
  deleteCompany.mockReset().mockResolvedValue({ deletedCompanyName: 'Acme Co' });
});

describe('visibility', () => {
  it.each(['ADMIN', 'AGENT'] as UserRole[])(
    'renders nothing for an %s',
    (r) => {
      role = r;
      const { container } = render(<DangerZoneSection />);
      expect(container).toBeEmptyDOMElement();
    },
  );

  it('renders both actions for an OWNER', () => {
    render(<DangerZoneSection />);
    expect(
      screen.getByRole('button', { name: /download export/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /delete company/i }),
    ).toBeInTheDocument();
  });
});

describe('export', () => {
  it('downloads and confirms', async () => {
    const user = userEvent.setup();
    render(<DangerZoneSection />);

    await user.click(screen.getByRole('button', { name: /download export/i }));

    expect(exportData).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      expect.stringMatching(/downloaded/i),
      'success',
    );
  });
});

describe('deletion', () => {
  it('cannot be confirmed until the name is typed exactly', async () => {
    const user = userEvent.setup();
    render(<DangerZoneSection />);

    await user.click(screen.getByRole('button', { name: /delete company/i }));
    const confirm = screen.getByRole('button', { name: /delete everything/i });
    expect(confirm).toBeDisabled();

    const field = screen.getByLabelText(/type the company name/i);
    await user.type(field, 'Acme');
    expect(confirm).toBeDisabled();
    expect(screen.getByText(/does not match/i)).toBeInTheDocument();

    await user.type(field, ' Co');
    expect(confirm).toBeEnabled();
  });

  it('deletes, signs out and leaves the dashboard', async () => {
    const user = userEvent.setup();
    render(<DangerZoneSection />);

    await user.click(screen.getByRole('button', { name: /delete company/i }));
    await user.type(
      screen.getByLabelText(/type the company name/i),
      'Acme Co',
    );
    await user.click(screen.getByRole('button', { name: /delete everything/i }));

    expect(deleteCompany).toHaveBeenCalledWith('Acme Co');
    expect(logout).toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith('/login');
  });

  it('accepts a differently-cased name, matching the API', async () => {
    const user = userEvent.setup();
    render(<DangerZoneSection />);

    await user.click(screen.getByRole('button', { name: /delete company/i }));
    await user.type(
      screen.getByLabelText(/type the company name/i),
      'acme co',
    );
    await user.click(screen.getByRole('button', { name: /delete everything/i }));

    expect(deleteCompany).toHaveBeenCalledWith('acme co');
  });

  it('keeps the user on the page when the API refuses', async () => {
    deleteCompany.mockRejectedValue(new Error('nope'));
    const user = userEvent.setup();
    render(<DangerZoneSection />);

    await user.click(screen.getByRole('button', { name: /delete company/i }));
    await user.type(
      screen.getByLabelText(/type the company name/i),
      'Acme Co',
    );
    await user.click(screen.getByRole('button', { name: /delete everything/i }));

    expect(replace).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: /delete everything/i }),
    ).toBeInTheDocument();
  });

  it('can be backed out of', async () => {
    const user = userEvent.setup();
    render(<DangerZoneSection />);

    await user.click(screen.getByRole('button', { name: /delete company/i }));
    await user.click(screen.getByRole('button', { name: /keep my company/i }));

    expect(
      screen.queryByRole('button', { name: /delete everything/i }),
    ).not.toBeInTheDocument();
    expect(deleteCompany).not.toHaveBeenCalled();
  });
});
