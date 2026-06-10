/**
 * Official Kenneth Fire incident facts (CAL FIRE / LAFD).
 *
 * These are fixed historical facts displayed verbatim. The app never invents
 * intermediate acreage figures or minute-by-minute perimeters — everything
 * animated on the map comes from timestamped NASA FIRMS satellite detections.
 */
export const KENNETH_FIRE = {
  name: 'Kenneth Fire',
  startLabel: 'Jan 9, 2025, 3:34 PM PST',
  startIso: '2025-01-09T15:34:00-08:00',
  containedLabel: 'Jan 12, 2025, 7:48 AM PST',
  containedIso: '2025-01-12T07:48:00-08:00',
  finalAcres: 1052,
  location: 'Victory Boulevard west of Gilmore Street, West Hills',
  lat: 34.185198,
  lon: -118.66991,
} as const;

export const DISCLAIMER_SHORT =
  'Continuous animation from timestamped satellite detections — not real-time emergency guidance.';

export const DISCLAIMER_LONG =
  'Historical visualization using satellite detections and official incident facts. Not emergency guidance.';

/** The animated polygon is a smoothed hull around detections, not a mapped fire perimeter. */
export const ENVELOPE_LABEL = 'Observed satellite detection envelope';
