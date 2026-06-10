/**
 * Official Kenneth Fire incident facts (CAL FIRE / LAFD / NWS — verified,
 * see RESEARCH.md §3).
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
  containedLabel: 'Jan 12, 2025',
  containedIso: '2025-01-12T07:48:00-08:00',
  finalAcres: 1052,
  location: 'Victory Blvd west of Gilmore St, West Hills',
  lat: 34.185198,
  lng: -118.66991,
} as const;

/** Verified weather that afternoon (VNY ASOS + NWS Red Flag Warning). */
export const KENNETH_WEATHER = {
  summary: 'N–NE wind 15–22 mph, gusts to ~31 mph · RH 5–6% · Red Flag Warning',
  source: 'Van Nuys ASOS observations + NWS RFW, Jan 9 2025',
} as const;

export const APP_TITLE = 'Ember';
export const APP_SUBTITLE = 'Wildfire spread prediction & evacuation navigator';
export const APP_TAGLINE = 'Kenneth Fire scenario — real terrain, real streets, research-based model';

export const MODE_LABEL = 'Simulation';

export const DISCLAIMER =
  'Research-based fire simulation over a reconstructed historical scenario. Not an official perimeter. Not emergency guidance — always follow official alerts.';
