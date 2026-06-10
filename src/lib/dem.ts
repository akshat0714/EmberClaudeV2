/**
 * Real elevation for the fire-model area.
 *
 * scripts/fetch-dem.mjs samples the AWS Open Data "Terrain Tiles" terrarium
 * tiles (USGS 3DEP/NED-derived for California; tilezen/joerd encoding
 * elevation = R·256 + G + B/256 − 32768) onto a ~30 m lat/lng grid bundled at
 * data/dem.json. This module loads that grid once and serves bilinear
 * samples. If the file is missing or fails to load, callers fall back to the
 * analytic elevation surface (see arrivalTimeModel.approxElevation).
 */

export interface DemGrid {
  latMin: number;
  lngMin: number;
  dLat: number;
  dLng: number;
  rows: number;
  cols: number;
  /** Elevation in meters, row-major. */
  elev: Float32Array;
}

let dem: DemGrid | null = null;
let pending: Promise<DemGrid | null> | null = null;

function decodeBase64Int16(b64: string): Int16Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

export interface RawDem {
  latMin: number;
  lngMin: number;
  dLat: number;
  dLng: number;
  rows: number;
  cols: number;
  encoding: string;
  elev: string;
}

function decodeRaw(raw: RawDem): DemGrid {
  if (raw.encoding !== 'int16-dm-base64') throw new Error('unknown DEM encoding');
  const dm = decodeBase64Int16(raw.elev);
  const elev = new Float32Array(dm.length);
  for (let i = 0; i < dm.length; i++) elev[i] = dm[i] / 10;
  return {
    latMin: raw.latMin,
    lngMin: raw.lngMin,
    dLat: raw.dLat,
    dLng: raw.dLng,
    rows: raw.rows,
    cols: raw.cols,
    elev,
  };
}

/** Direct injection for Node-side tests (no fetch). */
export function setDemData(raw: RawDem): void {
  dem = decodeRaw(raw);
  pending = Promise.resolve(dem);
}

const baseUrl = (): string =>
  typeof import.meta.env !== 'undefined' ? import.meta.env.BASE_URL : '/';

export function loadDem(): Promise<DemGrid | null> {
  if (pending) return pending;
  pending = fetch(`${baseUrl()}data/dem.json`)
    .then(async (res) => {
      if (!res.ok) throw new Error(`dem.json HTTP ${res.status}`);
      dem = decodeRaw((await res.json()) as RawDem);
      return dem;
    })
    .catch((error) => {
      console.warn('Real DEM unavailable, using analytic elevation fallback:', error);
      return null;
    });
  return pending;
}

export function demLoaded(): boolean {
  return dem !== null;
}

/** Bilinear DEM elevation (m), or null when unloaded / outside coverage. */
export function demElevation(lat: number, lng: number): number | null {
  if (!dem) return null;
  const r = (lat - dem.latMin) / dem.dLat;
  const c = (lng - dem.lngMin) / dem.dLng;
  if (r < 0 || c < 0 || r > dem.rows - 1 || c > dem.cols - 1) return null;
  const r0 = Math.min(Math.floor(r), dem.rows - 2);
  const c0 = Math.min(Math.floor(c), dem.cols - 2);
  const fr = r - r0;
  const fc = c - c0;
  const i = r0 * dem.cols + c0;
  const v00 = dem.elev[i];
  const v01 = dem.elev[i + 1];
  const v10 = dem.elev[i + dem.cols];
  const v11 = dem.elev[i + dem.cols + 1];
  return v00 * (1 - fr) * (1 - fc) + v01 * (1 - fr) * fc + v10 * fr * (1 - fc) + v11 * fr * fc;
}
