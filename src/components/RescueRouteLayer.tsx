/**
 * The suggested way out on the 3D map: a bright blue Google-Maps-style path
 * (white casing + blue line, draped on terrain along the authored road
 * geometry) and a green-highlighted safe zone with a labelled marker at the
 * destination. Flies the camera to frame the whole escape when the route
 * appears or changes.
 */
import { useEffect, useRef } from 'react';
import type { SafeDestination } from '../data/helpScenario';
import { bearingDeg, circleRing, pathLengthM } from '../lib/fireRiskGeometry';
import type { LatLng } from '../lib/interpolatePolygon';
import { customizePins, makeMarker, setMarkerLabel } from '../lib/markerUtils';
import type { SceneHandle } from './FireScene';

const TRANSPARENT = 'rgba(0, 0, 0, 0)';
const ROUTE_CASING = 'rgba(255, 255, 255, 0.7)';
const ROUTE_BLUE = 'rgba(26, 115, 232, 0.96)';
const SAFE_ZONE_FILL = 'rgba(24, 128, 56, 0.24)';
const SAFE_ZONE_STROKE = 'rgba(52, 168, 83, 0.95)';
const SAFE_ZONE_RADIUS_M = 170;

interface RescueRouteLayerProps {
  scene: SceneHandle;
  routePath: LatLng[] | null;
  destination: SafeDestination | null;
}

interface Elements {
  casing: google.maps.maps3d.Polyline3DElement;
  line: google.maps.maps3d.Polyline3DElement;
  safeZone: google.maps.maps3d.Polygon3DElement;
  marker: google.maps.maps3d.Marker3DElement;
}

export default function RescueRouteLayer({
  scene,
  routePath,
  destination,
}: RescueRouteLayerProps) {
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
    const safeZone = new scene.lib.Polygon3DElement({
      altitudeMode: scene.clampMode,
      fillColor: TRANSPARENT,
      strokeColor: TRANSPARENT,
      strokeWidth: 2.5,
      extruded: false,
      drawsOccludedSegments: false,
    });
    scene.map.append(safeZone);
    const elements: Elements = {
      casing: makeLine(9),
      line: makeLine(5.5),
      safeZone,
      marker,
    };
    elementsRef.current = elements;
    return () => {
      elements.casing.remove();
      elements.line.remove();
      elements.safeZone.remove();
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
      elements.safeZone.fillColor = TRANSPARENT;
      elements.safeZone.strokeColor = TRANSPARENT;
      elements.marker.remove();
      framedDestinationRef.current = null;
      return;
    }
    elements.casing.coordinates = routePath;
    elements.casing.strokeColor = ROUTE_CASING;
    elements.line.coordinates = routePath;
    elements.line.strokeColor = ROUTE_BLUE;
    // green safe-zone highlight draped around the destination
    elements.safeZone.outerCoordinates = circleRing(destination.position, SAFE_ZONE_RADIUS_M, 40);
    elements.safeZone.fillColor = SAFE_ZONE_FILL;
    elements.safeZone.strokeColor = SAFE_ZONE_STROKE;
    elements.marker.position = { ...destination.position, altitude: 0 };
    setMarkerLabel(elements.marker, destination.name);
    if (!elements.marker.isConnected) scene.map.append(elements.marker);

    // Frame the route once per destination so the person + safe zone fit.
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
