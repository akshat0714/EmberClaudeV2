/**
 * Time helpers for FIRMS timestamps and the animation clock.
 *
 * FIRMS reports acquisition times in UTC. The Kenneth Fire burned in Los
 * Angeles, so times are displayed in America/Los_Angeles (PST during the
 * January 2025 incident) with the UTC original alongside.
 */

/**
 * Parse a FIRMS `acq_date` ("YYYY-MM-DD") and `acq_time` (UTC "HHMM", which
 * may lose leading zeros in some exports, e.g. "712" for 07:12) into a UTC
 * millisecond timestamp. Returns null when the row is malformed.
 */
export function parseFirmsTimestamp(acqDate: string, acqTime: string): number | null {
  const dateMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(acqDate.trim());
  if (!dateMatch) return null;
  const timeDigits = acqTime.trim();
  if (!/^\d{1,4}$/.test(timeDigits)) return null;
  const hhmm = timeDigits.padStart(4, '0');
  const hours = Number(hhmm.slice(0, 2));
  const minutes = Number(hhmm.slice(2, 4));
  if (hours > 23 || minutes > 59) return null;
  return Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]), hours, minutes);
}

const pacificFull = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});

const pacificTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});

const pacificDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const utcShort = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** e.g. "Jan 10, 2025, 2:12 AM PST" */
export function formatPacific(ms: number): string {
  return pacificFull.format(ms);
}

/** e.g. "2:12 AM PST" */
export function formatPacificTime(ms: number): string {
  return pacificTime.format(ms);
}

/** e.g. "Fri, Jan 10, 2025" */
export function formatPacificDate(ms: number): string {
  return pacificDate.format(ms);
}

/** e.g. "Jan 10, 10:12 UTC" */
export function formatUtc(ms: number): string {
  return `${utcShort.format(ms)} UTC`;
}

export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** Smoothstep ease, clamped to [0, 1]. */
export function smoothstep01(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

export function easeOutCubic(t: number): number {
  const x = clamp(t, 0, 1);
  return 1 - Math.pow(1 - x, 3);
}

/** Number of values in an ascending-sorted array that are <= t (binary search). */
export function countAtOrBefore(sortedTimes: readonly number[], t: number): number {
  let lo = 0;
  let hi = sortedTimes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedTimes[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
