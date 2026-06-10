/**
 * Suggested evacuation route on the 3D map: a bright blue Google-Maps-style
 * path (white casing + blue line, draped on terrain) and a green safe-zone
 * marker labelled with the simulated destination name. Flies the camera to
 * frame the route when the destination changes.
 */
import { useEffect, useRef } from 'react';
import type { SafeDestination } from '../data/demoEvacuationData';
import { bearingDeg, pathLengthM } from '../lib/fireRiskGeometry';
import type { LatLng } from '../lib/interpolatePolygon';
import { customizePins, makeMarker, setMarkerLabel } from '../lib/markerUtils';
import type { SceneHandle } from './FireScene';

const TRANSPARENT = 'rgba(0, 0, 0, 0)';
const ROUTE_CASING = 'rgba(255, 255, 255, 0.65)';
const ROUTE_BLUE = 'rgba(26, 115, 232, 0.95)';

interface EvacuationRouteLayerProps {
  scene: SceneHandle;
  routePath: LatLng[] | null;
  destination: SafeDestination | null;
}

interface Elements {
  casing: google.maps.maps3d.Polyline3DElement;
  line: google.maps.maps3d.Polyline3DElement;
  marker: google.maps.maps3d.Marker3DElement;
}

export default function EvacuationRouteLayer({
  scene,
  routePath,
  destination,
}: EvacuationRouteLayerProps) {
  const elementsRef = useRef<Elements | null>(null);
  const framedDestinationRef = useRef<string | null>(null);

  useEffect(() => {
    const makeLine = (width: number) => {
      const line = new scene.lib.Polyline3DElement({
        altitudeMode: scene.clampMode,
        strokeColor: TRANSPARENT,
        strokeWidth: width,
        drawsOccludedSegments: false,
      });
      scene.map.append(line);
      return line;
    };
    const marker = makeMarker(scene.lib, scene.clampMode, undefined, { lat: 0, lng: 0 });
    customizePins([{ marker, background: '#188038', scale: 0.8 }]);
    const elements: Elements = {
      casing: makeLine(8),
      line: makeLine(5),
      marker,
    };
    elementsRef.current = elements;
    return () => {
      elements.casing.remove();
      elements.line.remove();
      elements.marker.remove();
      elementsRef.current = null;
    };
  }, [scene]);

  useEffect(() => {
    const elements = elementsRef.current;
    if (!elements) return;
    if (!routePath || routePath.length < 2 || !destination) {
      elements.casing.strokeColor = TRANSPARENT;
      elements.line.strokeColor = TRANSPARENT;
      elements.marker.remove();
      return;
    }
    elements.casing.coordinates = routePath;
    elements.casing.strokeColor = ROUTE_CASING;
    elements.line.coordinates = routePath;
    elements.line.strokeColor = ROUTE_BLUE;
    elements.marker.position = { ...destination.position, altitude: 0 };
    setMarkerLabel(elements.marker, destination.name);
    if (!elements.marker.isConnected) scene.map.append(elements.marker);

    // Frame the route once per destination so judges see origin + safe zone.
    if (framedDestinationRef.current !== destination.id) {
      framedDestinationRef.current = destination.id;
      const start = routePath[0];
      const end = routePath[routePath.length - 1];
      const mid = { lat: (start.lat + end.lat) / 2, lng: (start.lng + end.lng) / 2 };
      const range = Math.min(Math.max(pathLengthM(routePath) * 1.4, 2600), 9000);
      scene.map.flyCameraTo({
        endCamera: {
          center: { ...mid, altitude: 280 },
          range,
          tilt: 55,
          heading: bearingDeg(start, end),
        },
        durationMillis: 1800,
      });
    }
  }, [routePath, destination, scene]);

  return null;
}
