/**
 * Simulated urban fire-spread stages — West Hills residential grid.
 *
 * The scenario: one home ignites on a block north of Victory Blvd during a
 * Santa Ana wind event, embers carry to the neighboring houses, the block
 * becomes involved, fire crosses street to street, and by evening it is a
 * wind-driven neighborhood fire region elongated downwind (toward the
 * west-south-west, like the real January 2025 fires).
 *
 * Stage rings are generated deterministically: wind-aligned ellipses with a
 * fixed irregular wobble (same wobble field at every stage, so each ring
 * nests strictly inside the next — verified by the smoke test). Growth and
 * timing are believable for ember-driven house-to-house spread; this is a
 * SIMULATION, not a surveyed perimeter.
 */
import type { LatLng } from '../lib/interpolatePolygon';
import { WIND } from './spreadModelConfig';

const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG = 92_100; // at ~34.19° N

/** The house where the fire starts. */
export const IGNITION_POINT: LatLng = { lat: 34.1908, lng: -118.6555 };

/**
 * Wind-aligned ellipse with a fixed radial wobble. The wobble is a function
 * of vertex angle only (not of stage), so scaled-up stages strictly contain
 * earlier ones as long as radii outgrow the centre drift.
 */
function stageRing(driftM: number, rxM: number, ryM: number): LatLng[] {
  const n = 96;
  const wind = (WIND.spreadBearingDeg * Math.PI) / 180;
  // unit vectors: u along the wind (head axis), v across it
  const ux = Math.sin(wind);
  const uy = Math.cos(wind);
  const cx = IGNITION_POINT.lng + (driftM * ux) / M_PER_DEG_LNG;
  const cy = IGNITION_POINT.lat + (driftM * uy) / M_PER_DEG_LAT;
  const out: LatLng[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    // deterministic irregularity, identical at every stage
    const wobble = 1 + 0.06 * Math.sin(a * 3 + 1.7) + 0.04 * Math.sin(a * 7 + 4.2);
    const ex = Math.cos(a) * rxM * wobble;
    const ey = Math.sin(a) * ryM * wobble;
    // rotate ellipse axes into the wind frame
    const dxM = ex * ux + ey * -uy;
    const dyM = ex * uy + ey * ux;
    out.push({
      lat: cy + dyM / M_PER_DEG_LAT,
      lng: cx + dxM / M_PER_DEG_LNG,
    });
  }
  return out;
}

export interface SpreadStage {
  id: string;
  name: string;
  /** Short label shown on the timeline, e.g. "3:52 PM". */
  timeLabel: string;
  /** Stage time used by the animation clock. */
  timeIso: string;
  description: string;
  /**
   * Accent colors for UI chips/legends. On the map itself, reached stages
   * render as dark-red burned-history fills (see spreadModelConfig).
   */
  fillColor: string;
  strokeColor: string;
  /** Open ring (no repeated end vertex). */
  ring: LatLng[];
}

export const SPREAD_STAGES: SpreadStage[] = [
  {
    id: 'house',
    name: 'Ignition — one house',
    timeLabel: '3:34 PM',
    timeIso: '2025-01-09T15:34:00-08:00',
    description: 'A single home catches fire on a residential block north of Victory Blvd.',
    fillColor: 'rgba(255, 216, 70, 0.55)',
    strokeColor: 'rgba(255, 232, 150, 0.95)',
    ring: stageRing(0, 16, 13),
  },
  {
    id: 'neighbors',
    name: 'Neighboring homes',
    timeLabel: '3:52 PM',
    timeIso: '2025-01-09T15:52:00-08:00',
    description: 'Wind-carried embers ignite the next few houses downwind.',
    fillColor: 'rgba(255, 173, 51, 0.46)',
    strokeColor: 'rgba(255, 196, 110, 0.92)',
    ring: stageRing(22, 50, 38),
  },
  {
    id: 'block',
    name: 'Block burning',
    timeLabel: '4:25 PM',
    timeIso: '2025-01-09T16:25:00-08:00',
    description: 'The row of homes is involved; spot fires jump across the street.',
    fillColor: 'rgba(255, 126, 28, 0.42)',
    strokeColor: 'rgba(255, 158, 80, 0.92)',
    ring: stageRing(77, 130, 95),
  },
  {
    id: 'streets',
    name: 'Across the streets',
    timeLabel: '5:15 PM',
    timeIso: '2025-01-09T17:15:00-08:00',
    description: 'House-to-house spread street by street through the neighborhood.',
    fillColor: 'rgba(235, 78, 22, 0.40)',
    strokeColor: 'rgba(255, 120, 70, 0.92)',
    ring: stageRing(172, 280, 190),
  },
  {
    id: 'region',
    name: 'Neighborhood region',
    timeLabel: '6:30 PM',
    timeIso: '2025-01-09T18:30:00-08:00',
    description: 'A wind-driven urban fire region, elongated downwind. Simulated size ≈121 acres.',
    fillColor: 'rgba(158, 30, 32, 0.38)',
    strokeColor: 'rgba(205, 75, 70, 0.92)',
    ring: stageRing(312, 520, 300),
  },
];

export interface StructureEdge {
  id: string;
  name: string;
  /** On-terrain label wording for this edge. */
  label: string;
  description: string;
  /** Stage index at which this developed edge first lies on the spread boundary. */
  activeFromStage: number;
  ring: LatLng[];
  /** The boundary-facing chain of the band (used for the dashed edge line). */
  edgeLine: LatLng[];
}

/**
 * In the urban scenario the fire is IN the structures, so there are no
 * separate structure-adjacent edge bands; the concept stays in the model
 * (developed-area resistance) but draws nothing.
 */
export const STRUCTURE_EDGES: StructureEdge[] = [];

/** Camera framing for the photorealistic 3D scene. */
export const SCENE_CAMERA = {
  /** Wide establishing view used before the fly-in. */
  initial: {
    center: { lat: 34.1885, lng: -118.6565, altitude: 280 },
    range: 14000,
    tilt: 38,
    heading: -25,
  },
  /** Main view: from the south-east, looking across the neighborhood. */
  main: {
    center: { lat: 34.189, lng: -118.6572, altitude: 270 },
    range: 2900,
    tilt: 64,
    heading: -38,
  },
  flyInMillis: 4500,
} as const;
