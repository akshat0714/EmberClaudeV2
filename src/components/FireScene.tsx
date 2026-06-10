/**
 * Photorealistic 3D scene (Google Maps JS API, maps3d library).
 *
 * The map reads as a professional arrival-time overlay, bottom to top:
 *  1. Burned history — reached reconstruction intervals as subtle charcoal
 *     fills with faint past-arrival contour lines; terrain stays visible.
 *  2. Active growth band + bright pulsing front line — the clearest layer.
 *  3. Spread-potential bands — +15/+30/+60/+90 min iso-arrival contours from
 *     the minimum-travel-time model, recomputed as the timeline moves.
 *     Lower-confidence horizons render dashed. Labelled as potential only.
 *  4. Spread-pathway ribbons — minimum-travel-time routes that explain where
 *     and why the model expects movement (canyons, upslope, downwind).
 *  5. Structure-adjacent edges — faint fills plus dashed boundary lines where
 *     the footprint meets neighborhoods (no building damage implied).
 *  6. On-terrain labels — start area, current front, band horizons, edges.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  IGNITION_POINT,
  SCENE_CAMERA,
  SPREAD_STAGES,
  STRUCTURE_EDGES,
} from '../data/kennethReconstruction';
import {
  BURNED_STYLE,
  DASH,
  FRONT_STYLE,
  INNER_LEVEL_MINUTES,
  PATHWAY_STYLE,
  PREDICTION_BANDS,
  STRUCTURE_EDGE_STYLE,
  WIND,
} from '../data/spreadModelConfig';
import { computeArrivalField } from '../lib/arrivalTimeModel';
import {
  closeRing,
  interpolateRings,
  prepareTransition,
  type LatLng,
} from '../lib/interpolatePolygon';
import { loadMaps3D } from '../lib/loadGoogleMaps';
import {
  dashPath,
  dashRing,
  extractContour,
  extractPathways,
  leadingPoint,
} from '../lib/predictionBands';
import { summarizeDrivers, type ModelSummary } from '../lib/spreadDrivers';
import { clamp, countAtOrBefore, smoothstep01 } from '../lib/timeUtils';

const TRANSPARENT = 'rgba(0, 0, 0, 0)';
const FRONT_RING_VERTICES = 96;
/** Minimum real-time gap between model recomputes (Dijkstra + contours). */
const MODEL_REFRESH_MS = 900;

type Maps3D = google.maps.maps3d.Maps3DLibrary;
type Map3D = google.maps.maps3d.Map3DElement;
type Polygon3D = google.maps.maps3d.Polygon3DElement;
type Polyline3D = google.maps.maps3d.Polyline3DElement;
type Marker3D = google.maps.maps3d.Marker3DElement;

// Cache the last colors set so the web components aren't churned with
// redundant property writes 60 times a second.
const lastPaint = new WeakMap<object, { fill?: string; stroke?: string }>();

function setFill(el: Polygon3D, color: string): void {
  const cached = lastPaint.get(el) ?? {};
  if (cached.fill !== color) {
    el.fillColor = color;
    cached.fill = color;
    lastPaint.set(el, cached);
  }
}

function setStroke(el: Polygon3D, color: string): void {
  const cached = lastPaint.get(el) ?? {};
  if (cached.stroke !== color) {
    el.strokeColor = color;
    cached.stroke = color;
    lastPaint.set(el, cached);
  }
}

/** Show/hide an element by attaching/detaching it from the map. */
function setAttached(map: Map3D, el: HTMLElement, attached: boolean): void {
  if (attached && !el.isConnected) map.append(el);
  else if (!attached && el.isConnected) el.remove();
}

/** Reusable pool of polylines for dashes and pathway ribbons. */
class PolylinePool {
  private lines: Polyline3D[] = [];
  private used = 0;

  constructor(
    private lib: Maps3D,
    private map: Map3D,
    private altitudeMode: google.maps.maps3d.AltitudeModeValue,
  ) {}

  /** Create transparent lines up-front so render order stays deterministic. */
  prewarm(count: number): void {
    while (this.lines.length < count) this.lines.push(this.create());
  }

  private create(): Polyline3D {
    const line = new this.lib.Polyline3DElement({
      altitudeMode: this.altitudeMode,
      strokeColor: TRANSPARENT,
      strokeWidth: 0,
      drawsOccludedSegments: false,
    });
    this.map.append(line);
    return line;
  }

  begin(): void {
    this.used = 0;
  }

  draw(coordinates: LatLng[], color: string, width: number): void {
    const line = this.lines[this.used] ?? this.create();
    if (this.used >= this.lines.length) this.lines.push(line);
    line.coordinates = coordinates;
    line.strokeColor = color;
    line.strokeWidth = width;
    this.used++;
  }

  end(): void {
    for (let i = this.used; i < this.lines.length; i++) {
      const line = this.lines[i];
      if (line.strokeWidth !== 0) {
        line.strokeColor = TRANSPARENT;
        line.strokeWidth = 0;
      }
    }
  }

  hideAll(): void {
    this.begin();
    this.end();
  }
}

interface SceneRefs {
  lib: Maps3D;
  map: Map3D;
  zones: Polygon3D[];
  activeBand: Polygon3D;
  structureFills: Polygon3D[];
  structureEdgePools: PolylinePool[];
  structureDashSegments: LatLng[][][];
  structureMarkers: Marker3D[];
  predictionPolys: Polygon3D[];
  predictionDashPool: PolylinePool;
  pathwayPool: PolylinePool;
  frontGlow: Polyline3D;
  frontLine: Polyline3D;
  startMarker: Marker3D;
  frontMarker: Marker3D;
  bandMarkers: Array<Marker3D | null>;
}

function makeMarker(lib: Maps3D, clampMode: google.maps.maps3d.AltitudeModeValue, label: string, position: LatLng): Marker3D {
  return new lib.Marker3DElement({
    position: { ...position, altitude: 0 },
    label,
    altitudeMode: clampMode,
    extruded: false,
  });
}

/**
 * Best-effort replacement of the default red marker pins with small tinted
 * pins. Wrapped in try/catch — if the marker library or the slotted-pin
 * pattern is unavailable, the default pins still work.
 */
function customizePins(entries: Array<{ marker: Marker3D; background: string }>): void {
  void (async () => {
    try {
      const markerLib = (await google.maps.importLibrary('marker')) as {
        PinElement?: new (opts: Record<string, unknown>) => { element: HTMLElement };
      };
      if (!markerLib.PinElement) return;
      for (const { marker, background } of entries) {
        try {
          const pin = new markerLib.PinElement({
            background,
            borderColor: 'rgba(255, 255, 255, 0.9)',
            glyphColor: 'rgba(0, 0, 0, 0.3)',
            scale: 0.55,
          });
          const template = document.createElement('template');
          template.content.append(pin.element);
          marker.append(template);
        } catch {
          // keep the default pin for this marker
        }
      }
    } catch {
      // marker library unavailable — default pins are fine
    }
  })();
}

function buildScene(lib: Maps3D, container: HTMLElement): SceneRefs {
  const CLAMP = lib.AltitudeMode?.CLAMP_TO_GROUND ?? 'CLAMP_TO_GROUND';
  const map = new lib.Map3DElement({
    ...SCENE_CAMERA.initial,
    mode: lib.MapMode?.HYBRID ?? 'HYBRID',
  });
  map.style.width = '100%';
  map.style.height = '100%';
  container.appendChild(map);

  // 1. burned-history zones (reached reconstruction intervals)
  const zones = SPREAD_STAGES.map((stage, k) => {
    const poly = new lib.Polygon3DElement({
      altitudeMode: CLAMP,
      fillColor: TRANSPARENT,
      strokeColor: TRANSPARENT,
      strokeWidth: BURNED_STYLE.historyStrokeWidth,
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

  // 3. spread-potential bands (+15/+30/+60/+90); geometry assigned per recompute
  const predictionPolys = PREDICTION_BANDS.map((band) => {
    const poly = new lib.Polygon3DElement({
      altitudeMode: CLAMP,
      fillColor: TRANSPARENT,
      strokeColor: TRANSPARENT,
      strokeWidth: band.strokeWidth,
      extruded: false,
      drawsOccludedSegments: false,
    });
    map.append(poly);
    return poly;
  });

  // 5. structure-adjacent edges: faint fill + dashed boundary line
  const structureFills = STRUCTURE_EDGES.map((edge) => {
    const poly = new lib.Polygon3DElement({
      altitudeMode: CLAMP,
      fillColor: TRANSPARENT,
      strokeColor: TRANSPARENT,
      strokeWidth: 0,
      extruded: false,
    });
    poly.outerCoordinates = edge.ring;
    map.append(poly);
    return poly;
  });
  const structureDashSegments = STRUCTURE_EDGES.map((edge) =>
    dashPath(edge.edgeLine, STRUCTURE_EDGE_STYLE.dashMeters, STRUCTURE_EDGE_STYLE.gapMeters),
  );
  const structureEdgePools = structureDashSegments.map((segments) => {
    const pool = new PolylinePool(lib, map, CLAMP);
    pool.prewarm(segments.length);
    return pool;
  });

  // 4. pathway ribbons + dashed prediction outlines (prewarmed so the bright
  // front line, created after, always renders above them)
  const pathwayPool = new PolylinePool(lib, map, CLAMP);
  pathwayPool.prewarm(PATHWAY_STYLE.maxCount);
  const predictionDashPool = new PolylinePool(lib, map, CLAMP);
  predictionDashPool.prewarm(90);

  // 2. the current active front — brightest layer
  const frontGlow = new lib.Polyline3DElement({
    altitudeMode: CLAMP,
    strokeColor: FRONT_STYLE.glow,
    strokeWidth: 10,
    drawsOccludedSegments: false,
  });
  map.append(frontGlow);
  const frontLine = new lib.Polyline3DElement({
    altitudeMode: CLAMP,
    strokeColor: FRONT_STYLE.line,
    strokeWidth: 4,
    drawsOccludedSegments: false,
  });
  map.append(frontLine);

  // 6. on-terrain labels
  const startMarker = makeMarker(lib, CLAMP, 'Start area', IGNITION_POINT);
  map.append(startMarker);
  const frontMarker = makeMarker(lib, CLAMP, 'Current active front', IGNITION_POINT);
  map.append(frontMarker);
  const bandMarkers = PREDICTION_BANDS.map((band) =>
    band.labelled ? makeMarker(lib, CLAMP, band.label, IGNITION_POINT) : null,
  );
  bandMarkers.forEach((marker) => marker && map.append(marker));
  const structureMarkers = STRUCTURE_EDGES.map((edge) => {
    const mid = edge.edgeLine[Math.floor(edge.edgeLine.length / 2)];
    return makeMarker(lib, CLAMP, edge.label, mid);
  });

  customizePins([
    { marker: startMarker, background: '#ffd766' },
    { marker: frontMarker, background: '#ff9d3c' },
    ...bandMarkers.flatMap((marker, k) =>
      marker ? [{ marker, background: ['#f3c84f', '#e89a45', '#d9763f'][k] ?? '#d9763f' }] : [],
    ),
    ...structureMarkers.map((marker) => ({ marker, background: '#efe9da' })),
  ]);

  return {
    lib,
    map,
    zones,
    activeBand,
    structureFills,
    structureEdgePools,
    structureDashSegments,
    structureMarkers,
    predictionPolys,
    predictionDashPool,
    pathwayPool,
    frontGlow,
    frontLine,
    startMarker,
    frontMarker,
    bandMarkers,
  };
}

interface FireSceneProps {
  apiKey: string;
  /** Reconstruction clock time (UTC ms). */
  time: number;
  /** Receives the High/Medium/Low driver summary after each model refresh. */
  onModelUpdate?: (summary: ModelSummary) => void;
}

export default function FireScene({ apiKey, time, onModelUpdate }: FireSceneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SceneRefs | null>(null);
  const lastFrontRef = useRef({ interval: -1, p: -1, appliedAt: 0 });
  const modelRef = useRef({ interval: -1, p: -1, atEnd: false, lastAt: 0 });
  const structVisibleRef = useRef<boolean[]>(STRUCTURE_EDGES.map(() => false));
  const onModelUpdateRef = useRef(onModelUpdate);
  onModelUpdateRef.current = onModelUpdate;
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
        modelRef.current = { interval: -1, p: -1, atEnd: false, lastAt: 0 };
        structVisibleRef.current = STRUCTURE_EDGES.map(() => false);
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

  /** Recompute the arrival-time model and repaint every prediction layer. */
  const updatePrediction = (scene: SceneRefs, front: LatLng[], atEnd: boolean): void => {
    if (atEnd) {
      // Reconstruction complete: history + final perimeter stay, potential hides.
      for (const poly of scene.predictionPolys) {
        setFill(poly, TRANSPARENT);
        setStroke(poly, TRANSPARENT);
      }
      scene.predictionDashPool.hideAll();
      scene.pathwayPool.hideAll();
      scene.bandMarkers.forEach((marker) => marker && setAttached(scene.map, marker, false));
      setAttached(scene.map, scene.frontMarker, false);
      onModelUpdateRef.current?.({ drivers: summarizeDrivers(front), predictionActive: false });
      return;
    }

    const field = computeArrivalField(front);
    let inner: LatLng[] = extractContour(field, INNER_LEVEL_MINUTES) ?? front;

    scene.predictionDashPool.begin();
    PREDICTION_BANDS.forEach((band, k) => {
      const poly = scene.predictionPolys[k];
      const marker = scene.bandMarkers[k];
      const contour = extractContour(field, band.minutes);
      if (!contour) {
        setFill(poly, TRANSPARENT);
        setStroke(poly, TRANSPARENT);
        if (marker) setAttached(scene.map, marker, false);
        return;
      }
      poly.outerCoordinates = contour;
      poly.innerCoordinates = [inner];
      setFill(poly, band.fill);
      if (band.dashed) {
        setStroke(poly, TRANSPARENT);
        for (const segment of dashRing(contour, DASH.dashMeters, DASH.gapMeters)) {
          scene.predictionDashPool.draw(segment, band.stroke, band.strokeWidth);
        }
      } else {
        setStroke(poly, band.stroke);
      }
      if (marker) {
        marker.position = { ...leadingPoint(contour, WIND.spreadBearingDeg), altitude: 0 };
        setAttached(scene.map, marker, true);
      }
      inner = contour;
    });
    scene.predictionDashPool.end();

    scene.pathwayPool.begin();
    const pathways = extractPathways(field, {
      minMinutes: PREDICTION_BANDS[PREDICTION_BANDS.length - 1].minutes * 0.8,
      maxMinutes: PREDICTION_BANDS[PREDICTION_BANDS.length - 1].minutes + 4,
      maxCount: PATHWAY_STYLE.maxCount,
      separationMeters: 700,
      minRunMeters: 800,
    });
    for (const path of pathways) {
      scene.pathwayPool.draw(path, PATHWAY_STYLE.stroke, PATHWAY_STYLE.width);
    }
    scene.pathwayPool.end();

    scene.frontMarker.position = { ...leadingPoint(front, WIND.spreadBearingDeg), altitude: 0 };
    setAttached(scene.map, scene.frontMarker, true);

    onModelUpdateRef.current?.({ drivers: summarizeDrivers(front), predictionActive: true });
  };

  // Apply the reconstruction clock to the scene. Everything is a pure
  // function of `time`, so scrubbing in either direction just works.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || phase !== 'ready') return;

    const reachedStage = Math.max(0, countAtOrBefore(stageTimes, time) - 1);
    const atEnd = time >= stageTimes[stageTimes.length - 1];

    // 1. burned history: subtle charcoal fills + faint past contours
    SPREAD_STAGES.forEach((_, k) => {
      const visible = time >= stageTimes[k];
      const fill = !visible
        ? TRANSPARENT
        : k === reachedStage
          ? BURNED_STYLE.recentFill
          : BURNED_STYLE.olderFill;
      setFill(scene.zones[k], fill);
      setStroke(scene.zones[k], visible ? BURNED_STYLE.historyStroke : TRANSPARENT);
    });

    // 5. structure-adjacent edges appear once the spread reaches them
    STRUCTURE_EDGES.forEach((edge, i) => {
      const visible = reachedStage >= edge.activeFromStage;
      if (visible === structVisibleRef.current[i]) return;
      structVisibleRef.current[i] = visible;
      setFill(scene.structureFills[i], visible ? STRUCTURE_EDGE_STYLE.fill : TRANSPARENT);
      const pool = scene.structureEdgePools[i];
      if (visible) {
        pool.begin();
        for (const segment of scene.structureDashSegments[i]) {
          pool.draw(segment, STRUCTURE_EDGE_STYLE.dashColor, STRUCTURE_EDGE_STYLE.dashWidth);
        }
        pool.end();
      } else {
        pool.hideAll();
      }
      setAttached(scene.map, scene.structureMarkers[i], visible);
    });

    // 2. moving front between stages
    const interval = Math.min(reachedStage, SPREAD_STAGES.length - 2);
    const span = Math.max(stageTimes[interval + 1] - stageTimes[interval], 1);
    const p = atEnd ? 1 : clamp(smoothstep01((time - stageTimes[interval]) / span), 0.01, 1);

    const last = lastFrontRef.current;
    const now = performance.now();
    let front: LatLng[] | null = null;
    const geometryStale =
      interval !== last.interval || Math.abs(p - last.p) > 0.004 || (p === 1 && last.p !== 1);
    if (geometryStale && (interval !== last.interval || now - last.appliedAt > 45)) {
      front = interpolateRings(transitions[interval], p);
      const closed = closeRing(front);
      scene.frontGlow.coordinates = closed;
      scene.frontLine.coordinates = closed;
      if (p >= 1) {
        setFill(scene.activeBand, TRANSPARENT);
      } else {
        scene.activeBand.outerCoordinates = front;
        scene.activeBand.innerCoordinates = [transitions[interval].a];
        setFill(scene.activeBand, BURNED_STYLE.recentFill);
      }
      lastFrontRef.current = { interval, p, appliedAt: now };
    }

    // 3/4. spread-potential model — throttled, since each refresh runs
    // Dijkstra + contour extraction and repaints the prediction layers
    const m = modelRef.current;
    const modelStale =
      atEnd !== m.atEnd || interval !== m.interval || Math.abs(p - m.p) > 0.02;
    if (modelStale && (atEnd !== m.atEnd || now - m.lastAt > MODEL_REFRESH_MS)) {
      front = front ?? interpolateRings(transitions[interval], p);
      updatePrediction(scene, front, atEnd);
      modelRef.current = { interval, p, atEnd, lastAt: now };
    }
  });

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
