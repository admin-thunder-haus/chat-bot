import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiClientError } from '@/lib/api';
import ForgotPasswordPage from '../forgot-password/page';
import ResetPasswordPage from './page';

/**
 * The two recovery pages. The properties worth pinning are the ones a careless
 * refactor would break silently: the confirmation never reveals whether the
 * email exists, a link with no token cannot post to the API, and the password
 * policy is enforced before a request goes out.
 */

const push = vi.fn();
const replace = vi.fn();
let searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => searchParams,
}));

const forgotPassword = vi.fn();
const resetPassword = vi.fn();

vi.mock('@/lib/api', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: {
      forgotPassword: (...args: unknown[]) => forgotPassword(...args),
      resetPassword: (...args: unknown[]) => resetPassword(...args),
    },
  };
});

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    user: null,
    company: null,
    features: { billing: false, aiActions: true },
    initializing: false,
  }),
}));

beforeEach(() => {
  push.mockClear();
  replace.mockClear();
  forgotPassword.mockReset().mockResolvedValue(null);
  resetPassword.mockReset().mockResolvedValue(null);
  searchParams = new URLSearchParams();
});

describe('/forgot-password', () => {
  it('shows the same neutral confirmation for any address', async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordPage />);

    await user.type(screen.getByLabelText(/email/i), 'someone@example.com');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(forgotPassword).toHaveBeenCalledWith({
      email: 'someone@example.com',
    });
    // Wording must not confirm the account exists.
    expect(screen.getByText(/if an account exists/i)).toBeInTheDocument();
    expect(screen.getByText(/check your inbox/i)).toBeInTheDocument();
  });

  it('requires an email before calling the API', async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordPage />);

    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(forgotPassword).not.toHaveBeenCalled();
    expect(
      screen.getByText(/please enter your email address/i),
    ).toBeInTheDocument();
  });

  it('surfaces a server error instead of a false confirmation', async () => {
    forgotPassword.mockRejectedValue(
      new ApiClientError('Too many requests, please try again later', 429),
    );
    const user = userEvent.setup();
    render(<ForgotPasswordPage />);

    await user.type(screen.getByLabelText(/email/i), 'someone@example.com');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(screen.getByText(/too many requests/i)).toBeInTheDocument();
    expect(screen.queryByText(/check your inbox/i)).not.toBeInTheDocument();
  });

  it('lets the user go back and try another address', async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordPage />);

    await user.type(screen.getByLabelText(/email/i), 'typo@example.com');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));
    await user.click(
      screen.getByRole('button', { name: /use a different email/i }),
    );

    expect(screen.getByRole('button', { name: /send reset link/i })).toBeInTheDocument();
  });
});

describe('/reset-password', () => {
  it('refuses to submit when the link carries no token', async () => {
    const user = userEvent.setup();
    render(<ResetPasswordPage />);

    expect(screen.getByText(/link is incomplete/i)).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/^new password/i),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /request a new link/i }));
    expect(push).toHaveBeenCalledWith('/forgot-password');
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it('enforces the password policy before calling the API', async () => {
    searchParams = new URLSearchParams({ token: 't'.repeat(43) });
    const user = userEvent.setup();
    render(<ResetPasswordPage />);

    await user.type(screen.getByLabelText(/^new password/i), 'alllowercase1');
    await user.type(screen.getByLabelText(/confirm new password/i), 'alllowercase1');
    await user.click(screen.getByRole('button', { name: /save new password/i }));

    expect(resetPassword).not.toHaveBeenCalled();
    // Matches the inline FieldError, not the always-present policy hint.
    expect(screen.getByText(/include an uppercase letter/i)).toBeInTheDocument();
  });

  it('catches a mismatched confirmation locally', async () => {
    searchParams = new URLSearchParams({ token: 't'.repeat(43) });
    const user = userEvent.setup();
    render(<ResetPasswordPage />);

    await user.type(screen.getByLabelText(/^new password/i), 'GoodPassword1');
    await user.type(screen.getByLabelText(/confirm new password/i), 'GoodPassword2');
    await user.click(screen.getByRole('button', { name: /save new password/i }));

    expect(resetPassword).not.toHaveBeenCalled();
    expect(screen.getByText(/do not match/i)).toBeInTheDocument();
  });

  it('confirms success and says other devices were signed out', async () => {
    const token = 't'.repeat(43);
    searchParams = new URLSearchParams({ token });
    const user = userEvent.setup();
    render(<ResetPasswordPage />);

    await user.type(screen.getByLabelText(/^new password/i), 'GoodPassword1');
    await user.type(screen.getByLabelText(/confirm new password/i), 'GoodPassword1');
    await user.click(screen.getByRole('button', { name: /save new password/i }));

    expect(resetPassword).toHaveBeenCalledWith({
      token,
      password: 'GoodPassword1',
      confirmPassword: 'GoodPassword1',
    });
    expect(screen.getByText(/password updated/i)).toBeInTheDocument();
    expect(screen.getByText(/signed out/i)).toBeInTheDocument();
  });

  it('shows the backend message when the token is stale', async () => {
    searchParams = new URLSearchParams({ token: 't'.repeat(43) });
    resetPassword.mockRejectedValue(
      new ApiClientError(
        'This password reset link is invalid or has expired. Please request a new one.',
        400,
        [],
        'RESET_TOKEN_INVALID',
      ),
    );
    const user = userEvent.setup();
    render(<ResetPasswordPage />);

    await user.type(screen.getByLabelText(/^new password/i), 'GoodPassword1');
    await user.type(screen.getByLabelText(/confirm new password/i), 'GoodPassword1');
    await user.click(screen.getByRole('button', { name: /save new password/i }));

    expect(screen.getByText(/invalid or has expired/i)).toBeInTheDocument();
    // Still on the form, so the user can retry with a fresh link.
    expect(
      screen.getByRole('button', { name: /save new password/i }),
    ).toBeInTheDocument();
  });
});
