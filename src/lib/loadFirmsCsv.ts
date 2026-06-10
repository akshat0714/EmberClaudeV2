/**
 * Loader/parser for NASA FIRMS archive CSV files.
 *
 * Expected columns (VIIRS archive format):
 *   latitude, longitude, acq_date, acq_time, satellite, confidence, frp, bright_ti4
 * MODIS exports are also accepted (`brightness` is used when `bright_ti4` is
 * absent, and numeric 0–100 confidence is normalised).
 *
 * Rows are filtered to a small radius around the official Kenneth Fire
 * ignition point so other January 2025 incidents captured by the same FIRMS
 * download (e.g. the Palisades Fire) don't contaminate this timeline.
 */
import { KENNETH_FIRE } from '../data/kennethFacts';
import { haversineKm } from './geometry';
import { clamp, parseFirmsTimestamp } from './timeUtils';

export interface FireDetection {
  lon: number;
  lat: number;
  /** UTC milliseconds derived from acq_date + acq_time. */
  timestamp: number;
  /** Fire radiative power in MW (0 when not reported). */
  frp: number;
  /** Normalised detection confidence, 0..1. */
  confidence: number;
  /** Brightness temperature in kelvin (bright_ti4 / brightness), NaN when absent. */
  brightness: number;
  /** Raw satellite code from the CSV (e.g. "N", "1"). */
  satellite: string;
  /** Friendly satellite name (e.g. "NOAA-20 · VIIRS"). */
  satelliteLabel: string;
}

export interface FirmsLoadResult {
  /** Detections near the Kenneth Fire, sorted by timestamp ascending. */
  detections: FireDetection[];
  /** Total parsed data rows before spatial filtering. */
  totalRows: number;
}

/** Detections farther than this from the reported ignition point are ignored. */
export const FILTER_RADIUS_KM = 6;

const SATELLITE_LABELS: Record<string, string> = {
  N: 'Suomi NPP · VIIRS',
  NPP: 'Suomi NPP · VIIRS',
  'SUOMI NPP': 'Suomi NPP · VIIRS',
  '1': 'NOAA-20 · VIIRS',
  J1: 'NOAA-20 · VIIRS',
  N20: 'NOAA-20 · VIIRS',
  'NOAA-20': 'NOAA-20 · VIIRS',
  '2': 'NOAA-21 · VIIRS',
  J2: 'NOAA-21 · VIIRS',
  N21: 'NOAA-21 · VIIRS',
  'NOAA-21': 'NOAA-21 · VIIRS',
  T: 'Terra · MODIS',
  TERRA: 'Terra · MODIS',
  A: 'Aqua · MODIS',
  AQUA: 'Aqua · MODIS',
};

export function satelliteLabel(code: string): string {
  const trimmed = code.trim();
  return SATELLITE_LABELS[trimmed.toUpperCase()] ?? (trimmed || 'Unknown satellite');
}

function parseConfidence(raw: string): number {
  const value = raw.trim().toLowerCase();
  if (value === 'l' || value === 'low') return 0.45;
  if (value === 'n' || value === 'nominal') return 0.75;
  if (value === 'h' || value === 'high') return 1;
  const num = Number(value);
  if (Number.isFinite(num)) return clamp(num / 100, 0.3, 1);
  return 0.7;
}

function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Parse FIRMS CSV text. Throws an Error with a readable message when the
 * header is missing required columns. Repeated header lines (from naively
 * concatenated multi-sensor downloads) are skipped automatically.
 */
export function parseFirmsCsv(text: string): FirmsLoadResult {
  const lines = text.split(/\r?\n/);
  let headerIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes('latitude')) {
      headerIndex = i;
      break;
    }
  }
  if (headerIndex === -1) {
    throw new Error('No FIRMS header row found — the file does not look like a FIRMS CSV.');
  }

  const headers = splitCsvLine(lines[headerIndex]).map((h) => h.trim().toLowerCase());
  const col = (name: string) => headers.indexOf(name);
  const latCol = col('latitude');
  const lonCol = col('longitude');
  const dateCol = col('acq_date');
  const timeCol = col('acq_time');
  const satCol = col('satellite');
  const confCol = col('confidence');
  const frpCol = col('frp');
  const brightCol = col('bright_ti4') !== -1 ? col('bright_ti4') : col('brightness');

  const missing = [
    ['latitude', latCol],
    ['longitude', lonCol],
    ['acq_date', dateCol],
    ['acq_time', timeCol],
  ]
    .filter(([, idx]) => idx === -1)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`FIRMS CSV is missing required column(s): ${missing.join(', ')}.`);
  }

  const detections: FireDetection[] = [];
  let totalRows = 0;

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const fields = splitCsvLine(line);
    const lat = Number(fields[latCol]);
    const lon = Number(fields[lonCol]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue; // repeated header or junk row
    const timestamp = parseFirmsTimestamp(fields[dateCol] ?? '', fields[timeCol] ?? '');
    if (timestamp === null) continue;
    totalRows++;

    if (haversineKm(lon, lat, KENNETH_FIRE.lon, KENNETH_FIRE.lat) > FILTER_RADIUS_KM) continue;

    const satellite = satCol !== -1 ? (fields[satCol] ?? '').trim() : '';
    const frp = frpCol !== -1 ? Number(fields[frpCol]) : NaN;
    const brightness = brightCol !== -1 ? Number(fields[brightCol]) : NaN;
    detections.push({
      lon,
      lat,
      timestamp,
      frp: Number.isFinite(frp) ? frp : 0,
      confidence: confCol !== -1 ? parseConfidence(fields[confCol] ?? '') : 0.7,
      brightness: Number.isFinite(brightness) ? brightness : NaN,
      satellite,
      satelliteLabel: satelliteLabel(satellite),
    });
  }

  detections.sort((a, b) => a.timestamp - b.timestamp);
  return { detections, totalRows };
}

/**
 * Fetch and parse the bundled CSV. Returns null when the file is absent
 * (404, network error, or the dev server answered with an HTML fallback page).
 * Throws when the file exists but cannot be parsed as a FIRMS CSV.
 */
export async function loadFirmsFromUrl(url: string): Promise<FirmsLoadResult | null> {
  let response: Response;
  try {
    response = await fetch(url, { cache: 'no-store' });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/html')) return null;
  const text = await response.text();
  if (!text.trim() || text.trimStart().startsWith('<')) return null;
  return parseFirmsCsv(text);
}
