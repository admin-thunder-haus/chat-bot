import crypto from 'node:crypto';

/** Convert an arbitrary string into a URL-safe slug base. */
export function slugify(input: string): string {
  const base = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-') // non-alphanumerics -> hyphen
    .replace(/^-+|-+$/g, '') // trim leading/trailing hyphens
    .replace(/-{2,}/g, '-'); // collapse repeats

  return base || 'company';
}

/** Append a short random suffix to keep slugs unique when a base collides. */
export function withRandomSuffix(base: string): string {
  const suffix = crypto.randomBytes(3).toString('hex'); // 6 hex chars
  return `${base}-${suffix}`;
}
