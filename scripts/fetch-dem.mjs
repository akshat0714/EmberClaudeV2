/**
 * Build-time fetch of REAL elevation for the fire-model area from the AWS
 * Open Data "Terrain Tiles" dataset (the former Mapzen/tilezen "joerd"
 * terrarium tiles; USGS 3DEP/NED-derived for California).
 *
 * Terrarium PNG encoding (tilezen/joerd documentation):
 *   elevation_m = (R * 256 + G + B / 256) - 32768
 *
 * The tiles are decoded (built-in zlib, no npm deps), resampled bilinearly
 * onto a small lat/lng grid, and written as base64 int16 decimeters to
 * public/data/dem.json.
 *
 * Usage: node scripts/fetch-dem.mjs
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/data/dem.json');

/** Fire-model area plus margin (must cover spreadModelConfig GRID). */
const BBOX = { latMin: 34.148, lngMin: -118.748, latMax: 34.228, lngMax: -118.632 };
const ZOOM = 13; // ~15.9 m/px at the equator, ~13 m/px at 34°N
const SAMPLE_METERS = 30;

const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG = 111_320 * Math.cos((34.19 * Math.PI) / 180);

// ---------------------------------------------------------------- PNG decode
function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8;
  let ihdr = null;
  let palette = null;
  const idat = [];
  while (pos < buffer.length) {
    const length = buffer.readUInt32BE(pos);
    const type = buffer.toString('ascii', pos + 4, pos + 8);
    const data = buffer.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + length;
  }
  if (!ihdr) throw new Error('missing IHDR');
  if (ihdr.bitDepth !== 8) throw new Error(`unsupported bit depth ${ihdr.bitDepth}`);
  if (ihdr.interlace !== 0) throw new Error('interlaced PNG unsupported');
  const channelsByType = { 0: 1, 2: 3, 3: 1, 6: 4 };
  const channels = channelsByType[ihdr.colorType];
  if (!channels) throw new Error(`unsupported color type ${ihdr.colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = ihdr.width * channels;
  const out = Buffer.alloc(ihdr.height * stride);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < ihdr.height; y++) {
    const filter = raw[y * (stride + 1)];
    const rowIn = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const rowOut = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? rowOut[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      let v = rowIn[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) v += paeth(a, b, c);
      rowOut[x] = v & 0xff;
    }
  }

  /** Returns [r, g, b] for pixel (x, y). */
  const rgbAt = (x, y) => {
    const i = y * stride + x * channels;
    if (ihdr.colorType === 3) {
      const p = out[i] * 3;
      return [palette[p], palette[p + 1], palette[p + 2]];
    }
    if (ihdr.colorType === 0) return [out[i], out[i], out[i]];
    return [out[i], out[i + 1], out[i + 2]];
  };
  return { width: ihdr.width, height: ihdr.height, rgbAt };
}

// -------------------------------------------------------------- tile fetching
const tileX = (lng) => ((lng + 180) / 360) * 2 ** ZOOM;
const tileY = (lat) => {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * 2 ** ZOOM;
};

async function fetchTile(x, y) {
  const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${ZOOM}/${x}/${y}.png`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'ember-wildfire-evacuation-demo/1.0 (build-time data fetch)' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return decodePng(Buffer.from(await res.arrayBuffer()));
    } catch (error) {
      const wait = 1500 * 2 ** attempt;
      console.warn(`  ${url} failed (${error.message}); retrying in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw new Error(`could not fetch tile ${ZOOM}/${x}/${y}`);
}

const x0 = Math.floor(tileX(BBOX.lngMin));
const x1 = Math.floor(tileX(BBOX.lngMax));
const y0 = Math.floor(tileY(BBOX.latMax)); // y grows southward
const y1 = Math.floor(tileY(BBOX.latMin));
console.log(`Fetching ${(x1 - x0 + 1) * (y1 - y0 + 1)} terrarium tiles at z${ZOOM}...`);

const tiles = new Map();
for (let ty = y0; ty <= y1; ty++) {
  for (let tx = x0; tx <= x1; tx++) {
    tiles.set(`${tx}/${ty}`, await fetchTile(tx, ty));
    console.log(`  tile ${tx}/${ty} ok`);
  }
}

/** Bilinear terrarium elevation at (lat, lng), meters. */
function elevationAt(lat, lng) {
  const px = tileX(lng) * 256;
  const py = tileY(lat) * 256;
  const x = Math.floor(px - 0.5);
  const y = Math.floor(py - 0.5);
  const fx = px - 0.5 - x;
  const fy = py - 0.5 - y;
  const sample = (sx, sy) => {
    const tx = Math.floor(sx / 256);
    const ty = Math.floor(sy / 256);
    const tile = tiles.get(`${tx}/${ty}`);
    if (!tile) return null;
    const [r, g, b] = tile.rgbAt(sx - tx * 256, sy - ty * 256);
    return r * 256 + g + b / 256 - 32768;
  };
  const v00 = sample(x, y);
  const v10 = sample(x + 1, y);
  const v01 = sample(x, y + 1);
  const v11 = sample(x + 1, y + 1);
  if (v00 === null || v10 === null || v01 === null || v11 === null) {
    return v00 ?? v10 ?? v01 ?? v11 ?? 0;
  }
  return v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy;
}

// ------------------------------------------------------------------ resample
const dLat = SAMPLE_METERS / M_PER_DEG_LAT;
const dLng = SAMPLE_METERS / M_PER_DEG_LNG;
const rows = Math.floor((BBOX.latMax - BBOX.latMin) / dLat) + 1;
const cols = Math.floor((BBOX.lngMax - BBOX.lngMin) / dLng) + 1;
const data = new Int16Array(rows * cols);
let min = Infinity;
let max = -Infinity;
for (let r = 0; r < rows; r++) {
  const lat = BBOX.latMin + r * dLat;
  for (let c = 0; c < cols; c++) {
    const elevation = elevationAt(lat, BBOX.lngMin + c * dLng);
    const dm = Math.max(-32768, Math.min(32767, Math.round(elevation * 10)));
    data[r * cols + c] = dm;
    min = Math.min(min, elevation);
    max = Math.max(max, elevation);
  }
}
console.log(`Grid ${rows}x${cols}, elevation ${min.toFixed(0)}-${max.toFixed(0)} m`);

const out = {
  attribution:
    'Terrain Tiles on AWS Open Data (tilezen/joerd terrarium); contains USGS 3DEP/NED. ' +
    'See https://registry.opendata.aws/terrain-tiles/',
  generatedAt: new Date().toISOString(),
  latMin: BBOX.latMin,
  lngMin: BBOX.lngMin,
  dLat,
  dLng,
  rows,
  cols,
  /** Row-major int16 decimeters, little-endian, base64. */
  encoding: 'int16-dm-base64',
  elev: Buffer.from(data.buffer).toString('base64'),
};
await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(out));
console.log(`Wrote ${OUT} (${Math.round(JSON.stringify(out).length / 1024)} KB)`);
