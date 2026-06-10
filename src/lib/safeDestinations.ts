/**
 * Destination filtering: a candidate destination is only offered when it is
 * itself clear of the modeled risk (outside the current fire and predicted
 * envelope, with margin). In demo mode the candidates come from
 * demoEvacuationData and are explicitly labelled simulated.
 */
import { DEMO_SAFE_DESTINATIONS, type SafeDestination } from '../data/demoEvacuationData';
import { EVACUATION } from '../data/spreadModelConfig';
import { distToRingM, pointInRing, type FireRiskSnapshot } from './fireRiskGeometry';

export function isDestinationViable(
  destination: SafeDestination,
  snapshot: FireRiskSnapshot,
): boolean {
  const p = destination.position;
  if (pointInRing(p, snapshot.frontRing)) return false;
  if (distToRingM(p, snapshot.frontRing) < EVACUATION.destination.frontMarginM) return false;
  if (snapshot.envelopeRing) {
    if (pointInRing(p, snapshot.envelopeRing)) return false;
    if (distToRingM(p, snapshot.envelopeRing) < EVACUATION.destination.envelopeMarginM) {
      return false;
    }
  }
  return true;
}

/** Demo destinations that are currently clear of the modeled risk. */
export function viableDestinations(snapshot: FireRiskSnapshot | null): SafeDestination[] {
  if (!snapshot) return DEMO_SAFE_DESTINATIONS;
  return DEMO_SAFE_DESTINATIONS.filter((d) => isDestinationViable(d, snapshot));
}

export type { SafeDestination };
