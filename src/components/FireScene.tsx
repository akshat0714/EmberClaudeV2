/**
 * Photorealistic 3D scene (Google Maps JS API, maps3d library).
 *
 * Visual layers, bottom to top:
 *  1. Stage zone bands — each reconstruction interval is its own draped,
 *     semi-transparent colored band (outer ring = stage, hole = previous
 *     stage), so progression reads like a clean layered geographic map.
 *  2. Active growth band + moving front line — between stage times the front
 *     ring is interpolated outward and the area behind it fills with the next
 *     stage's color, so growth is continuous instead of popping.
 *  3. Structure-edge bands — pale bands where the footprint meets the West
 *     Hills / Hidden Hills neighborhood edges.
 *  4. Ignition marker — "Reported start area".
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  IGNITION_POINT,
  SCENE_CAMERA,
  SPREAD_STAGES,
  STRUCTURE_EDGES,
} from '../data/kennethReconstruction';
import {
  closeRing,
  interpolateRings,
  prepareTransition,
} from '../lib/interpolatePolygon';
import { loadMaps3D } from '../lib/loadGoogleMaps';
import { clamp, countAtOrBefore, smoothstep01 } from '../lib/timeUtils';

const TRANSPARENT = 'rgba(0, 0, 0, 0)';
const STRUCTURE_FILL = 'rgba(255, 250, 235, 0.30)';
const STRUCTURE_STROKE = 'rgba(255, 255, 250, 0.95)';
const FRONT_RING_VERTICES = 96;

type Paintable = google.maps.maps3d.Polygon3DElement;

// Cache the last colors we set so we don't churn the web components with
// redundant property writes 60 times a second.
const lastPaint = new WeakMap<object, { fill?: string; stroke?: string }>();

function setFill(el: Paintable, color: string): void {
  const cached = lastPaint.get(el) ?? {};
  if (cached.fill !== color) {
    el.fillColor = color;
    cached.fill = color;
    lastPaint.set(el, cached);
  }
}

function setStroke(el: Paintable, color: string): void {
  const cached = lastPaint.get(el) ?? {};
  if (cached.stroke !== color) {
    el.strokeColor = color;
    cached.stroke = color;
    lastPaint.set(el, cached);
  }
}

interface SceneRefs {
  map: google.maps.maps3d.Map3DElement;
  zones: google.maps.maps3d.Polygon3DElement[];
  structures: google.maps.maps3d.Polygon3DElement[];
  activeBand: google.maps.maps3d.Polygon3DElement;
  frontGlow: google.maps.maps3d.Polyline3DElement;
  frontLine: google.maps.maps3d.Polyline3DElement;
}

function buildScene(
  lib: google.maps.maps3d.Maps3DLibrary,
  container: HTMLElement,
): SceneRefs {
  const CLAMP = lib.AltitudeMode?.CLAMP_TO_GROUND ?? 'CLAMP_TO_GROUND';
  const map = new lib.Map3DElement({
    ...SCENE_CAMERA.initial,
    mode: lib.MapMode?.HYBRID ?? 'HYBRID',
  });
  map.style.width = '100%';
  map.style.height = '100%';
  container.appendChild(map);

  const zones = SPREAD_STAGES.map((stage, k) => {
    const poly = new lib.Polygon3DElement({
      altitudeMode: CLAMP,
      fillColor: TRANSPARENT,
      strokeColor: TRANSPARENT,
      strokeWidth: 1.5,
      extruded: false,
      drawsOccludedSegments: false,
    });
    poly.outerCoordinates = stage.ring;
    if (k > 0) poly.innerCoordinates = [SPREAD_STAGES[k - 1].ring];
    map.append(poly);
    return poly;
  });

  const activeBand = new lib.Polygon3DElement({
    altitudeMode: CLAMP,
    fillColor: TRANSPARENT,
    strokeColor: TRANSPARENT,
    strokeWidth: 0,
    extruded: false,
  });
  map.append(activeBand);

  const structures = STRUCTURE_EDGES.map((edge) => {
    const poly = new lib.Polygon3DElement({
      altitudeMode: CLAMP,
      fillColor: TRANSPARENT,
      strokeColor: TRANSPARENT,
      strokeWidth: 2,
      extruded: false,
    });
    poly.outerCoordinates = edge.ring;
    map.append(poly);
    return poly;
  });

  const frontGlow = new lib.Polyline3DElement({
    altitudeMode: CLAMP,
    strokeColor: 'rgba(255, 190, 80, 0.30)',
    strokeWidth: 10,
    drawsOccludedSegments: false,
  });
  map.append(frontGlow);

  const frontLine = new lib.Polyline3DElement({
    altitudeMode: CLAMP,
    strokeColor: 'rgba(255, 244, 180, 0.95)',
    strokeWidth: 4,
    drawsOccludedSegments: false,
  });
  map.append(frontLine);

  const marker = new lib.Marker3DElement({
    position: { ...IGNITION_POINT, altitude: 0 },
    label: 'Reported start area',
    altitudeMode: CLAMP,
    extruded: false,
  });
  map.append(marker);

  return { map, zones, structures, activeBand, frontGlow, frontLine };
}

interface FireSceneProps {
  apiKey: string;
  /** Reconstruction clock time (UTC ms). */
  time: number;
}

export default function FireScene({ apiKey, time }: FireSceneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SceneRefs | null>(null);
  const lastFrontRef = useRef({ interval: -1, p: -1, appliedAt: 0 });
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  const stageTimes = useMemo(() => SPREAD_STAGES.map((s) => Date.parse(s.timeIso)), []);
  const transitions = useMemo(
    () =>
      SPREAD_STAGES.slice(0, -1).map((stage, j) =>
        prepareTransition(stage.ring, SPREAD_STAGES[j + 1].ring, FRONT_RING_VERTICES),
      ),
    [],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let flyInTimer = 0;
    setPhase('loading');

    window.gm_authFailure = () => {
      setErrorMessage(
        'Google rejected the API key. Make sure VITE_GOOGLE_MAPS_API_KEY is valid, billing is enabled, and the "Maps JavaScript API" + "Map Tiles API" are enabled for the key.',
      );
      setPhase('error');
    };

    loadMaps3D(apiKey)
      .then((lib) => {
        if (disposed || !containerRef.current) return;
        sceneRef.current = buildScene(lib, containerRef.current);
        lastFrontRef.current = { interval: -1, p: -1, appliedAt: 0 };
        setPhase('ready');
        flyInTimer = window.setTimeout(() => {
          sceneRef.current?.map.flyCameraTo({
            endCamera: SCENE_CAMERA.main,
            durationMillis: SCENE_CAMERA.flyInMillis,
          });
        }, 700);
      })
      .catch((error: unknown) => {
        if (disposed) return;
        setErrorMessage(
          error instanceof Error ? error.message : 'The Google Maps 3D library failed to load.',
        );
        setPhase('error');
      });

    return () => {
      disposed = true;
      window.clearTimeout(flyInTimer);
      window.gm_authFailure = undefined;
      sceneRef.current?.map.remove();
      sceneRef.current = null;
    };
  }, [apiKey]);

  // Apply the reconstruction clock to the scene. Everything is a pure
  // function of `time`, so scrubbing in either direction just works.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || phase !== 'ready') return;

    const reachedStage = Math.max(0, countAtOrBefore(stageTimes, time) - 1);

    SPREAD_STAGES.forEach((stage, k) => {
      const visible = time >= stageTimes[k];
      setFill(scene.zones[k], visible ? stage.fillColor : TRANSPARENT);
      setStroke(scene.zones[k], visible ? stage.strokeColor : TRANSPARENT);
    });

    STRUCTURE_EDGES.forEach((edge, i) => {
      const visible = reachedStage >= edge.activeFromStage;
      setFill(scene.structures[i], visible ? STRUCTURE_FILL : TRANSPARENT);
      setStroke(scene.structures[i], visible ? STRUCTURE_STROKE : TRANSPARENT);
    });

    const interval = Math.min(reachedStage, SPREAD_STAGES.length - 2);
    const span = Math.max(stageTimes[interval + 1] - stageTimes[interval], 1);
    const atEnd = time >= stageTimes[stageTimes.length - 1];
    const p = atEnd ? 1 : clamp(smoothstep01((time - stageTimes[interval]) / span), 0.01, 1);

    const last = lastFrontRef.current;
    const now = performance.now();
    const geometryStale =
      interval !== last.interval || Math.abs(p - last.p) > 0.004 || (p === 1 && last.p !== 1);
    if (geometryStale && (interval !== last.interval || now - last.appliedAt > 45)) {
      const front = interpolateRings(transitions[interval], p);
      const closed = closeRing(front);
      scene.frontGlow.coordinates = closed;
      scene.frontLine.coordinates = closed;
      if (p >= 1) {
        // Resting exactly on a stage boundary — the static band shows this area.
        setFill(scene.activeBand, TRANSPARENT);
      } else {
        scene.activeBand.outerCoordinates = front;
        scene.activeBand.innerCoordinates = [transitions[interval].a];
        setFill(scene.activeBand, SPREAD_STAGES[interval + 1].fillColor);
      }
      lastFrontRef.current = { interval, p, appliedAt: now };
    }
  }, [time, phase, stageTimes, transitions]);

  // Gentle real-time pulse on the front line so "current position" is obvious
  // even while paused. Stroke-only updates, throttled.
  useEffect(() => {
    if (phase !== 'ready') return;
    let raf = 0;
    let lastApply = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - lastApply < 80) return;
      lastApply = now;
      const scene = sceneRef.current;
      if (!scene) return;
      const s = Math.sin((now / 1800) * Math.PI * 2);
      scene.frontLine.strokeWidth = 3.6 + 0.9 * s;
      scene.frontLine.strokeColor = `rgba(255, 244, 180, ${(0.82 + 0.15 * s).toFixed(3)})`;
      scene.frontGlow.strokeWidth = 9 + 2.2 * s;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  const recenter = () => {
    sceneRef.current?.map.flyCameraTo({ endCamera: SCENE_CAMERA.main, durationMillis: 1600 });
  };

  return (
    <div className="scene-shell">
      <div ref={containerRef} className="scene-container" />
      {phase === 'ready' && (
        <button className="recenter-btn glass" onClick={recenter} title="Reset the camera view">
          Recenter
        </button>
      )}
      {phase === 'loading' && (
        <div className="scene-overlay">
          <div className="scene-overlay-card glass">
            <div className="spinner" aria-hidden="true" />
            <p>Loading photorealistic 3D terrain…</p>
          </div>
        </div>
      )}
      {phase === 'error' && (
        <div className="scene-overlay">
          <div className="scene-overlay-card glass scene-error">
            <h2>3D map unavailable</h2>
            <p>{errorMessage}</p>
            <p className="scene-error-hint">
              The key goes in <code>.env</code> as <code>VITE_GOOGLE_MAPS_API_KEY</code> — restart{' '}
              <code>npm run dev</code> after changing it.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
