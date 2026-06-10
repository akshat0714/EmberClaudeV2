/**
 * Scenario facts for the simulated urban fire.
 *
 * This is a SIMULATED scenario — a single home igniting in the West Hills
 * residential grid under the real Santa Ana conditions of January 9, 2025
 * (the Kenneth Fire day), spreading ember-to-ember from house to house
 * until it becomes a wind-driven neighborhood fire region. It is not a real
 * incident and the app never presents it as one.
 */
export const SCENARIO = {
  name: 'West Hills urban fire (simulated)',
  startLabel: 'Jan 9, 2025, 3:34 PM PT',
  startIso: '2025-01-09T15:34:00-08:00',
  conditionsLabel: 'Santa Ana wind event — strong, dry NE wind',
  finalAcres: 121,
  location: 'Residential block north of Victory Blvd, West Hills',
  lat: 34.1908,
  lng: -118.6555,
} as const;

export const APP_TITLE = 'Ember';
export const APP_SUBTITLE = 'Urban fire spread & guided evacuation';
export const APP_TAGLINE = 'One house, to a block, to a neighborhood — and a way out';

export const MODE_LABEL = 'Simulated scenario';

export const DISCLAIMER =
  'Simulated urban fire scenario with model-based spread potential. Not a real incident. Not emergency guidance.';
