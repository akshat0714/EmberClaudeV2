/**
 * Photorealistic 3D scene (Google Maps JS API, maps3d library).
 *
 * Every overlay is draped onto the photorealistic mesh with CLAMP_TO_GROUND.
 * Layer stack, bottom to top:
 *
 *  1. FIRE INTENSITY — nested red bands by time-since-burned (Byram-style
 *     interpretation, RESEARCH.md §1.7–1.8): darkest, most saturated red just
 *     behind the advancing front (peak combustion), cooling through lighter
 *     reds to the smoldering interior. Past stage rings remain as faint
 *     contour lines.
 *  2. PREDICTION — ONE merged "next 30 minutes" envelope as a bold yellow
 *     gradient with a crisp boundary, plus per-hotspot branching worm-like
 *     prediction trees (minimum-travel-time routes out of each sub-fire) and
 *     0–3 ember spot fires downwind, all refreshed continuously.
 *  3. SUB-FIRES — the 10–20 most active heads as pulsing hotspot glows.
 *  4. CURRENT FRONT — the brightest pulsing line (multi-point frontier).
 *  5. NAVIGATION — Google-Maps-style blue dot (accuracy halo, heading wedge)
 *     and the blue evacuation route, draped over the terrain, plus the real
 *     evacuation-center markers.
 */
import { useEffect, useRef, useState } from 'react';
import {
  IGNITION_POINT,
  SCENE_CAMERA,
  SPREAD_STAGES,
  STRUCTURE_EDGES,
} from '../data/kennethReconstruction';
import { SAFE_ZONES, type SafeZone } from '../data/navConfig';
import {
  FRONT_STYLE,
  HOTSPOTS,
  INNER_LEVEL_MINUTES,
  INTENSITY_STYLE,
  NAV_STYLE,
  PREDICTION_ZONE,
  SPOT_FIRES,
  STRUCTURE_EDGE_STYLE,
  TREE_STYLE,
  WIND,
  WIND_STREAMS,
  WORDING,
} from '../data/spreadModelConfig';
import { cellIndexAt, computeArrivalField, getTerrainGrid } from '../lib/arrivalTimeModel';
import { intensityBands } from '../lib/fireIntensity';
import { publishFireSnapshot } from '../lib/fireState';
import {
  gammaFor,
  getTransitions,
  STAGE_TIMES,
  timelinePosition,
  warmTimeline,
} from '../lib/fireTimeline';
import { warpFront } from '../lib/frontierWarp';
import type { UserFix } from '../lib/geolocation';
import { detectHotspots, scheduleSpotFires, spotSeeds, type SpotFire } from '../lib/hotspots';
import {
  closeRing,
  interpolateRings,
  prepareTransition,
  resampleRing,
  ringCentroid,
  type LatLng,
  type RingTransition,
} from '../lib/interpolatePolygon';
import { loadMaps3D } from '../lib/loadGoogleMaps';
import {
  buildWindStreams,
  clampRingOutside,
  dashPath,
  extractContour,
  leadingPoint,
  offsetMeters,
} from '../lib/predictionBands';
import { extractHotspotTrees, type TreeSegment } from '../lib/predictionTrees';
import { byramHead } from '../lib/fireIntensity';
import { summarizeDrivers, type ModelSummary } from '../lib/spreadDrivers';
import { clamp, smoothstep01 } from '../lib/timeUtils';

const TRANSPARENT = 'rgba(0, 0, 0, 0)';
/** Minimum real-time gap between model recomputes (Dijkstra + contours). */
const MODEL_REFRESH_MS = 700;
/** Scene animation cadence (front pulse, zone morph, tree growth). */
const ANIM_TICK_MS = 33;
/** Intensity-band geometry refresh cadence. */
const INTENSITY_TICK_MS = 150;
/** Vertices used when morphing the displayed zone between model results. */
const ZONE_MORPH_VERTICES = 144;

const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG = 92_100;

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

/** Leading slice of a path for the progressive grow-out animation. */
function partialPath(path: LatLng[], fraction: number): LatLng[] {
  if (fraction >= 1) return path;
  const scaled = fraction * (path.length - 1);
  const last = Math.floor(scaled);
  const out = path.slice(0, last + 1);
  const t = scaled - last;
  if (t > 1e-3 && last + 1 < path.length) {
    const a = path[last];
    const b = path[last + 1];
    out.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
  }
  return out;
}

/** Draped circle ring around a center, n vertices. */
function circlePath(center: LatLng, radiusM: number, n = 30): LatLng[] {
  const out: LatLng[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push({
      lat: center.lat + (Math.cos(a) * radiusM) / M_PER_DEG_LAT,
      lng: center.lng + (Math.sin(a) * radiusM) / M_PER_DEG_LNG,
    });
  }
  return out;
}

/** Heading wedge (sector) polygon for the blue dot. */
function headingWedge(center: LatLng, headingDeg: number): LatLng[] {
  const half = (NAV_STYLE.headingHalfAngleDeg * Math.PI) / 180;
  const head = (headingDeg * Math.PI) / 180;
  const pts: LatLng[] = [center];
  for (let k = -3; k <= 3; k++) {
    const a = head + (k / 3) * half;
    pts.push({
      lat: center.lat + (Math.cos(a) * NAV_STYLE.headingLengthM) / M_PER_DEG_LAT,
      lng: center.lng + (Math.sin(a) * NAV_STYLE.headingLengthM) / M_PER_DEG_LNG,
    });
  }
  return pts;
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

/** Reusable pool of polylines for dashes, trees and wind streams. */
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
  /** Past stage rings as faint contour lines (stroke only). */
  stageContours: Polygon3D[];
  /** Nested time-since-burned fire-intensity bands (+ cooled interior). */
  intensityPolys: Polygon3D[];
  structureFills: Polygon3D[];
  structureEdgePools: PolylinePool[];
  structureDashSegments: LatLng[][][];
  structureMarkers: Marker3D[];
  /** Stacked fills of the single prediction envelope (outer carries the boundary). */
  zoneShells: Polygon3D[];
  windStreamPool: PolylinePool;
  treeGlowPool: PolylinePool;
  treePool: PolylinePool;
  hotspotGlow: Polygon3D[];
  hotspotCore: Polygon3D[];
  spotFills: Polygon3D[];
  spotRings: Polygon3D[];
  frontGlow: Polyline3D;
  frontLine: Polyline3D;
  startMarker: Marker3D;
  frontMarker: Marker3D;
  zoneMarker: Marker3D;
  zoneSubMarker: Marker3D;
  /** Navigation layer. */
  routeGlow: Polyline3D;
  routeCore: Polyline3D;
  navAccuracy: Polygon3D;
  navHeading: Polygon3D;
  navDot: Polygon3D;
  safeZoneMarkers: Marker3D[];
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

  const makePoly = (opts?: Partial<google.maps.maps3d.Polygon3DElementOptions>): Polygon3D => {
    const poly = new lib.Polygon3DElement({
      altitudeMode: CLAMP,
      fillColor: TRANSPARENT,
      strokeColor: TRANSPARENT,
      strokeWidth: 0,
      extruded: false,
      drawsOccludedSegments: false,
      ...opts,
    });
    map.append(poly);
    return poly;
  };

  // 1. fire-intensity bands (bottom layer), then past stage contour lines
  const intensityPolys = [...INTENSITY_STYLE.fills, INTENSITY_STYLE.emberFill].map(() =>
    makePoly(),
  );
  const stageContours = SPREAD_STAGES.map((stage) => {
    const poly = makePoly({ strokeWidth: INTENSITY_STYLE.historyStrokeWidth });
    poly.outerCoordinates = resampleRing(stage.ring, 160);
    return poly;
  });

  // 2. the single prediction envelope: stacked yellow gradient shells; only
  // the outermost shell draws a (crisp) boundary stroke
  const zoneShells = PREDICTION_ZONE.shellFractions.map((_, k) => {
    const isOuter = k === PREDICTION_ZONE.shellFractions.length - 1;
    return makePoly({ strokeWidth: isOuter ? PREDICTION_ZONE.boundaryWidth : 0 });
  });

  // structure-adjacent edges: faint fill + dashed boundary line
  const structureFills = STRUCTURE_EDGES.map((edge) => {
    const poly = makePoly();
    poly.outerCoordinates = edge.ring;
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

  // cause cues + prediction trees (prewarmed so later layers render above)
  const windStreamPool = new PolylinePool(lib, map, CLAMP);
  windStreamPool.prewarm(WIND_STREAMS.cols * WIND_STREAMS.rows * 2);
  const treeGlowPool = new PolylinePool(lib, map, CLAMP);
  treeGlowPool.prewarm(HOTSPOTS.maxCount);
  const treePool = new PolylinePool(lib, map, CLAMP);
  treePool.prewarm(TREE_STYLE.maxPolylines);

  // 3. sub-fires: hotspot glows and ember spot fires
  const hotspotGlow = Array.from({ length: HOTSPOTS.maxCount }, () => makePoly());
  const hotspotCore = Array.from({ length: HOTSPOTS.maxCount }, () => makePoly());
  const spotFills = Array.from({ length: SPOT_FIRES.maxActive }, () => makePoly());
  const spotRings = Array.from({ length: SPOT_FIRES.maxActive }, () =>
    makePoly({ strokeWidth: 1.8 }),
  );

  // 4. the current active front — brightest fire layer
  const frontGlow = new lib.Polyline3DElement({
    altitudeMode: CLAMP,
    strokeColor: FRONT_STYLE.glow,
    strokeWidth: 9,
    drawsOccludedSegments: false,
  });
  map.append(frontGlow);
  const frontLine = new lib.Polyline3DElement({
    altitudeMode: CLAMP,
    strokeColor: FRONT_STYLE.line,
    strokeWidth: 4.5,
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
  const structureMarkers = STRUCTURE_EDGES.map((edge) => {
    const mid = edge.edgeLine[Math.floor(edge.edgeLine.length / 2)];
    return makeMarker(lib, CLAMP, edge.label, mid);
  });

  // 5. navigation layer (topmost): blue route + Google-style blue dot
  const routeGlow = new lib.Polyline3DElement({
    altitudeMode: CLAMP,
    strokeColor: TRANSPARENT,
    strokeWidth: 0,
    drawsOccludedSegments: true, // the route must read behind ridgelines
  });
  map.append(routeGlow);
  const routeCore = new lib.Polyline3DElement({
    altitudeMode: CLAMP,
    strokeColor: TRANSPARENT,
    strokeWidth: 0,
    outerColor: NAV_STYLE.routeCasing,
    outerWidth: 1.5,
    drawsOccludedSegments: true,
  });
  map.append(routeCore);
  const navAccuracy = makePoly();
  const navHeading = makePoly();
  const navDot = makePoly({ strokeWidth: NAV_STYLE.dotRingWidth });

  const safeZoneMarkers = SAFE_ZONES.map((zone) =>
    makeMarker(lib, CLAMP, zone.name, zone.point),
  );

  customizePins([
    { marker: startMarker, background: '#ffd766' },
    { marker: frontMarker, background: '#ff9d3c' },
    { marker: zoneMarker, background: '#ffd23c' },
    { marker: zoneSubMarker, background: '#9c7a34' },
    ...structureMarkers.map((marker) => ({ marker, background: '#efe9da' })),
    ...safeZoneMarkers.map((marker) => ({ marker, background: '#34a853' })),
  ]);

  return {
    lib,
    map,
    stageContours,
    intensityPolys,
    structureFills,
    structureEdgePools,
    structureDashSegments,
    structureMarkers,
    zoneShells,
    windStreamPool,
    treeGlowPool,
    treePool,
    hotspotGlow,
    hotspotCore,
    spotFills,
    spotRings,
    frontGlow,
    frontLine,
    startMarker,
    frontMarker,
    zoneMarker,
    zoneSubMarker,
    routeGlow,
    routeCore,
    navAccuracy,
    navHeading,
    navDot,
    safeZoneMarkers,
  };
}

export interface NavOverlay {
  active: boolean;
  user: UserFix | null;
  /** Remaining route geometry (already trimmed to the user's progress). */
  routePath: LatLng[] | null;
  routeDegraded: boolean;
  destinationId: string | null;
  /** Click-to-place mode (sets the cursor + click handling). */
  placing: boolean;
  /** Chase-cam toggle. */
  follow: boolean;
}

interface FireSceneProps {
  apiKey: string;
  /** Simulation clock time (UTC ms). */
  time: number;
  /** Receives the model summary after each refresh. */
  onModelUpdate?: (summary: ModelSummary) => void;
  nav?: NavOverlay;
  onMapClick?: (point: LatLng) => void;
}

interface GrowingTree {
  segment: TreeSegment;
  width: number;
  color: string;
}

export default function FireScene({ apiKey, time, onModelUpdate, nav, onMapClick }: FireSceneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SceneRefs | null>(null);
  const timeRef = useRef(time);
  timeRef.current = time;
  const lastFrontRef = useRef({ interval: -1, p: -1, appliedAt: 0 });
  const modelRef = useRef({ interval: -1, p: -1, atEnd: false, lastAt: 0 });
  const horizonRef = useRef(PREDICTION_ZONE.primaryMinutes);
  const structVisibleRef = useRef<boolean[]>(STRUCTURE_EDGES.map(() => false));
  const lastIntensityRef = useRef(0);
  const spotsRef = useRef<{ key: number; spots: SpotFire[] }>({ key: -1, spots: [] });
  // smooth zone morphing between model refreshes
  const displayedShellsRef = useRef<Array<LatLng[] | null>>(
    PREDICTION_ZONE.shellFractions.map(() => null),
  );
  const innerSnapRef = useRef<LatLng[] | null>(null);
  const zoneAnimRef = useRef<{
    start: number;
    transitions: Array<RingTransition | null>;
    targets: Array<LatLng[] | null>;
    done: boolean;
  } | null>(null);
  // progressive tree grow-out
  const treesRef = useRef<{ list: GrowingTree[]; start: number; done: boolean }>({
    list: [],
    start: 0,
    done: true,
  });
  const hotspotDrawRef = useRef<Array<{ ring: LatLng[]; glowRing: LatLng[]; strength: number }>>([]);
  const onModelUpdateRef = useRef(onModelUpdate);
  onModelUpdateRef.current = onModelUpdate;
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;
  const navRef = useRef(nav);
  navRef.current = nav;
  const followRef = useRef({ lastAt: 0 });
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

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
        displayedShellsRef.current = PREDICTION_ZONE.shellFractions.map(() => null);
        innerSnapRef.current = null;
        zoneAnimRef.current = null;
        treesRef.current = { list: [], start: 0, done: true };
        spotsRef.current = { key: -1, spots: [] };
        lastIntensityRef.current = 0;
        // click-to-place: maps3d Map3DElement LocationClickEvent
        sceneRef.current.map.addEventListener('gmp-click', (e: Event) => {
          const position = (e as unknown as { position?: { lat: number; lng: number } }).position;
          if (position && Number.isFinite(position.lat)) {
            onMapClickRef.current?.({ lat: position.lat, lng: position.lng });
          }
        });
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

  // Precompute the frontier-warp exponents for every interval shortly after
  // load so playback never hitches on a first-use computation.
  useEffect(() => {
    if (phase !== 'ready') return;
    const timer = window.setTimeout(() => warmTimeline(), 1000);
    return () => window.clearTimeout(timer);
  }, [phase]);

  /** Set the prediction-shell holes from the currently displayed rings. */
  const applyShellHoles = (scene: SceneRefs): void => {
    const displayed = displayedShellsRef.current;
    const inner = innerSnapRef.current;
    scene.zoneShells.forEach((poly, k) => {
      const ring = displayed[k];
      if (!ring || !inner) return;
      poly.innerCoordinates = [k === 0 ? inner : (displayed[k - 1] ?? inner)];
    });
  };

  /** Refresh the nested time-since-burned intensity bands. */
  const updateIntensity = (scene: SceneRefs, t: number): void => {
    const bands = intensityBands(t);
    scene.intensityPolys.forEach((poly, k) => {
      const band = bands[k];
      if (!band) {
        setFill(poly, TRANSPARENT);
        return;
      }
      poly.outerCoordinates = band.outer;
      poly.innerCoordinates = band.inner ? [band.inner] : [];
      setFill(poly, band.fill);
    });
  };

  /** Recompute the spread model and stage the new prediction visuals. */
  const updatePrediction = (
    scene: SceneRefs,
    front: LatLng[],
    atEnd: boolean,
    interval: number,
    t: number,
  ): void => {
    if (atEnd) {
      // Reconstruction complete: intensity + final perimeter stay, prediction hides.
      for (const poly of scene.zoneShells) {
        setFill(poly, TRANSPARENT);
        setStroke(poly, TRANSPARENT);
      }
      scene.windStreamPool.hideAll();
      scene.treePool.hideAll();
      scene.treeGlowPool.hideAll();
      for (const poly of [...scene.hotspotCore, ...scene.hotspotGlow, ...scene.spotFills, ...scene.spotRings]) {
        setFill(poly, TRANSPARENT);
        setStroke(poly, TRANSPARENT);
      }
      hotspotDrawRef.current = [];
      setAttached(scene.map, scene.zoneMarker, false);
      setAttached(scene.map, scene.zoneSubMarker, false);
      setAttached(scene.map, scene.frontMarker, false);
      displayedShellsRef.current = PREDICTION_ZONE.shellFractions.map(() => null);
      innerSnapRef.current = null;
      zoneAnimRef.current = null;
      treesRef.current = { list: [], start: 0, done: true };
      publishFireSnapshot({ front, spots: [], hotspots: [], simTimeMs: t, atEnd: true });
      onModelUpdateRef.current?.({
        drivers: summarizeDrivers(front).drivers,
        predictionActive: false,
        horizonMinutes: horizonRef.current,
        headRateMpm: 0,
        byram: null,
        hotspotCount: 0,
        spotCount: 0,
        realDem: getTerrainGrid().realDem,
        realStreets: getTerrainGrid().realStreets,
      });
      return;
    }

    const { drivers } = summarizeDrivers(front);

    // ---- sub-fires: hotspots along the frontier + scheduled ember spots
    const hotspots = detectHotspots(front);
    const intervalStart = STAGE_TIMES[interval];
    const spotKey = interval * 101 + Math.floor((t - intervalStart) / (6 * 60_000));
    if (spotsRef.current.key !== spotKey) {
      spotsRef.current = { key: spotKey, spots: scheduleSpotFires(hotspots, spotKey) };
    }
    const spots = spotsRef.current.spots;

    publishFireSnapshot({ front, spots, hotspots, simTimeMs: t, atEnd: false });

    const headSpeedMpm = hotspots[0]?.headRateMpm ?? 0;
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

    // ---- the prediction field: front + ember spot seeds, one surface
    const field = computeArrivalField(front, undefined, spotSeeds(spots));
    innerSnapRef.current = extractContour(field, INNER_LEVEL_MINUTES) ?? front;

    // New shell targets from the same arrival surface; the displayed rings
    // morph toward them (see the animation loop) so refreshes never jump.
    const now = performance.now();
    const displayed = displayedShellsRef.current;
    const targets: Array<LatLng[] | null> = [];
    const shellTransitions: Array<RingTransition | null> = [];
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
        displayed[k] = null;
        targets.push(null);
        shellTransitions.push(null);
        return;
      }
      setFill(poly, PREDICTION_ZONE.shellFills[k]);
      setStroke(poly, isOuter ? PREDICTION_ZONE.boundaryStroke : TRANSPARENT);
      if (isOuter) outerRing = contour;
      const previous = displayed[k];
      if (!previous) {
        displayed[k] = contour;
        poly.outerCoordinates = contour;
        targets.push(contour);
        shellTransitions.push(null);
      } else {
        targets.push(contour);
        shellTransitions.push(prepareTransition(previous, contour, ZONE_MORPH_VERTICES));
      }
    });
    applyShellHoles(scene);
    zoneAnimRef.current = {
      start: now,
      transitions: shellTransitions,
      targets,
      done: shellTransitions.every((tr) => tr === null),
    };

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

    // ---- per-hotspot prediction trees (bold yellow worm-like branches)
    const segments = extractHotspotTrees(field, hotspots, horizon);
    treesRef.current = {
      list: segments.map((segment) => ({
        segment,
        width: segment.isTrunk ? TREE_STYLE.trunkWidth : TREE_STYLE.branchWidth,
        color: segment.isTrunk ? TREE_STYLE.trunkStroke : TREE_STYLE.branchStroke,
      })),
      start: now,
      done: false,
    };

    // ---- hotspot + spot-fire geometry (painted/pulsed by the anim loop)
    hotspotDrawRef.current = hotspots.map((h) => {
      const radius =
        HOTSPOTS.radiusM[0] + (HOTSPOTS.radiusM[1] - HOTSPOTS.radiusM[0]) * h.strength;
      return {
        ring: circlePath(h.point, radius, 22),
        glowRing: circlePath(h.point, radius * 1.9, 22),
        strength: h.strength,
      };
    });
    scene.spotFills.forEach((poly, i) => {
      const spot = spots[i];
      if (!spot) {
        setFill(poly, TRANSPARENT);
        setStroke(scene.spotRings[i], TRANSPARENT);
        return;
      }
      poly.outerCoordinates = circlePath(spot.point, SPOT_FIRES.radiusM, 20);
      setFill(poly, SPOT_FIRES.fill);
      scene.spotRings[i].outerCoordinates = circlePath(spot.point, SPOT_FIRES.radiusM * 2.1, 24);
      setStroke(scene.spotRings[i], SPOT_FIRES.ringStroke);
    });

    scene.frontMarker.position = { ...leadingPoint(front, WIND.spreadBearingDeg), altitude: 0 };
    setAttached(scene.map, scene.frontMarker, true);

    // fuel class just ahead of the strongest head, for the Byram readout
    let headFuel: 'grass' | 'chaparral' = 'chaparral';
    if (hotspots.length > 0) {
      const g = getTerrainGrid();
      const h = hotspots[0];
      const probe = {
        lat: h.point.lat + (h.ny * HOTSPOTS.probeOffsetM) / M_PER_DEG_LAT,
        lng: h.point.lng + (h.nx * HOTSPOTS.probeOffsetM) / M_PER_DEG_LNG,
      };
      headFuel = g.fuelClass[cellIndexAt(g, probe.lat, probe.lng)] === 0 ? 'grass' : 'chaparral';
    }
    onModelUpdateRef.current?.({
      drivers,
      predictionActive: true,
      horizonMinutes: horizon,
      headRateMpm: headSpeedMpm,
      byram: byramHead(headSpeedMpm, headFuel),
      hotspotCount: hotspots.length,
      spotCount: spots.length,
      realDem: getTerrainGrid().realDem,
      realStreets: getTerrainGrid().realStreets,
    });
  };

  // Apply the simulation clock to the scene. Everything is a pure function
  // of `time`, so scrubbing in either direction just works.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || phase !== 'ready') return;

    const { interval, p: rawP, atEnd, stageIndex } = timelinePosition(time);
    const p = atEnd ? 1 : clamp(rawP, 0.01, 1);

    // past stage rings: faint contour lines once reached
    SPREAD_STAGES.forEach((_, k) => {
      const visible = time >= STAGE_TIMES[k];
      setStroke(scene.stageContours[k], visible ? INTENSITY_STYLE.historyStroke : TRANSPARENT);
    });

    // structure-adjacent edges appear once the spread reaches them
    STRUCTURE_EDGES.forEach((edge, i) => {
      const visible = stageIndex >= edge.activeFromStage;
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

    // multi-point advancing front
    const last = lastFrontRef.current;
    const now = performance.now();
    let front: LatLng[] | null = null;
    const geometryStale =
      interval !== last.interval || Math.abs(p - last.p) > 0.0015 || (p === 1 && last.p !== 1);
    if (geometryStale && (interval !== last.interval || now - last.appliedAt > ANIM_TICK_MS)) {
      front = warpFront(getTransitions()[interval], gammaFor(interval), p);
      const closed = closeRing(front);
      scene.frontGlow.coordinates = closed;
      scene.frontLine.coordinates = closed;
      lastFrontRef.current = { interval, p, appliedAt: now };
    }

    // fire-intensity bands (throttled; geometry changes slowly)
    if (now - lastIntensityRef.current > INTENSITY_TICK_MS) {
      lastIntensityRef.current = now;
      updateIntensity(scene, time);
    }

    // spread model — throttled, since each refresh runs Dijkstra + contours;
    // the animation loop morphs visuals between results
    const m = modelRef.current;
    const modelStale = atEnd !== m.atEnd || interval !== m.interval || Math.abs(p - m.p) > 0.02;
    if (modelStale && (atEnd !== m.atEnd || now - m.lastAt > MODEL_REFRESH_MS)) {
      front = front ?? warpFront(getTransitions()[interval], gammaFor(interval), p);
      updatePrediction(scene, front, atEnd, interval, time);
      modelRef.current = { interval, p, atEnd, lastAt: now };
    }
  });

  // Navigation overlay: blue dot, accuracy halo, heading wedge, blue route,
  // evacuation-center markers. The nav state object changes every clock tick
  // while navigating, but the geometry only changes when a new GPS/sim fix
  // arrives — so writes are gated on a content signature.
  const navSigRef = useRef('');
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || phase !== 'ready') return;
    const overlay = nav;
    const u = overlay?.user;
    const rp = overlay?.routePath;
    const signature = [
      overlay?.active,
      overlay?.placing,
      overlay?.follow,
      overlay?.routeDegraded,
      overlay?.destinationId,
      u ? `${u.point.lat.toFixed(6)},${u.point.lng.toFixed(6)},${u.headingDeg},${u.accuracyM}` : '-',
      rp ? `${rp.length},${rp[0]?.lat.toFixed(6)},${rp[0]?.lng.toFixed(6)}` : '-',
    ].join('|');
    if (signature === navSigRef.current) return;
    navSigRef.current = signature;
    const showZones = overlay?.active ?? false;
    scene.safeZoneMarkers.forEach((marker, i) => {
      const zone: SafeZone = SAFE_ZONES[i];
      setAttached(scene.map, marker, showZones);
      if (showZones) {
        setMarkerLabel(
          marker,
          overlay?.destinationId === zone.id ? `▶ ${zone.name} (your destination)` : zone.name,
        );
      }
    });

    if (!overlay?.active) {
      setFill(scene.navAccuracy, TRANSPARENT);
      setStroke(scene.navAccuracy, TRANSPARENT);
      setFill(scene.navHeading, TRANSPARENT);
      setFill(scene.navDot, TRANSPARENT);
      setStroke(scene.navDot, TRANSPARENT);
      scene.routeGlow.strokeWidth = 0;
      scene.routeCore.strokeWidth = 0;
      scene.routeGlow.strokeColor = TRANSPARENT;
      scene.routeCore.strokeColor = TRANSPARENT;
      return;
    }

    const user = overlay.user;
    if (user) {
      const accuracyR = Math.min(Math.max(user.accuracyM, 12), 90);
      scene.navAccuracy.outerCoordinates = circlePath(user.point, accuracyR, 30);
      setFill(scene.navAccuracy, NAV_STYLE.accuracyFill);
      setStroke(scene.navAccuracy, NAV_STYLE.accuracyStroke);
      if (user.headingDeg !== null) {
        scene.navHeading.outerCoordinates = headingWedge(user.point, user.headingDeg);
        setFill(scene.navHeading, NAV_STYLE.headingFill);
      } else {
        setFill(scene.navHeading, TRANSPARENT);
      }
      scene.navDot.outerCoordinates = circlePath(user.point, NAV_STYLE.dotRadiusM, 22);
      setFill(scene.navDot, NAV_STYLE.dotFill);
      setStroke(scene.navDot, NAV_STYLE.dotRing);
    } else {
      setFill(scene.navAccuracy, TRANSPARENT);
      setStroke(scene.navAccuracy, TRANSPARENT);
      setFill(scene.navHeading, TRANSPARENT);
      setFill(scene.navDot, TRANSPARENT);
      setStroke(scene.navDot, TRANSPARENT);
    }

    if (overlay.routePath && overlay.routePath.length >= 2) {
      const color = overlay.routeDegraded ? NAV_STYLE.routeDegraded : NAV_STYLE.routeCore;
      scene.routeGlow.coordinates = overlay.routePath;
      scene.routeGlow.strokeColor = NAV_STYLE.routeGlow;
      scene.routeGlow.strokeWidth = NAV_STYLE.routeGlowWidth;
      scene.routeCore.coordinates = overlay.routePath;
      scene.routeCore.strokeColor = color;
      scene.routeCore.strokeWidth = NAV_STYLE.routeCoreWidth;
    } else {
      scene.routeGlow.strokeWidth = 0;
      scene.routeCore.strokeWidth = 0;
      scene.routeGlow.strokeColor = TRANSPARENT;
      scene.routeCore.strokeColor = TRANSPARENT;
    }

    // chase-cam: gently follow the blue dot
    if (overlay.follow && user) {
      const now = performance.now();
      if (now - followRef.current.lastAt > 1400) {
        followRef.current.lastAt = now;
        scene.map.flyCameraTo({
          endCamera: {
            center: { ...user.point, altitude: 0 },
            range: 1250,
            tilt: 58,
            heading: user.headingDeg ?? scene.map.heading,
          },
          durationMillis: 1300,
        });
      }
    }
  }, [nav, phase]);

  // Scene animation loop: front pulse, zone morphing, tree grow-out and
  // hotspot pulsing. Throttled property writes.
  useEffect(() => {
    if (phase !== 'ready') return;
    let raf = 0;
    let lastApply = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - lastApply < ANIM_TICK_MS) return;
      lastApply = now;
      const scene = sceneRef.current;
      if (!scene) return;

      // gentle pulse so "current position" reads even while paused
      const s = Math.sin((now / 1800) * Math.PI * 2);
      scene.frontLine.strokeWidth = 4.2 + 1.0 * s;
      scene.frontLine.strokeColor = `rgba(255, 244, 180, ${(0.84 + 0.14 * s).toFixed(3)})`;
      scene.frontGlow.strokeWidth = 8.5 + 2.0 * s;

      // hotspot pulsing (each slightly out of phase so the front shimmers)
      const draws = hotspotDrawRef.current;
      scene.hotspotCore.forEach((poly, i) => {
        const draw = draws[i];
        if (!draw) {
          setFill(poly, TRANSPARENT);
          setFill(scene.hotspotGlow[i], TRANSPARENT);
          return;
        }
        const phase01 = 0.5 + 0.5 * Math.sin((now / HOTSPOTS.pulseMs + i * 0.37) * Math.PI * 2);
        const coreAlpha = 0.38 + 0.3 * phase01 * (0.5 + 0.5 * draw.strength);
        poly.outerCoordinates = draw.ring;
        setFill(poly, `rgba(255, 84, 30, ${coreAlpha.toFixed(3)})`);
        scene.hotspotGlow[i].outerCoordinates = draw.glowRing;
        setFill(scene.hotspotGlow[i], `rgba(255, 140, 40, ${(0.10 + 0.16 * phase01).toFixed(3)})`);
      });

      // morph the displayed prediction shells toward the latest model result
      const anim = zoneAnimRef.current;
      if (anim && !anim.done) {
        const t = clamp((now - anim.start) / PREDICTION_ZONE.morphMs, 0, 1);
        const eased = smoothstep01(t);
        anim.transitions.forEach((transition, k) => {
          if (!transition) return;
          const ring = t >= 1 ? anim.targets[k]! : interpolateRings(transition, eased);
          displayedShellsRef.current[k] = ring;
          sceneRef.current!.zoneShells[k].outerCoordinates = ring;
        });
        applyShellHoles(scene);
        if (t >= 1) anim.done = true;
      }

      // grow the prediction trees out from their hotspots, staggered
      const trees = treesRef.current;
      if (!trees.done) {
        let allDone = true;
        scene.treeGlowPool.begin();
        scene.treePool.begin();
        trees.list.forEach((tree, i) => {
          const frac = clamp(
            (now - trees.start - i * TREE_STYLE.staggerMs) / TREE_STYLE.growMs,
            0,
            1,
          );
          if (frac < 1) allDone = false;
          const pts = partialPath(tree.segment.pts, frac);
          if (pts.length >= 2) {
            if (tree.segment.isTrunk) {
              scene.treeGlowPool.draw(pts, TREE_STYLE.trunkGlow, TREE_STYLE.trunkGlowWidth);
            }
            scene.treePool.draw(pts, tree.color, tree.width);
          }
        });
        scene.treeGlowPool.end();
        scene.treePool.end();
        if (allDone) trees.done = true;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  const recenter = () => {
    sceneRef.current?.map.flyCameraTo({ endCamera: SCENE_CAMERA.main, durationMillis: 1600 });
  };

  return (
    <div className={nav?.placing ? 'scene-shell placing' : 'scene-shell'}>
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
