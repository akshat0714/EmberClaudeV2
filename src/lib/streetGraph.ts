/**
 * Real street network for evacuation routing.
 *
 * scripts/fetch-streets.mjs bundles an OpenStreetMap extract
 * (© OpenStreetMap contributors, ODbL) of every drivable public road in the
 * West Hills / Hidden Hills / Calabasas / Woodland Hills area as a junction
 * graph: nodes are intersections, edges carry full street geometry, the real
 * street name, the OSM oneway restriction and the signed speed limit where
 * one is mapped.
 *
 * This module loads that graph, builds adjacency + a uniform spatial hash of
 * edge segments (for GPS → street snapping), and exposes helpers used by the
 * router, the turn-by-turn generator and the terrain model (road density →
 * which fire-model cells are developed).
 */
import type { LatLng } from './interpolatePolygon';

const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG = 92_100; // at ~34.18° N

export interface StreetEdge {
  /** Junction node indices. */
  a: number;
  b: number;
  /** Full geometry from node a to node b: [lat, lng] pairs. */
  pts: Array<[number, number]>;
  /** OSM highway class (residential, primary, ...). */
  hw: string;
  /** Street name (real OSM name tag) when mapped. */
  name?: string;
  /** 1 = travel only a→b, -1 = only b→a, undefined = both ways. */
  ow?: 1 | -1;
  /** Signed speed limit, km/h, when mapped. */
  kmh?: number;
  /** Total length in meters (computed at load). */
  lenM: number;
}

export interface StreetGraph {
  attribution: string;
  bbox: { latMin: number; lngMin: number; latMax: number; lngMax: number };
  nodes: Array<[number, number]>;
  edges: StreetEdge[];
  /** Edge indices incident to each node. */
  adjacency: number[][];
}

export interface SnapResult {
  edgeIndex: number;
  /** Index of the segment within the edge geometry. */
  segIndex: number;
  /** Position along that segment, 0..1. */
  t: number;
  point: LatLng;
  /** Snap distance from the query point, meters. */
  distM: number;
  /** Distance from edge start (node a) along the geometry, meters. */
  alongM: number;
}

export function distMeters(a: LatLng, b: LatLng): number {
  return Math.hypot((a.lat - b.lat) * M_PER_DEG_LAT, (a.lng - b.lng) * M_PER_DEG_LNG);
}

let graph: StreetGraph | null = null;
let pending: Promise<StreetGraph> | null = null;

/** Spatial hash: cell key -> edge segment refs, for fast snapping. */
const SPATIAL_CELL_DEG = 0.0018; // ~200 m
let spatial: Map<string, Array<{ edge: number; seg: number }>> | null = null;

function cellKey(lat: number, lng: number): string {
  return `${Math.floor(lat / SPATIAL_CELL_DEG)},${Math.floor(lng / SPATIAL_CELL_DEG)}`;
}

function buildSpatialIndex(g: StreetGraph): void {
  spatial = new Map();
  const add = (lat: number, lng: number, ref: { edge: number; seg: number }) => {
    const key = cellKey(lat, lng);
    const list = spatial!.get(key);
    if (list) list.push(ref);
    else spatial!.set(key, [ref]);
  };
  g.edges.forEach((edge, edgeIndex) => {
    for (let s = 0; s + 1 < edge.pts.length; s++) {
      const [aLat, aLng] = edge.pts[s];
      const [bLat, bLng] = edge.pts[s + 1];
      const ref = { edge: edgeIndex, seg: s };
      // register the segment in every spatial cell its bbox touches
      const r0 = Math.floor(Math.min(aLat, bLat) / SPATIAL_CELL_DEG);
      const r1 = Math.floor(Math.max(aLat, bLat) / SPATIAL_CELL_DEG);
      const c0 = Math.floor(Math.min(aLng, bLng) / SPATIAL_CELL_DEG);
      const c1 = Math.floor(Math.max(aLng, bLng) / SPATIAL_CELL_DEG);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          add((r + 0.5) * SPATIAL_CELL_DEG, (c + 0.5) * SPATIAL_CELL_DEG, ref);
        }
      }
    }
  });
}

export type RawStreetGraph = Omit<StreetGraph, 'adjacency' | 'edges'> & {
  edges: Array<Omit<StreetEdge, 'lenM'>>;
};

function buildFromRaw(raw: RawStreetGraph): StreetGraph {
  const adjacency: number[][] = raw.nodes.map(() => []);
  const edges: StreetEdge[] = raw.edges.map((e, i) => {
    let lenM = 0;
    for (let s = 0; s + 1 < e.pts.length; s++) {
      lenM += Math.hypot(
        (e.pts[s + 1][0] - e.pts[s][0]) * M_PER_DEG_LAT,
        (e.pts[s + 1][1] - e.pts[s][1]) * M_PER_DEG_LNG,
      );
    }
    adjacency[e.a].push(i);
    adjacency[e.b].push(i);
    return { ...e, lenM };
  });
  const built = { ...raw, edges, adjacency };
  graph = built;
  buildSpatialIndex(built);
  return built;
}

/** Direct injection for Node-side tests (no fetch). */
export function setStreetGraphData(raw: RawStreetGraph): StreetGraph {
  const built = buildFromRaw(raw);
  pending = Promise.resolve(built);
  return built;
}

const baseUrl = (): string =>
  typeof import.meta.env !== 'undefined' ? import.meta.env.BASE_URL : '/';

export function loadStreetGraph(): Promise<StreetGraph> {
  if (pending) return pending;
  pending = fetch(`${baseUrl()}data/streets.json`).then(async (res) => {
    if (!res.ok) throw new Error(`streets.json HTTP ${res.status}`);
    return buildFromRaw((await res.json()) as RawStreetGraph);
  });
  return pending;
}

export function getStreetGraph(): StreetGraph | null {
  return graph;
}

/**
 * Snap a GPS position to the nearest street. Searches the spatial hash in
 * growing rings; returns null when nothing lies within `maxDistM`.
 */
export function snapToStreet(point: LatLng, maxDistM = 250): SnapResult | null {
  if (!graph || !spatial) return null;
  const baseR = Math.floor(point.lat / SPATIAL_CELL_DEG);
  const baseC = Math.floor(point.lng / SPATIAL_CELL_DEG);
  let best: SnapResult | null = null;
  const maxRing = Math.ceil(maxDistM / (SPATIAL_CELL_DEG * M_PER_DEG_LAT)) + 1;

  const seen = new Set<string>();
  for (let ring = 0; ring <= maxRing; ring++) {
    // Once a candidate is found, finish the next ring and stop — a nearer
    // segment can only appear one ring further out.
    for (let dr = -ring; dr <= ring; dr++) {
      for (let dc = -ring; dc <= ring; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
        const refs = spatial.get(`${baseR + dr},${baseC + dc}`);
        if (!refs) continue;
        for (const ref of refs) {
          const refKey = `${ref.edge}:${ref.seg}`;
          if (seen.has(refKey)) continue;
          seen.add(refKey);
          const edge = graph.edges[ref.edge];
          const [aLat, aLng] = edge.pts[ref.seg];
          const [bLat, bLng] = edge.pts[ref.seg + 1];
          const ax = (point.lng - aLng) * M_PER_DEG_LNG;
          const ay = (point.lat - aLat) * M_PER_DEG_LAT;
          const vx = (bLng - aLng) * M_PER_DEG_LNG;
          const vy = (bLat - aLat) * M_PER_DEG_LAT;
          const len2 = vx * vx + vy * vy || 1;
          const t = Math.max(0, Math.min(1, (ax * vx + ay * vy) / len2));
          const snapped: LatLng = {
            lat: aLat + (bLat - aLat) * t,
            lng: aLng + (bLng - aLng) * t,
          };
          const d = distMeters(point, snapped);
          if (d <= maxDistM && (!best || d < best.distM)) {
            let alongM = 0;
            for (let s = 0; s < ref.seg; s++) {
              alongM += Math.hypot(
                (edge.pts[s + 1][0] - edge.pts[s][0]) * M_PER_DEG_LAT,
                (edge.pts[s + 1][1] - edge.pts[s][1]) * M_PER_DEG_LNG,
              );
            }
            alongM += t * Math.hypot(vy, vx);
            best = { edgeIndex: ref.edge, segIndex: ref.seg, t, point: snapped, distM: d, alongM };
          }
        }
      }
    }
    if (best && ring > 0) break;
  }
  return best;
}

/**
 * Count road geometry points within each cell of an arbitrary lat/lng grid —
 * used by the terrain model to mark developed (urban-fabric) cells and
 * single-road fuel breaks from REAL street data instead of hand-drawn
 * rectangles. Geometry is walked at ~15 m steps.
 */
export function roadPointCounts(
  latMin: number,
  lngMin: number,
  dLat: number,
  dLng: number,
  rows: number,
  cols: number,
): Uint16Array {
  const counts = new Uint16Array(rows * cols);
  if (!graph) return counts;
  const STEP_M = 15;
  for (const edge of graph.edges) {
    for (let s = 0; s + 1 < edge.pts.length; s++) {
      const [aLat, aLng] = edge.pts[s];
      const [bLat, bLng] = edge.pts[s + 1];
      const segLen = Math.hypot((bLat - aLat) * M_PER_DEG_LAT, (bLng - aLng) * M_PER_DEG_LNG);
      const steps = Math.max(1, Math.round(segLen / STEP_M));
      for (let k = 0; k <= steps; k++) {
        const lat = aLat + ((bLat - aLat) * k) / steps;
        const lng = aLng + ((bLng - aLng) * k) / steps;
        const r = Math.round((lat - latMin) / dLat);
        const c = Math.round((lng - lngMin) / dLng);
        if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
        const i = r * cols + c;
        if (counts[i] < 65535) counts[i]++;
      }
    }
  }
  return counts;
}

/** Bearing a→b in degrees clockwise from north. */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const x = (b.lng - a.lng) * M_PER_DEG_LNG;
  const y = (b.lat - a.lat) * M_PER_DEG_LAT;
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
}

/** Edge geometry oriented for travel from `fromNode`. */
export function orientedPoints(edge: StreetEdge, fromNode: number): Array<[number, number]> {
  return edge.a === fromNode ? edge.pts : [...edge.pts].reverse();
}
