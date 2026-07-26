import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env';
import { logger } from './logger';

/**
 * Outbound email gateway. Uses SMTP when configured (SMTP_HOST set); otherwise
 * falls back to structured logging so development and pre-SMTP environments
 * keep working — the verification code is visible in the server logs instead
 * of an inbox. Tests spy on `mailer.sendVerificationEmail` and never send.
 */

interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

let transporterPromise: Promise<Transporter | null> | null = null;

/** Lazily build the SMTP transporter (or null when SMTP is not configured). */
function getTransporter(): Promise<Transporter | null> {
  if (!transporterPromise) {
    transporterPromise = Promise.resolve(
      env.SMTP_HOST
        ? nodemailer.createTransport({
            host: env.SMTP_HOST,
            port: env.SMTP_PORT,
            secure: env.SMTP_SECURE,
            auth:
              env.SMTP_USER && env.SMTP_PASS
                ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
                : undefined,
            // Bounded waits. Without these, nodemailer's defaults let a blocked
            // or silently-dropping SMTP host hold the caller for minutes — which
            // is exactly what happened the first time real SMTP was configured.
            // Failing fast is strictly better here: the send is retried by the
            // email.send job with backoff.
            connectionTimeout: env.SMTP_TIMEOUT_MS,
            greetingTimeout: env.SMTP_TIMEOUT_MS,
            socketTimeout: env.SMTP_TIMEOUT_MS,
          })
        : null,
    );
  }
  return transporterPromise;
}

export const mailer = {
  /** True when a real SMTP transport is configured. */
  isConfigured(): boolean {
    return Boolean(env.SMTP_HOST);
  },

  async sendEmail(input: SendEmailInput): Promise<void> {
    const transporter = await getTransporter();

    if (!transporter) {
      // Fallback delivery channel: the operator reads the code from logs.
      logger.warn('SMTP not configured — email logged instead of sent', {
        to: input.to,
        subject: input.subject,
        text: input.text,
      });
      return;
    }

    await transporter.sendMail({
      from: env.EMAIL_FROM,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
  },

  /** Send the registration verification code. */
  async sendVerificationEmail(input: {
    to: string;
    fullName: string;
    code: string;
  }): Promise<void> {
    const ttlMinutes = Math.round(env.EMAIL_VERIFICATION_CODE_TTL_MS / 60000);
    const subject = 'Verify your email address';
    const text = [
      `Hi ${input.fullName},`,
      '',
      `Your verification code is: ${input.code}`,
      '',
      `The code expires in ${ttlMinutes} minutes. If you did not create an`,
      'account, you can safely ignore this email.',
    ].join('\n');
    const html = [
      `<p>Hi ${escapeHtml(input.fullName)},</p>`,
      '<p>Your verification code is:</p>',
      `<p style="font-size:28px;font-weight:bold;letter-spacing:6px">${input.code}</p>`,
      `<p>The code expires in ${ttlMinutes} minutes. If you did not create an account, you can safely ignore this email.</p>`,
    ].join('\n');

    await mailer.sendEmail({ to: input.to, subject, text, html });
  },

  /**
   * Send a password reset link. The URL contains the ONLY copy of the raw
   * token (the database holds just its hash), so if this email is not
   * delivered the request is simply lost and the user asks again.
   */
  async sendPasswordResetEmail(input: {
    to: string;
    fullName: string;
    resetUrl: string;
  }): Promise<void> {
    const ttlMinutes = Math.round(env.PASSWORD_RESET_TOKEN_TTL_MS / 60000);
    const subject = 'Reset your password';
    const text = [
      `Hi ${input.fullName},`,
      '',
      'Use the link below to choose a new password:',
      input.resetUrl,
      '',
      `The link expires in ${ttlMinutes} minutes and can be used once.`,
      'If you did not request a password reset, you can safely ignore this',
      'email — your current password still works.',
    ].join('\n');
    const url = escapeHtml(input.resetUrl);
    const html = [
      `<p>Hi ${escapeHtml(input.fullName)},</p>`,
      '<p>Use the link below to choose a new password:</p>',
      `<p><a href="${url}" style="font-weight:bold">Reset my password</a></p>`,
      `<p style="word-break:break-all;color:#64748b;font-size:12px">${url}</p>`,
      `<p>The link expires in ${ttlMinutes} minutes and can be used once. If you did not request a password reset, you can safely ignore this email — your current password still works.</p>`,
    ].join('\n');

    await mailer.sendEmail({ to: input.to, subject, text, html });
  },
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
