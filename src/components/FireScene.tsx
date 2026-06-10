/**
 * Photorealistic 3D scene (Google Maps JS API, maps3d library).
 *
 * Every overlay is draped onto the photorealistic mesh with CLAMP_TO_GROUND,
 * so fills and lines follow hills, canyons and buildings rather than floating
 * as flat stickers. Three main concepts, bottom to top:
 *
 *  1. Burned / reached terrain — muted charcoal fills with faint past-arrival
 *     contour lines; terrain and roads stay visible.
 *  2. Current active front — the brightest layer: a bold pulsing yellow-orange
 *     line with a subtle glow, labelled "Current active front".
 *  3. ONE predicted extent — "Likely spread in next 30 minutes" (or a
 *     20-minute critical interval when the front is running fast), drawn as a
 *     gradient zone from a FARSITE/Huygens-style minimum-travel-time model:
 *     three stacked fills of the same arrival surface (stronger near the
 *     front) under a single crisp outer boundary.
 *
 *  Cause cues stay thin and quiet: faint wind streamlines, 2–5 spread-pathway
 *  ribbons with at most two cause labels, and dashed structure-edge lines.
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
  FRONT_STYLE,
  INNER_LEVEL_MINUTES,
  PATHWAY_STYLE,
  PREDICTION_ZONE,
  STRUCTURE_EDGE_STYLE,
  WIND,
  WIND_STREAMS,
  WORDING,
} from '../data/spreadModelConfig';
import { computeArrivalField } from '../lib/arrivalTimeModel';
import {
  closeRing,
  interpolateRings,
  prepareTransition,
  ringCentroid,
  type LatLng,
} from '../lib/interpolatePolygon';
import { loadMaps3D } from '../lib/loadGoogleMaps';
import {
  buildWindStreams,
  clampRingOutside,
  dashPath,
  extractContour,
  extractPathways,
  leadingPoint,
  offsetMeters,
} from '../lib/predictionBands';
import { classifyPathway, summarizeDrivers, type ModelSummary } from '../lib/spreadDrivers';
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

/** Reusable pool of polylines for dashes, ribbons and wind streams. */
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
  /** Stacked fills of the single prediction zone (outermost carries the boundary). */
  zoneShells: Polygon3D[];
  windStreamPool: PolylinePool;
  pathwayPool: PolylinePool;
  frontGlow: Polyline3D;
  frontLine: Polyline3D;
  startMarker: Marker3D;
  frontMarker: Marker3D;
  zoneMarker: Marker3D;
  zoneSubMarker: Marker3D;
  pathLabelMarkers: Marker3D[];
}

/**
 * <gmp-marker-3d> rejects empty labels ("empty string is not an accepted
 * value"), so labels are only ever applied as trimmed, non-empty text.
 */
export function safeLabel(label?: string | null): string | undefined {
  const trimmed = label?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

/** Assign a marker label only when valid; a bad label must never throw. */
function setMarkerLabel(marker: Marker3D, label?: string | null): void {
  const text = safeLabel(label);
  if (!text) return;
  try {
    marker.label = text;
  } catch {
    // one rejected label must not take down the whole 3D map
  }
}

function makeMarker(
  lib: Maps3D,
  clampMode: google.maps.maps3d.AltitudeModeValue,
  label: string | undefined,
  position: LatLng,
): Marker3D {
  const options: google.maps.maps3d.Marker3DElementOptions = {
    position: { ...position, altitude: 0 },
    altitudeMode: clampMode,
    extruded: false,
  };
  const text = safeLabel(label);
  if (text) options.label = text;
  try {
    return new lib.Marker3DElement(options);
  } catch {
    // construction must never crash the scene; retry without the label
    delete options.label;
    return new lib.Marker3DElement(options);
  }
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

  // 3. the single prediction zone: three stacked gradient shells; only the
  // outermost shell draws a (crisp) boundary stroke
  const zoneShells = PREDICTION_ZONE.shellFractions.map((_, k) => {
    const isOuter = k === PREDICTION_ZONE.shellFractions.length - 1;
    const poly = new lib.Polygon3DElement({
      altitudeMode: CLAMP,
      fillColor: TRANSPARENT,
      strokeColor: TRANSPARENT,
      strokeWidth: isOuter ? PREDICTION_ZONE.boundaryWidth : 0,
      extruded: false,
      drawsOccludedSegments: false,
    });
    map.append(poly);
    return poly;
  });

  // structure-adjacent edges: faint fill + dashed boundary line
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

  // cause cues (prewarmed so the bright front line, created after, renders above)
  const windStreamPool = new PolylinePool(lib, map, CLAMP);
  windStreamPool.prewarm(WIND_STREAMS.cols * WIND_STREAMS.rows * 2);
  const pathwayPool = new PolylinePool(lib, map, CLAMP);
  pathwayPool.prewarm(PATHWAY_STYLE.maxCount);

  // 2. the current active front — brightest layer
  const frontGlow = new lib.Polyline3DElement({
    altitudeMode: CLAMP,
    strokeColor: FRONT_STYLE.glow,
    strokeWidth: 7,
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

  // on-terrain labels
  const startMarker = makeMarker(lib, CLAMP, 'Start area', IGNITION_POINT);
  map.append(startMarker);
  const frontMarker = makeMarker(lib, CLAMP, 'Current active front', IGNITION_POINT);
  map.append(frontMarker);
  const zoneMarker = makeMarker(
    lib,
    CLAMP,
    WORDING.zoneLabel(PREDICTION_ZONE.primaryMinutes),
    IGNITION_POINT,
  );
  const zoneSubMarker = makeMarker(lib, CLAMP, WORDING.potential, IGNITION_POINT);
  // created without labels — cause text is assigned when a pathway is shown
  const pathLabelMarkers = Array.from({ length: PATHWAY_STYLE.labelMax }, () =>
    makeMarker(lib, CLAMP, undefined, IGNITION_POINT),
  );
  const structureMarkers = STRUCTURE_EDGES.map((edge) => {
    const mid = edge.edgeLine[Math.floor(edge.edgeLine.length / 2)];
    return makeMarker(lib, CLAMP, edge.label, mid);
  });

  customizePins([
    { marker: startMarker, background: '#ffd766' },
    { marker: frontMarker, background: '#ff9d3c' },
    { marker: zoneMarker, background: '#ff8a3c' },
    { marker: zoneSubMarker, background: '#9c5b34' },
    ...pathLabelMarkers.map((marker) => ({ marker, background: '#caa66f' })),
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
    zoneShells,
    windStreamPool,
    pathwayPool,
    frontGlow,
    frontLine,
    startMarker,
    frontMarker,
    zoneMarker,
    zoneSubMarker,
    pathLabelMarkers,
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
  const horizonRef = useRef(PREDICTION_ZONE.primaryMinutes);
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
        horizonRef.current = PREDICTION_ZONE.primaryMinutes;
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

  /** Recompute the arrival-time model and repaint the prediction layers. */
  const updatePrediction = (scene: SceneRefs, front: LatLng[], atEnd: boolean): void => {
    if (atEnd) {
      // Reconstruction complete: history + final perimeter stay, potential hides.
      for (const poly of scene.zoneShells) {
        setFill(poly, TRANSPARENT);
        setStroke(poly, TRANSPARENT);
      }
      scene.windStreamPool.hideAll();
      scene.pathwayPool.hideAll();
      setAttached(scene.map, scene.zoneMarker, false);
      setAttached(scene.map, scene.zoneSubMarker, false);
      setAttached(scene.map, scene.frontMarker, false);
      for (const marker of scene.pathLabelMarkers) setAttached(scene.map, marker, false);
      onModelUpdateRef.current?.({
        drivers: summarizeDrivers(front).drivers,
        predictionActive: false,
        horizonMinutes: horizonRef.current,
      });
      return;
    }

    const { drivers, headSpeedMpm } = summarizeDrivers(front);

    // Critical-interval selection with hysteresis: one predicted extent only,
    // narrowed to 20 minutes while the head rate is extreme.
    let horizon = horizonRef.current;
    if (
      horizon === PREDICTION_ZONE.primaryMinutes &&
      headSpeedMpm >= PREDICTION_ZONE.criticalHeadSpeedMpm
    ) {
      horizon = PREDICTION_ZONE.criticalMinutes;
    } else if (
      horizon === PREDICTION_ZONE.criticalMinutes &&
      headSpeedMpm <= PREDICTION_ZONE.relaxHeadSpeedMpm
    ) {
      horizon = PREDICTION_ZONE.primaryMinutes;
    }
    horizonRef.current = horizon;

    const field = computeArrivalField(front);
    const inner = extractContour(field, INNER_LEVEL_MINUTES) ?? front;

    let previous = inner;
    let outerRing: LatLng[] | null = null;
    scene.zoneShells.forEach((poly, k) => {
      const isOuter = k === scene.zoneShells.length - 1;
      let contour = extractContour(field, horizon * PREDICTION_ZONE.shellFractions[k]);
      if (contour && isOuter) {
        // the visible boundary must never dip inside the bright front line
        contour = clampRingOutside(contour, front);
      }
      if (!contour) {
        setFill(poly, TRANSPARENT);
        setStroke(poly, TRANSPARENT);
        return;
      }
      poly.outerCoordinates = contour;
      poly.innerCoordinates = [previous];
      setFill(poly, PREDICTION_ZONE.shellFills[k]);
      setStroke(poly, isOuter ? PREDICTION_ZONE.boundaryStroke : TRANSPARENT);
      if (isOuter) outerRing = contour;
      previous = contour;
    });

    if (outerRing) {
      const lead = leadingPoint(outerRing, WIND.spreadBearingDeg);
      setMarkerLabel(scene.zoneMarker, WORDING.zoneLabel(horizon));
      scene.zoneMarker.position = { ...lead, altitude: 0 };
      setAttached(scene.map, scene.zoneMarker, true);
      scene.zoneSubMarker.position = {
        ...offsetMeters(lead, WIND.spreadBearingDeg, 190),
        altitude: 0,
      };
      setAttached(scene.map, scene.zoneSubMarker, true);

      // faint wind streamlines laid out around the predicted zone
      scene.windStreamPool.begin();
      const streams = buildWindStreams(
        ringCentroid(outerRing),
        WIND.spreadBearingDeg,
        WIND_STREAMS,
        front,
      );
      for (const stream of streams) {
        scene.windStreamPool.draw(stream.line, WIND_STREAMS.color, WIND_STREAMS.width);
        scene.windStreamPool.draw(stream.arrow, WIND_STREAMS.color, WIND_STREAMS.width);
      }
      scene.windStreamPool.end();
    } else {
      setAttached(scene.map, scene.zoneMarker, false);
      setAttached(scene.map, scene.zoneSubMarker, false);
      scene.windStreamPool.hideAll();
    }

    // spread-pathway ribbons: the model's lowest-cost routes, with at most
    // two distinct cause labels so the cues never dominate the map
    scene.pathwayPool.begin();
    const pathways = extractPathways(field, {
      minMinutes: horizon * 0.75,
      maxMinutes: horizon + 2,
      maxCount: PATHWAY_STYLE.maxCount,
      separationMeters: 500,
      minRunMeters: 350,
    });
    for (const path of pathways) {
      scene.pathwayPool.draw(path, PATHWAY_STYLE.stroke, PATHWAY_STYLE.width);
    }
    scene.pathwayPool.end();

    const seenCauses = new Set<string>();
    let labelIndex = 0;
    for (const path of pathways) {
      if (labelIndex >= scene.pathLabelMarkers.length) break;
      const cause = classifyPathway(path);
      if (seenCauses.has(cause)) continue;
      seenCauses.add(cause);
      const marker = scene.pathLabelMarkers[labelIndex++];
      setMarkerLabel(marker, cause);
      marker.position = { ...path[path.length - 1], altitude: 0 };
      setAttached(scene.map, marker, true);
    }
    for (let i = labelIndex; i < scene.pathLabelMarkers.length; i++) {
      setAttached(scene.map, scene.pathLabelMarkers[i], false);
    }

    scene.frontMarker.position = { ...leadingPoint(front, WIND.spreadBearingDeg), altitude: 0 };
    setAttached(scene.map, scene.frontMarker, true);

    onModelUpdateRef.current?.({ drivers, predictionActive: true, horizonMinutes: horizon });
  };

  // Apply the reconstruction clock to the scene. Everything is a pure
  // function of `time`, so scrubbing in either direction just works.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || phase !== 'ready') return;

    const reachedStage = Math.max(0, countAtOrBefore(stageTimes, time) - 1);
    const atEnd = time >= stageTimes[stageTimes.length - 1];

    // burned history: subtle charcoal fills + faint past contours
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

    // structure-adjacent edges appear once the spread reaches them
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

    // moving front between stages
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

    // spread-potential model — throttled, since each refresh runs Dijkstra +
    // contour extraction and repaints the prediction layers
    const m = modelRef.current;
    const modelStale = atEnd !== m.atEnd || interval !== m.interval || Math.abs(p - m.p) > 0.02;
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
      scene.frontLine.strokeWidth = 3.4 + 0.8 * s;
      scene.frontLine.strokeColor = `rgba(255, 244, 180, ${(0.82 + 0.15 * s).toFixed(3)})`;
      scene.frontGlow.strokeWidth = 6 + 1.4 * s;
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
