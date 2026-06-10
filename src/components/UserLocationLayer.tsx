/**
 * Google-Maps-style user location, draped on the 3D terrain: blue dot with a
 * white ring, translucent accuracy circle, and an optional heading wedge.
 * Also handles "pick on map" by listening for map clicks while picking.
 */
import { useEffect, useRef } from 'react';
import { circleRing, headingWedge } from '../lib/fireRiskGeometry';
import type { LatLng } from '../lib/interpolatePolygon';
import type { LocationFix } from '../lib/userLocation';
import type { SceneHandle } from './FireScene';

const TRANSPARENT = 'rgba(0, 0, 0, 0)';
const DOT_RADIUS_M = 15;
const RING_RADIUS_M = 21;
const WEDGE_SIZE_M = 30;

interface UserLocationLayerProps {
  scene: SceneHandle;
  fix: LocationFix | null;
  picking: boolean;
  onPick?: (point: LatLng) => void;
}

interface Elements {
  accuracy: google.maps.maps3d.Polygon3DElement;
  ring: google.maps.maps3d.Polygon3DElement;
  dot: google.maps.maps3d.Polygon3DElement;
  wedge: google.maps.maps3d.Polygon3DElement;
}

export default function UserLocationLayer({ scene, fix, picking, onPick }: UserLocationLayerProps) {
  const elementsRef = useRef<Elements | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    const make = (fill: string, stroke: string, strokeWidth: number) => {
      const poly = new scene.lib.Polygon3DElement({
        altitudeMode: scene.clampMode,
        fillColor: fill,
        strokeColor: stroke,
        strokeWidth,
        extruded: false,
        drawsOccludedSegments: false,
      });
      scene.map.append(poly);
      return poly;
    };
    const elements: Elements = {
      accuracy: make('rgba(66, 133, 244, 0.14)', 'rgba(66, 133, 244, 0.35)', 1),
      wedge: make('rgba(66, 133, 244, 0.55)', TRANSPARENT, 0),
      ring: make('rgba(255, 255, 255, 0.95)', 'rgba(0, 0, 0, 0.12)', 1),
      dot: make('rgba(66, 133, 244, 0.98)', TRANSPARENT, 0),
    };
    elementsRef.current = elements;
    return () => {
      Object.values(elements).forEach((el) => el.remove());
      elementsRef.current = null;
    };
  }, [scene]);

  useEffect(() => {
    const elements = elementsRef.current;
    if (!elements) return;
    if (!fix) {
      Object.values(elements).forEach((el) => {
        el.fillColor = TRANSPARENT;
        el.strokeColor = TRANSPARENT;
      });
      return;
    }
    const center = { lat: fix.lat, lng: fix.lng };
    const accuracyR = Math.min(Math.max(fix.accuracyM, 25), 400);
    elements.accuracy.outerCoordinates = circleRing(center, accuracyR, 48);
    elements.accuracy.fillColor = 'rgba(66, 133, 244, 0.14)';
    elements.accuracy.strokeColor = 'rgba(66, 133, 244, 0.35)';
    elements.ring.outerCoordinates = circleRing(center, RING_RADIUS_M, 28);
    elements.ring.fillColor = 'rgba(255, 255, 255, 0.95)';
    elements.ring.strokeColor = 'rgba(0, 0, 0, 0.12)';
    elements.dot.outerCoordinates = circleRing(center, DOT_RADIUS_M, 28);
    elements.dot.fillColor = 'rgba(66, 133, 244, 0.98)';
    if (fix.headingDeg !== null) {
      elements.wedge.outerCoordinates = headingWedge(center, fix.headingDeg, WEDGE_SIZE_M);
      elements.wedge.fillColor = 'rgba(66, 133, 244, 0.55)';
    } else {
      elements.wedge.fillColor = TRANSPARENT;
    }
  }, [fix]);

  // "Drop my location": while picking, a click on the 3D map sets the fix.
  useEffect(() => {
    if (!picking) return;
    const handler = (event: Event) => {
      const position = (event as Event & { position?: { lat?: number; lng?: number } }).position;
      if (
        position &&
        typeof position.lat === 'number' &&
        typeof position.lng === 'number'
      ) {
        onPickRef.current?.({ lat: position.lat, lng: position.lng });
      }
    };
    scene.map.addEventListener('gmp-click', handler);
    return () => scene.map.removeEventListener('gmp-click', handler);
  }, [picking, scene]);

  return null;
}
