/**
 * Sub-fire structure of the front (RESEARCH.md §1.9).
 *
 * A large wildfire is not one uniform line: it advances as discrete HEADS
 * (the 10–20 most active sub-fires along the perimeter) plus ember-ignited
 * SPOT FIRES downwind. Hotspots here are local maxima of the modeled outward
 * spread rate around the frontier; spot fires ignite downwind of the
 * strongest heads with exponentially-distributed distances bounded by the
 * observed record for moderate Santa Ana gusts (Witch AAR ≈800 m max),
 * deterministic per timeline chunk (seeded PRNG) so the picture is stable.
 */
import { HOTSPOTS, SPOT_FIRES, WIND } from '../data/spreadModelConfig';
import {
  cellIndexAt,
  getTerrainGrid,
  stepSpeed,
  type SeedPoint,
} from './arrivalTimeModel';
import { resampleRing, ringCentroid, type LatLng } from './interpolatePolygon';

const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG = 92_100;

export interface Hotspot {
  point: LatLng;
  /** Outward unit normal at the frontier (east, north). */
  nx: number;
  ny: number;
  /** Modeled local outward spread rate, m/min. */
  headRateMpm: number;
  /** Rate normalized across the current hotspot set, 0..1. */
  strength: number;
}

const RING_SAMPLES = 96;

function distM(a: LatLng, b: LatLng): number {
  return Math.hypot((a.lat - b.lat) * M_PER_DEG_LAT, (a.lng - b.lng) * M_PER_DEG_LNG);
}

/**
 * Detect the front's active heads: sample the frontier, score each sample by
 * the model's outward spread rate just ahead of it, smooth around the ring,
 * then greedily keep well-separated local maxima (strongest first).
 */
export function detectHotspots(front: LatLng[]): Hotspot[] {
  const g = getTerrainGrid();
  const ring = resampleRing(front, RING_SAMPLES);
  const centroid = ringCentroid(front);
  const n = ring.length;

  const normals: Array<{ nx: number; ny: number }> = new Array(n);
  let rates = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = ring[i];
    const prev = ring[(i - 1 + n) % n];
    const next = ring[(i + 1) % n];
    const tx = (next.lng - prev.lng) * M_PER_DEG_LNG;
    const ty = (next.lat - prev.lat) * M_PER_DEG_LAT;
    const tLen = Math.hypot(tx, ty) || 1;
    let nx = ty / tLen;
    let ny = -tx / tLen;
    const ox = (p.lng - centroid.lng) * M_PER_DEG_LNG;
    const oy = (p.lat - centroid.lat) * M_PER_DEG_LAT;
    if (nx * ox + ny * oy < 0) {
      nx = -nx;
      ny = -ny;
    }
    normals[i] = { nx, ny };
    const probe: LatLng = {
      lat: p.lat + (ny * HOTSPOTS.probeOffsetM) / M_PER_DEG_LAT,
      lng: p.lng + (nx * HOTSPOTS.probeOffsetM) / M_PER_DEG_LNG,
    };
    rates[i] = stepSpeed(g, cellIndexAt(g, probe.lat, probe.lng), nx, ny);
  }

  // 1-2-1 ring smoothing (two passes) so heads read as coherent tongues.
  for (let pass = 0; pass < 2; pass++) {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = (rates[(i - 1 + n) % n] + 2 * rates[i] + rates[(i + 1) % n]) / 4;
    }
    rates = out;
  }

  // Rank all samples by rate; greedily keep separated picks, preferring
  // local maxima (every local max is naturally ranked above its neighbors).
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => rates[b] - rates[a]);
  const picked: number[] = [];
  for (const i of order) {
    if (picked.length >= HOTSPOTS.maxCount) break;
    if (picked.some((j) => distM(ring[i], ring[j]) < HOTSPOTS.separationM)) continue;
    picked.push(i);
  }
  // If separation starved the set below the minimum, relax spacing once.
  if (picked.length < HOTSPOTS.minCount) {
    for (const i of order) {
      if (picked.length >= HOTSPOTS.minCount) break;
      if (picked.includes(i)) continue;
      if (picked.some((j) => distM(ring[i], ring[j]) < HOTSPOTS.separationM * 0.55)) continue;
      picked.push(i);
    }
  }

  const min = Math.min(...picked.map((i) => rates[i]));
  const max = Math.max(...picked.map((i) => rates[i]));
  const span = Math.max(max - min, 1e-6);
  return picked
    .map((i) => ({
      point: ring[i],
      nx: normals[i].nx,
      ny: normals[i].ny,
      headRateMpm: rates[i],
      strength: (rates[i] - min) / span,
    }))
    .sort((a, b) => b.headRateMpm - a.headRateMpm);
}

export interface SpotFire {
  point: LatLng;
  /** Minutes (from the schedule's evaluation time) until established ignition. */
  delayMin: number;
}

/** Deterministic small PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Ember spot fires downwind of the strongest heads. `seedKey` should change
 * only every few simulated minutes (e.g. interval index × time bucket) so
 * placements are stable between model refreshes.
 */
export function scheduleSpotFires(hotspots: Hotspot[], seedKey: number): SpotFire[] {
  const g = getTerrainGrid();
  const random = mulberry32(seedKey * 2654435761 + 97);
  const bearing = (WIND.spreadBearingDeg * Math.PI) / 180;
  const spots: SpotFire[] = [];
  const sources = hotspots.filter((h) => h.headRateMpm >= SPOT_FIRES.minHeadRateMpm);
  for (const source of sources) {
    if (spots.length >= SPOT_FIRES.maxActive) break;
    if (random() > 0.55) continue; // stochastic ignition (no deterministic law exists)
    const dist = Math.min(-Math.log(1 - random()) * SPOT_FIRES.meanDistM, SPOT_FIRES.maxDistM);
    if (dist < 90) continue; // inside the head's own immediate run
    const jitter = ((random() - 0.5) * 36 * Math.PI) / 180;
    const dx = Math.sin(bearing + jitter) * dist;
    const dy = Math.cos(bearing + jitter) * dist;
    const point: LatLng = {
      lat: source.point.lat + dy / M_PER_DEG_LAT,
      lng: source.point.lng + dx / M_PER_DEG_LNG,
    };
    if (
      point.lat < g.latMin ||
      point.lat > g.latMin + (g.rows - 1) * g.dLat ||
      point.lng < g.lngMin ||
      point.lng > g.lngMin + (g.cols - 1) * g.dLng
    ) {
      continue;
    }
    const cell = cellIndexAt(g, point.lat, point.lng);
    if (g.developed[cell]) continue; // brands on pavement/irrigated blocks
    spots.push({ point, delayMin: SPOT_FIRES.ignitionDelayMin * (0.7 + 0.6 * random()) });
  }
  return spots;
}

/** Spot fires as extra Dijkstra seeds for the arrival field. */
export function spotSeeds(spots: SpotFire[]): SeedPoint[] {
  return spots.map((s) => ({ lat: s.point.lat, lng: s.point.lng, delayMin: s.delayMin }));
}
