/**
 * Route risk scoring against the modeled fire.
 *
 * Pure and renderer-free: candidates (road polylines + duration/distance) are
 * sampled and checked against the current front polygon, the predicted
 * "Likely spread in next N minutes" envelope, and the active tendrils.
 *
 * Hard rules (route REJECTED):
 *  - any sample inside the current fire polygon
 *  - any sample within the front buffer
 *  - entering (or re-entering) the predicted envelope after the initial
 *    escape segment — if the user starts inside the modeled risk area, the
 *    route may pass through it only while continuously escaping
 *  - a destination inside the envelope
 *
 * Soft penalties (score; lower is better): duration, distance, proximity to
 * the envelope, tendril-buffer crossings, driving toward the fire while near
 * it, riding canyon corridors near the envelope, and the length of the
 * initial escape segment. These never legitimize a hard-rejected route, and
 * if every candidate is rejected the app says so instead of faking safety.
 */
import { EVACUATION } from '../data/spreadModelConfig';
import { cellIndexAt, getTerrainGrid } from './arrivalTimeModel';
import type { SafeDestination } from '../data/demoEvacuationData';
import {
  bearingDeg,
  distToPolylineM,
  distToRingM,
  pathLengthM,
  pointInRing,
  resamplePath,
  type FireRiskSnapshot,
} from './fireRiskGeometry';
import type { LatLng } from './interpolatePolygon';

export interface RouteCandidate {
  destination: SafeDestination;
  path: LatLng[];
  distanceM: number;
  durationS: number;
  source: 'google' | 'synthetic';
}

export type RouteStatus = 'safe' | 'caution' | 'rejected';

export interface ScoredRoute {
  candidate: RouteCandidate;
  status: RouteStatus;
  /** Lower is better; Infinity when rejected. */
  score: number;
  reasons: string[];
  minFrontDistM: number;
  minEnvelopeDistM: number;
  escapeM: number;
}

export type UserRiskClass = 'in-fire' | 'near-front' | 'in-envelope' | 'clear';

export function classifyUserRisk(point: LatLng, snapshot: FireRiskSnapshot): UserRiskClass {
  if (pointInRing(point, snapshot.frontRing)) return 'in-fire';
  if (distToRingM(point, snapshot.frontRing) < EVACUATION.frontBufferM) return 'near-front';
  if (snapshot.envelopeRing && pointInRing(point, snapshot.envelopeRing)) return 'in-envelope';
  return 'clear';
}

export function scoreRoute(candidate: RouteCandidate, snapshot: FireRiskSnapshot): ScoredRoute {
  const reasons: string[] = [];
  const samples = resamplePath(candidate.path, EVACUATION.sampleStepM);
  const grid = getTerrainGrid();

  let minFrontDistM = Infinity;
  let minEnvelopeDistM = Infinity;
  let escapeM = 0;
  let escaped = false;
  let rejected = false;
  let tendrilHits = 0;
  let towardFireSum = 0;
  let canyonSum = 0;
  let nearCount = 0;

  const destInEnvelope =
    snapshot.envelopeRing !== null &&
    pointInRing(candidate.path[candidate.path.length - 1], snapshot.envelopeRing);
  if (destInEnvelope) {
    rejected = true;
    reasons.push('destination inside predicted fire-risk envelope');
  }

  for (let i = 0; i < samples.length && !rejected; i++) {
    const p = samples[i];
    const frontDist = distToRingM(p, snapshot.frontRing);
    minFrontDistM = Math.min(minFrontDistM, frontDist);
    const insideFire = pointInRing(p, snapshot.frontRing);
    const insideEnvelope =
      snapshot.envelopeRing !== null && pointInRing(p, snapshot.envelopeRing);
    if (snapshot.envelopeRing) {
      minEnvelopeDistM = Math.min(
        minEnvelopeDistM,
        insideEnvelope ? 0 : distToRingM(p, snapshot.envelopeRing),
      );
    }

    if (insideFire) {
      rejected = true;
      reasons.push('crosses current modeled fire area');
      break;
    }
    if (frontDist < EVACUATION.frontBufferM) {
      // Only tolerable while still escaping the immediate origin area.
      if (escaped || i > 0) {
        rejected = true;
        reasons.push('passes within the active-front buffer');
        break;
      }
    }

    if (insideEnvelope) {
      if (escaped) {
        rejected = true;
        reasons.push('crosses the predicted fire-risk envelope');
        break;
      }
      escapeM += EVACUATION.sampleStepM;
    } else {
      escaped = true;
    }

    // soft factors, evaluated near the risk area only
    const envDist = snapshot.envelopeRing ? minEnvelopeDistM : frontDist;
    if (!insideEnvelope && envDist < 500) {
      nearCount += 1 - envDist / 500;
    }
    if (envDist < 1500 && i + 1 < samples.length) {
      for (const tendril of snapshot.tendrils) {
        if (distToPolylineM(p, tendril) < EVACUATION.tendrilBufferM) {
          tendrilHits++;
          break;
        }
      }
      const travel = bearingDeg(p, samples[i + 1]);
      const toFire = bearingDeg(p, snapshot.fireCentroid);
      const diff = Math.abs(((travel - toFire + 540) % 360) - 180);
      if (diff > 135) towardFireSum += 1; // heading within ±45° of the fire
      canyonSum += grid.canyon[cellIndexAt(grid, p.lat, p.lng)];
    }
  }

  if (rejected) {
    return {
      candidate,
      status: 'rejected',
      score: Infinity,
      reasons,
      minFrontDistM,
      minEnvelopeDistM,
      escapeM,
    };
  }

  const distanceM = candidate.distanceM || pathLengthM(candidate.path);
  const durationMin = (candidate.durationS || (distanceM / 1000) * 90) / 60;
  const w = EVACUATION.score;
  const score =
    durationMin * w.perMinute +
    (distanceM / 1000) * w.perKm +
    (nearCount / Math.max(samples.length, 1)) * 100 * (w.envelopeProximity / 6) +
    tendrilHits * w.tendrilCross +
    (towardFireSum / Math.max(samples.length, 1)) * 100 * (w.towardFire / 3) +
    (canyonSum / Math.max(samples.length, 1)) * 100 * (w.canyon / 1.5) * 0.1 +
    (escapeM / 1000) * w.escapePerKm;

  const status: RouteStatus =
    escapeM > 0 || minEnvelopeDistM < EVACUATION.envelopeCautionM ? 'caution' : 'safe';
  if (status === 'caution') reasons.push('route passes near the modeled fire-risk area');

  return { candidate, status, score, reasons, minFrontDistM, minEnvelopeDistM, escapeM };
}

export function chooseBestRoute(
  candidates: RouteCandidate[],
  snapshot: FireRiskSnapshot,
): { best: ScoredRoute | null; scored: ScoredRoute[] } {
  const scored = candidates.map((c) => scoreRoute(c, snapshot));
  let best: ScoredRoute | null = null;
  for (const s of scored) {
    if (s.status === 'rejected') continue;
    if (!best || s.score < best.score) best = s;
  }
  return { best, scored };
}
