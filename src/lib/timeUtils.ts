/**
 * Time formatting and small math helpers for the reconstruction timeline.
 * The Kenneth Fire burned in Los Angeles, so times display in
 * America/Los_Angeles (PST during the January 2025 incident).
 */

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

/** e.g. "Jan 9, 2025, 3:45 PM PST" */
export function formatPacific(ms: number): string {
  return pacificFull.format(ms);
}

/** e.g. "3:45 PM PST" */
export function formatPacificTime(ms: number): string {
  return pacificTime.format(ms);
}

/** e.g. "Thu, Jan 9, 2025" */
export function formatPacificDate(ms: number): string {
  return pacificDate.format(ms);
}

/** e.g. "Jan 9, 23:45 UTC" */
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
