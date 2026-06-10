/**
 * Bridges the fire model to the router: a FireHazard answering "how many
 * minutes from NOW until fire reaches this point?" from a routing-horizon
 * arrival field (NAV.routingCapMinutes), corrected for simulation time that
 * has passed since the field was computed.
 *
 * After the reconstruction ends (the historical fire stopped), the burned
 * footprint stays an exclusion zone (roads inside it closed) and everywhere
 * else is safe — matching the recorded event.
 */
import { SPREAD_STAGES } from '../data/kennethReconstruction';
import { NAV } from '../data/navConfig';
import {
  cellIndexAt,
  computeArrivalField,
  type ArrivalField,
} from './arrivalTimeModel';
import type { FireSnapshot } from './fireState';
import { spotSeedsOf } from './fireState';
import type { FireHazard } from './fireAwareRouter';
import { pointInRing, type LatLng } from './interpolatePolygon';

export interface HazardField {
  field: ArrivalField | null;
  /** Sim time at which the field's t=0 sits. */
  fieldSimTimeMs: number;
  atEnd: boolean;
}

const FINAL_RING = SPREAD_STAGES[SPREAD_STAGES.length - 1].ring;

/** Compute a fresh routing-horizon field from a fire snapshot. */
export function computeHazardField(snapshot: FireSnapshot): HazardField {
  if (snapshot.atEnd) {
    return { field: null, fieldSimTimeMs: snapshot.simTimeMs, atEnd: true };
  }
  return {
    field: computeArrivalField(snapshot.front, NAV.routingCapMinutes, spotSeedsOf(snapshot)),
    fieldSimTimeMs: snapshot.simTimeMs,
    atEnd: false,
  };
}

/** A FireHazard for the router, evaluated at the current sim time. */
export function hazardAt(state: HazardField, simTimeMs: number): FireHazard {
  const elapsedMin = (simTimeMs - state.fieldSimTimeMs) / 60_000;
  if (state.atEnd) {
    return {
      arrivalMinutes(p: LatLng): number {
        return pointInRing(p, FINAL_RING) ? -1 : Infinity;
      },
    };
  }
  const field = state.field;
  if (!field) return { arrivalMinutes: () => Infinity };
  const g = field.grid;
  const latMax = g.latMin + (g.rows - 1) * g.dLat;
  const lngMax = g.lngMin + (g.cols - 1) * g.dLng;
  return {
    arrivalMinutes(p: LatLng): number {
      // outside the modeled grid: beyond any plausible spread in the horizon
      if (p.lat < g.latMin || p.lat > latMax || p.lng < g.lngMin || p.lng > lngMax) {
        return Infinity;
      }
      const a = field.arrival[cellIndexAt(g, p.lat, p.lng)];
      return Number.isFinite(a) ? a - elapsedMin : Infinity;
    },
  };
}
