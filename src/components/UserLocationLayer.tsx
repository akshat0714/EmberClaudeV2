/**
 * The person's position on the 3D terrain: a clear Google-Maps-style BLUE
 * DOT — soft blue halo, white ring, solid blue dot, and a heading wedge
 * while they move — plus a small blue "You" pin so the position reads even
 * from a wide camera. Flies the camera to the fix when it first appears
 * (the "GPS located" moment).
 */
import { useEffect, useRef } from 'react';
import { circleRing, headingWedge } from '../lib/fireRiskGeometry';
import type { LocationFix } from '../lib/userLocation';
import { customizePins, makeMarker } from '../lib/markerUtils';
import type { SceneHandle } from './FireScene';

const TRANSPARENT = 'rgba(0, 0, 0, 0)';
const HALO_RADIUS_M = 42;
const RING_RADIUS_M = 23;
const DOT_RADIUS_M = 16;
const WEDGE_SIZE_M = 32;

const HALO_FILL = 'rgba(66, 133, 244, 0.20)';
const HALO_STROKE = 'rgba(66, 133, 244, 0.45)';
const RING_FILL = 'rgba(255, 255, 255, 0.96)';
const RING_STROKE = 'rgba(0, 0, 0, 0.12)';
const DOT_FILL = 'rgba(26, 115, 232, 0.98)';
const WEDGE_FILL = 'rgba(66, 133, 244, 0.55)';

interface UserLocationLayerProps {
  scene: SceneHandle;
  fix: LocationFix | null;
}

interface Elements {
  halo: google.maps.maps3d.Polygon3DElement;
  wedge: google.maps.maps3d.Polygon3DElement;
  ring: google.maps.maps3d.Polygon3DElement;
  dot: google.maps.maps3d.Polygon3DElement;
  label: google.maps.maps3d.Marker3DElement;
}

export default function UserLocationLayer({ scene, fix }: UserLocationLayerProps) {
  const elementsRef = useRef<Elements | null>(null);
  const flownRef = useRef(false);

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
    const label = makeMarker(scene.lib, scene.clampMode, 'You (simulated GPS)', {
      lat: 0,
      lng: 0,
    });
    customizePins([{ marker: label, background: '#1a73e8', scale: 0.75 }]);
    const elements: Elements = {
      halo: make(HALO_FILL, HALO_STROKE, 1),
      wedge: make(WEDGE_FILL, TRANSPARENT, 0),
      ring: make(RING_FILL, RING_STROKE, 1),
      dot: make(DOT_FILL, TRANSPARENT, 0),
      label,
    };
    elementsRef.current = elements;
    flownRef.current = false;
    return () => {
      elements.halo.remove();
      elements.wedge.remove();
      elements.ring.remove();
      elements.dot.remove();
      elements.label.remove();
      elementsRef.current = null;
    };
  }, [scene]);

  useEffect(() => {
    const elements = elementsRef.current;
    if (!elements) return;
    if (!fix) {
      for (const el of [elements.halo, elements.wedge, elements.ring, elements.dot]) {
        el.fillColor = TRANSPARENT;
        el.strokeColor = TRANSPARENT;
      }
      elements.label.remove();
      return;
    }
    const center = { lat: fix.lat, lng: fix.lng };
    elements.halo.outerCoordinates = circleRing(center, HALO_RADIUS_M, 48);
    elements.halo.fillColor = HALO_FILL;
    elements.halo.strokeColor = HALO_STROKE;
    elements.ring.outerCoordinates = circleRing(center, RING_RADIUS_M, 28);
    elements.ring.fillColor = RING_FILL;
    elements.ring.strokeColor = RING_STROKE;
    elements.dot.outerCoordinates = circleRing(center, DOT_RADIUS_M, 28);
    elements.dot.fillColor = DOT_FILL;
    if (fix.headingDeg !== null) {
      elements.wedge.outerCoordinates = headingWedge(center, fix.headingDeg, WEDGE_SIZE_M);
      elements.wedge.fillColor = WEDGE_FILL;
    } else {
      elements.wedge.fillColor = TRANSPARENT;
    }
    elements.label.position = { ...center, altitude: 0 };
    if (!elements.label.isConnected) scene.map.append(elements.label);

    // The "GPS located" moment: bring the camera to the person once.
    if (!flownRef.current) {
      flownRef.current = true;
      scene.map.flyCameraTo({
        endCamera: { center: { ...center, altitude: 320 }, range: 2300, tilt: 62, heading: 20 },
        durationMillis: 2200,
      });
    }
  }, [fix, scene]);

  return null;
}
