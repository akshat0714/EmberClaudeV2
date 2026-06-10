/**
 * Build-time fetch of the REAL street network for the navigation area
 * (West Hills / Hidden Hills / Calabasas / Woodland Hills / Canoga Park)
 * from OpenStreetMap via the Overpass API, preprocessed into a compact
 * routing graph at public/data/streets.json.
 *
 * Graph model:
 *  - nodes  = junctions (OSM nodes shared by >1 way, or way endpoints)
 *  - edges  = way chains between junctions, with full intermediate geometry,
 *             street name, highway class, oneway flag and parsed maxspeed
 *
 * Data: © OpenStreetMap contributors, ODbL — attribution required and kept
 * in the output file and in the app UI.
 *
 * Usage: node scripts/fetch-streets.mjs
 */
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/data/streets.json');

/** Navigation bbox: generous margin around the fire area so evacuation
 *  routes and all real evacuation centers fall inside the graph — west to
 *  Westlake Village (Calvary Community Church, the shelter the City of
 *  Calabasas directed Kenneth Fire evacuees to), east past Pierce College. */
const BBOX = { latMin: 34.115, lngMin: -118.85, latMax: 34.245, lngMax: -118.56 };

/**
 * Drivable public roads. `service` ways (parking aisles, driveways) and
 * private/no-access roads are excluded — evacuation guidance should keep
 * people on the public street network.
 */
const QUERY = `
[out:json][timeout:180];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|living_street)$"]
     ["area"!="yes"]
     ["access"!~"^(private|no)$"]
     (${BBOX.latMin},${BBOX.lngMin},${BBOX.latMax},${BBOX.lngMax});
);
out geom;
`;

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

async function fetchOverpass() {
  let lastError;
  for (const endpoint of ENDPOINTS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        console.log(`Querying ${endpoint} (attempt ${attempt + 1})...`);
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'ember-wildfire-evacuation-demo/1.0 (build-time data fetch)',
          },
          body: `data=${encodeURIComponent(QUERY)}`,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (error) {
        lastError = error;
        const wait = 2000 * 2 ** attempt;
        console.warn(`  failed (${error.message}); retrying in ${wait / 1000}s`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastError;
}

/** "25 mph" / "40" / "30 km/h" → km/h; null when unparseable ("signals"...). */
function parseMaxspeed(raw) {
  if (!raw) return null;
  const m = /^(\d+(?:\.\d+)?)\s*(mph|km\/h|kmh)?$/.exec(raw.trim());
  if (!m) return null;
  const value = Number(m[1]);
  return m[2] === 'mph' ? Math.round(value * 1.609344) : Math.round(value);
}

function oneWayOf(tags) {
  const raw = tags.oneway;
  if (raw === '-1') return -1;
  if (raw === 'yes' || raw === '1' || raw === 'true') return 1;
  if (raw === 'no') return 0;
  // OSM convention: roundabouts are implicitly oneway in digitization order.
  if (tags.junction === 'roundabout' || tags.junction === 'circular') return 1;
  return 0;
}

const round6 = (v) => Math.round(v * 1e6) / 1e6;

function buildGraph(osm) {
  const ways = osm.elements.filter((e) => e.type === 'way' && e.geometry?.length >= 2);
  console.log(`Overpass returned ${ways.length} ways`);

  // Junctions = OSM node ids used by more than one way, plus way endpoints.
  const usage = new Map();
  for (const way of ways) {
    for (const id of way.nodes) usage.set(id, (usage.get(id) ?? 0) + 1);
  }

  const nodeIndex = new Map(); // osm node id -> graph node index
  const nodes = []; // [lat, lng]
  const edges = [];

  const junctionIndex = (osmId, lat, lng) => {
    let idx = nodeIndex.get(osmId);
    if (idx === undefined) {
      idx = nodes.length;
      nodeIndex.set(osmId, idx);
      nodes.push([round6(lat), round6(lng)]);
    }
    return idx;
  };

  for (const way of ways) {
    const tags = way.tags ?? {};
    const oneway = oneWayOf(tags);
    const maxKmh = parseMaxspeed(tags.maxspeed);
    const name = tags.name ?? tags.ref ?? null;

    // Split the way at junction nodes into graph edges.
    let chainStart = 0;
    for (let i = 1; i < way.nodes.length; i++) {
      const isJunction = i === way.nodes.length - 1 || usage.get(way.nodes[i]) > 1;
      if (!isJunction) continue;
      const pts = way.geometry
        .slice(chainStart, i + 1)
        .map((p) => [round6(p.lat), round6(p.lon)]);
      if (pts.length >= 2) {
        const a = junctionIndex(way.nodes[chainStart], pts[0][0], pts[0][1]);
        const b = junctionIndex(way.nodes[i], pts[pts.length - 1][0], pts[pts.length - 1][1]);
        if (a !== b || pts.length > 2) {
          const edge = { a, b, hw: tags.highway, pts };
          if (name) edge.name = name;
          if (oneway !== 0) edge.ow = oneway;
          if (maxKmh) edge.kmh = maxKmh;
          edges.push(edge);
        }
      }
      chainStart = i;
    }
  }

  // Keep only the largest connected component (ignoring oneway direction) so
  // the router never targets an unreachable island.
  const adjacency = new Map();
  edges.forEach((e, i) => {
    if (!adjacency.has(e.a)) adjacency.set(e.a, []);
    if (!adjacency.has(e.b)) adjacency.set(e.b, []);
    adjacency.get(e.a).push(i);
    adjacency.get(e.b).push(i);
  });
  const component = new Int32Array(nodes.length).fill(-1);
  let componentCount = 0;
  const sizes = [];
  for (let start = 0; start < nodes.length; start++) {
    if (component[start] !== -1 || !adjacency.has(start)) continue;
    const stack = [start];
    component[start] = componentCount;
    let size = 0;
    while (stack.length) {
      const n = stack.pop();
      size++;
      for (const ei of adjacency.get(n) ?? []) {
        const e = edges[ei];
        const other = e.a === n ? e.b : e.a;
        if (component[other] === -1) {
          component[other] = componentCount;
          stack.push(other);
        }
      }
    }
    sizes.push(size);
    componentCount++;
  }
  const mainComponent = sizes.indexOf(Math.max(...sizes));
  const keptEdges = edges.filter((e) => component[e.a] === mainComponent);

  // Re-pack node indices to only those used by kept edges.
  const remap = new Map();
  const packedNodes = [];
  for (const e of keptEdges) {
    for (const key of ['a', 'b']) {
      const old = e[key];
      let idx = remap.get(old);
      if (idx === undefined) {
        idx = packedNodes.length;
        remap.set(old, idx);
        packedNodes.push(nodes[old]);
      }
      e[key] = idx;
    }
  }

  console.log(
    `Graph: ${packedNodes.length} junctions, ${keptEdges.length} edges ` +
      `(dropped ${edges.length - keptEdges.length} island edges)`,
  );
  return { nodes: packedNodes, edges: keptEdges };
}

const osm = await fetchOverpass();
const graph = buildGraph(osm);
const out = {
  attribution: '© OpenStreetMap contributors (ODbL). overpass-api.de extract.',
  generatedAt: new Date().toISOString(),
  bbox: BBOX,
  ...graph,
};
await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(out));
const kb = Math.round(Buffer.byteLength(JSON.stringify(out)) / 1024);
console.log(`Wrote ${OUT} (${kb} KB)`);
