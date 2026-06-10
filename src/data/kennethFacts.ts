/**
 * Official Kenneth Fire incident facts (CAL FIRE / LAFD).
 *
 * These are fixed historical facts displayed verbatim. Spread-stage geometry
 * shown on the map is a labelled reconstruction (see kennethReconstruction.ts)
 * — the app never presents it as a surveyed perimeter, and the only acreage
 * figure shown is the official final size.
 */
export const KENNETH_FIRE = {
  name: 'Kenneth Fire',
  startLabel: 'Jan 9, 2025, 3:34 PM PT',
  startIso: '2025-01-09T15:34:00-08:00',
  containedLabel: 'Jan 12, 2025, 7:48 AM PT',
  containedIso: '2025-01-12T07:48:00-08:00',
  finalAcres: 1052,
  location: 'Victory Blvd west of Gilmore St, West Hills',
  lat: 34.185198,
  lng: -118.66991,
} as const;

export const APP_TITLE = 'Kenneth Fire';
export const APP_SUBTITLE = '3D historical fire-spread reconstruction';
export const APP_TAGLINE = 'Continuous reconstruction of spread over terrain and structures';

export const MODE_LABEL = 'Reconstruction';

export const DISCLAIMER =
  'Observed and reconstructed spread zones with model-based spread potential. Not an official perimeter. Not emergency guidance.';
