/**
 * Convert a duration string like "15m", "30d", "12h", "45s" or a raw number of
 * seconds into milliseconds. Used to align cookie maxAge and refresh-token DB
 * expiry with the configured JWT lifetimes.
 */
const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

export function durationToMs(value: string): number {
  const match = /^(\d+)\s*([smhd])?$/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid duration string: "${value}"`);
  }
  const amount = Number(match[1]);
  const unit = match[2];
  // A bare number is interpreted as seconds (matching jsonwebtoken semantics).
  return unit ? amount * UNIT_MS[unit] : amount * 1000;
}
