/**
 * 3D map: Mapbox GL (dark style + terrain + hillshade + fog) with deck.gl
 * layers rendered interleaved into the Mapbox scene.
 *
 * Everything animated here derives from real FIRMS detection timestamps.
 * Interpolation (fade-in pulses, ember dimming, envelope growth) is purely a
 * visual smoothing between those real timestamps — positions are never moved
 * and no intermediate "fire perimeter" is invented. The polygon is labelled
 * as an observed satellite detection envelope, not a perimeter.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { FireDetection } from '../lib/loadFirmsCsv';
import { KENNETH_FIRE } from '../data/kennethFacts';
import {
  densifyRing,
  detectionEnvelope,
  lerp,
  type EnvelopeSource,
  type LonLat,
} from '../lib/geometry';
import { clamp, countAtOrBefore, easeOutCubic, smoothstep01 } from '../lib/timeUtils';

// Visual timing constants, expressed in *fire time* (the animated clock).
const PULSE_FIRE_MS = 40 * 60 * 1000; // fade-in pulse duration for a new detection
const ENVELOPE_GROW_FIRE_MS = 50 * 60 * 1000; // envelope eases outward to a new detection
const DIM_FIRE_MS = 10 * 60 * 60 * 1000; // older detections dim toward embers over this horizon
const EMBER_FLOOR = 0.38; // dimmed detections stay visible as burned-area history

const ENVELOPE_DISC_M = 330; // per-detection envelope contribution (~VIIRS pixel footprint)
const RING_STEP_M = 90; // envelope outline densification so it follows 3D terrain
const POINT_Z_OFFSET_M = 35;
const ENVELOPE_Z_OFFSET_M = 26;
const FALLBACK_ELEVATION_M = 400; // approx. exaggerated terrain height before DEM tiles load

const TEXT_FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

type RGB = [number, number, number];
type RGBA = [number, number, number, number];

interface PointDatum {
  lon: number;
  lat: number;
  z: number;
  /** Fire-time ms since this detection appeared. */
  age: number;
  frp: number;
  confidence: number;
  brightness: number;
}

interface LabelDatum {
  position: [number, number, number];
  text: string;
}

function mix3(a: RGB, b: RGB, t: number): RGB {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

const fadeIn = (age: number) => smoothstep01(age / PULSE_FIRE_MS);
const dimFactor = (age: number) =>
  EMBER_FLOOR + (1 - EMBER_FLOOR) * (1 - smoothstep01(age / DIM_FIRE_MS));
const pulseScale = (age: number) => 1 + 1.6 * (1 - easeOutCubic(fadeIn(age)));
const baseRadius = (frp: number) => clamp(170 + Math.sqrt(Math.max(frp, 0)) * 70, 170, 850);
/** 0..1 heat from brightness temperature (VIIRS I-4 saturates near 367 K). */
const heat = (brightness: number) =>
  Number.isFinite(brightness) ? clamp((brightness - 310) / 57, 0, 1) : 0.5;

function coreColor(d: PointDatum): RGBA {
  const dim = dimFactor(d.age);
  let rgb = mix3([255, 122, 40], [255, 228, 170], heat(d.brightness));
  const emberMix = 0.7 * (1 - (dim - EMBER_FLOOR) / (1 - EMBER_FLOOR));
  rgb = mix3(rgb, [196, 70, 38], emberMix);
  return [rgb[0], rgb[1], rgb[2], 230 * d.confidence * fadeIn(d.age) * dim];
}

function glowColor(d: PointDatum): RGBA {
  const boost = 1 + 1.4 * (1 - fadeIn(d.age));
  const alpha = 30 * d.confidence * fadeIn(d.age) * (0.5 + 0.5 * dimFactor(d.age)) * boost;
  return [255, 110, 28, alpha];
}

interface MapViewProps {
  token: string;
  detections: FireDetection[];
  currentTime: number;
}

export default function MapView({ token, detections, currentTime }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const detectionsRef = useRef(detections);
  detectionsRef.current = detections;
  const elevationsRef = useRef<Float64Array>(new Float64Array(0));
  const [mapReady, setMapReady] = useState(false);
  const [elevVersion, setElevVersion] = useState(0);
  const [authError, setAuthError] = useState(false);

  const timestamps = useMemo(() => detections.map((d) => d.timestamp), [detections]);

  // Centroid of all detections strictly older than index i. A new detection's
  // envelope contribution eases outward from this centroid to its true
  // position, so the envelope expands continuously instead of jumping.
  const prefixCentroids = useMemo<LonLat[]>(() => {
    const out: LonLat[] = new Array(detections.length);
    let sumLon = 0;
    let sumLat = 0;
    for (let i = 0; i < detections.length; i++) {
      out[i] = i === 0 ? [detections[0].lon, detections[0].lat] : [sumLon / i, sumLat / i];
      sumLon += detections[i].lon;
      sumLat += detections[i].lat;
    }
    return out;
  }, [detections]);

  useEffect(() => {
    if (!containerRef.current) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [KENNETH_FIRE.lon, KENNETH_FIRE.lat],
      zoom: 11.1,
      pitch: 32,
      bearing: -8,
      antialias: true,
    });
    mapRef.current = map;

    const overlay = new MapboxOverlay({ interleaved: true, layers: [] });
    map.addControl(overlay as unknown as mapboxgl.IControl);
    overlayRef.current = overlay;

    map.on('error', (event) => {
      const status = (event.error as { status?: number } | undefined)?.status;
      if (status === 401 || status === 403) setAuthError(true);
    });

    const refreshElevations = () => {
      const list = detectionsRef.current;
      if (elevationsRef.current.length !== list.length) {
        elevationsRef.current = new Float64Array(list.length).fill(Number.NaN);
      }
      const arr = elevationsRef.current;
      let changed = false;
      for (let i = 0; i < list.length; i++) {
        if (Number.isFinite(arr[i])) continue;
        const elevation = map.queryTerrainElevation([list[i].lon, list[i].lat]);
        if (typeof elevation === 'number' && Number.isFinite(elevation)) {
          arr[i] = elevation;
          changed = true;
        }
      }
      if (changed) setElevVersion((v) => v + 1);
    };

    map.on('load', () => {
      map.addSource('terrain-dem', {
        type: 'raster-dem',
        url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
        tileSize: 512,
        maxzoom: 14,
      });
      map.setTerrain({ source: 'terrain-dem', exaggeration: 1.35 });

      map.addSource('hillshade-dem', {
        type: 'raster-dem',
        url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
        tileSize: 512,
        maxzoom: 14,
      });
      const firstSymbolId = map.getStyle()?.layers?.find((l) => l.type === 'symbol')?.id;
      map.addLayer(
        {
          id: 'kenneth-hillshade',
          type: 'hillshade',
          source: 'hillshade-dem',
          paint: {
            'hillshade-exaggeration': 0.45,
            'hillshade-shadow-color': '#01040a',
            'hillshade-highlight-color': '#27364f',
            'hillshade-accent-color': '#0b1322',
          },
        },
        firstSymbolId,
      );

      map.setFog({
        color: '#0b1322',
        'high-color': '#050a18',
        'horizon-blend': 0.08,
        'space-color': '#020409',
        'star-intensity': 0.35,
      });

      setMapReady(true);
      // Slow cinematic push-in once the style is ready.
      map.easeTo({ zoom: 12.55, pitch: 56, bearing: -18, duration: 3800, easing: smoothstep01 });
    });

    map.on('idle', refreshElevations);

    return () => {
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
  }, [token]);

  const layers = useMemo<Layer[]>(() => {
    if (!mapReady) return [];
    const map = mapRef.current;

    const elevations = elevationsRef.current;
    const elevAt = (i: number) => {
      const e = i < elevations.length ? elevations[i] : Number.NaN;
      return Number.isFinite(e) ? e : FALLBACK_ELEVATION_M;
    };
    const terrainAt = (lon: number, lat: number) => {
      const e = map?.queryTerrainElevation([lon, lat]);
      return typeof e === 'number' && Number.isFinite(e) ? e : FALLBACK_ELEVATION_M;
    };

    const visibleCount = countAtOrBefore(timestamps, currentTime);

    const points: PointDatum[] = [];
    const envelopeSources: EnvelopeSource[] = [];
    for (let i = 0; i < visibleCount; i++) {
      const d = detections[i];
      const age = currentTime - d.timestamp;
      points.push({
        lon: d.lon,
        lat: d.lat,
        z: elevAt(i) + POINT_Z_OFFSET_M,
        age,
        frp: d.frp,
        confidence: d.confidence,
        brightness: d.brightness,
      });
      const growth = smoothstep01(age / ENVELOPE_GROW_FIRE_MS);
      const [cLon, cLat] = prefixCentroids[i];
      envelopeSources.push({
        lon: lerp(cLon, d.lon, growth),
        lat: lerp(cLat, d.lat, growth),
        radiusM: ENVELOPE_DISC_M * growth,
      });
    }

    const result: Layer[] = [];

    const ring = detectionEnvelope(envelopeSources);
    if (ring) {
      const ring3d = densifyRing(ring, RING_STEP_M).map(
        ([lon, lat]) =>
          [lon, lat, terrainAt(lon, lat) + ENVELOPE_Z_OFFSET_M] as [number, number, number],
      );
      const envelopeData = [{ polygon: ring3d }];
      result.push(
        new PolygonLayer<{ polygon: [number, number, number][] }>({
          id: 'envelope-halo',
          data: envelopeData,
          getPolygon: (d) => d.polygon,
          filled: false,
          stroked: true,
          getLineColor: [255, 120, 30, 50],
          getLineWidth: 14,
          lineWidthUnits: 'pixels',
        }),
        new PolygonLayer<{ polygon: [number, number, number][] }>({
          id: 'envelope',
          data: envelopeData,
          getPolygon: (d) => d.polygon,
          filled: true,
          stroked: true,
          getFillColor: [255, 70, 18, 38],
          getLineColor: [255, 168, 64, 235],
          getLineWidth: 2.4,
          lineWidthUnits: 'pixels',
        }),
      );
    }

    result.push(
      new ScatterplotLayer<PointDatum>({
        id: 'detection-glow',
        data: points,
        getPosition: (d) => [d.lon, d.lat, d.z],
        getRadius: (d) => baseRadius(d.frp) * 2.7 * pulseScale(d.age),
        getFillColor: glowColor,
        radiusUnits: 'meters',
        radiusMinPixels: 4,
        radiusMaxPixels: 140,
        stroked: false,
        billboard: true,
      }),
      new ScatterplotLayer<PointDatum>({
        id: 'detection-core',
        data: points,
        getPosition: (d) => [d.lon, d.lat, d.z],
        getRadius: (d) => baseRadius(d.frp) * pulseScale(d.age),
        getFillColor: coreColor,
        radiusUnits: 'meters',
        radiusMinPixels: 1.5,
        radiusMaxPixels: 60,
        stroked: false,
        billboard: true,
      }),
    );

    const pings = points.filter((p) => p.age < PULSE_FIRE_MS);
    if (pings.length > 0) {
      result.push(
        new ScatterplotLayer<PointDatum>({
          id: 'detection-ping',
          data: pings,
          getPosition: (d) => [d.lon, d.lat, d.z],
          getRadius: (d) => 150 + 1500 * easeOutCubic(d.age / PULSE_FIRE_MS),
          getLineColor: (d) => [255, 190, 90, 170 * (1 - d.age / PULSE_FIRE_MS) * d.confidence],
          filled: false,
          stroked: true,
          getLineWidth: 2,
          lineWidthUnits: 'pixels',
          radiusUnits: 'meters',
          billboard: true,
        }),
      );
    }

    const ignitionZ = terrainAt(KENNETH_FIRE.lon, KENNETH_FIRE.lat) + 45;
    const ignitionPosition: [number, number, number] = [
      KENNETH_FIRE.lon,
      KENNETH_FIRE.lat,
      ignitionZ,
    ];
    result.push(
      new ScatterplotLayer<LabelDatum>({
        id: 'ignition-dot',
        data: [{ position: ignitionPosition, text: '' }],
        getPosition: (d) => d.position,
        getRadius: 4.5,
        radiusUnits: 'pixels',
        getFillColor: [255, 238, 214, 235],
        billboard: true,
      }),
      new ScatterplotLayer<LabelDatum>({
        id: 'ignition-ring',
        data: [{ position: ignitionPosition, text: '' }],
        getPosition: (d) => d.position,
        getRadius: 11,
        radiusUnits: 'pixels',
        filled: false,
        stroked: true,
        getLineColor: [255, 205, 130, 210],
        getLineWidth: 1.6,
        lineWidthUnits: 'pixels',
        billboard: true,
      }),
      new TextLayer<LabelDatum>({
        id: 'ignition-label',
        data: [{ position: ignitionPosition, text: 'Reported start area' }],
        getPosition: (d) => d.position,
        getText: (d) => d.text,
        getSize: 12.5,
        getColor: [255, 255, 255, 228],
        getPixelOffset: [0, -30],
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'bottom',
        background: true,
        getBackgroundColor: [8, 13, 26, 200],
        backgroundPadding: [8, 4],
        fontFamily: TEXT_FONT,
        billboard: true,
      }),
      new TextLayer<LabelDatum>({
        id: 'final-size-label',
        data: [
          {
            position: ignitionPosition,
            text: `CAL FIRE final size: ${KENNETH_FIRE.finalAcres.toLocaleString('en-US')} acres.`,
          },
        ],
        getPosition: (d) => d.position,
        getText: (d) => d.text,
        getSize: 11.5,
        getColor: [233, 238, 250, 205],
        getPixelOffset: [0, 30],
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'top',
        background: true,
        getBackgroundColor: [8, 13, 26, 185],
        backgroundPadding: [8, 4],
        fontFamily: TEXT_FONT,
        billboard: true,
      }),
    );

    return result;
  }, [mapReady, detections, timestamps, prefixCentroids, currentTime, elevVersion]);

  useEffect(() => {
    overlayRef.current?.setProps({ layers });
  }, [layers]);

  return (
    <div className="map-shell">
      <div ref={containerRef} className="map-container" />
      {authError && (
        <div className="map-auth-error glass">
          Mapbox rejected the access token. Check <code>VITE_MAPBOX_TOKEN</code> in your{' '}
          <code>.env</code> file, then restart <code>npm run dev</code>.
        </div>
      )}
    </div>
  );
}
