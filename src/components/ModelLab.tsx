/**
 * Prediction Lab — a separate screen that stress-tests the SAME spread
 * model on deliberately hostile synthetic terrain and shows the actual
 * formulas computing in real time.
 *
 * Left: the raw model world, cell by cell (the scenario app hides the grid;
 * the lab shows it) — hillshaded terrain and fuel mosaic, the river barrier
 * with its one ford, the lake, the town strip; the burned field (dark red,
 * aging), the live 15-minute prediction bands, the minimum-travel-time
 * pathways, the front edge, a ghost of the last archived forecast, and a
 * live wind arrow. An inset draws the elliptical kernel R(θ) for the
 * current head cell.
 *
 * Right: the formula HUD — every term of the model (effective wind–slope
 * vector, head rate, ellipse eccentricity, directional rate, Dijkstra
 * stats, prediction size, forecast-vs-reality grade) recomputed and
 * displayed each refresh.
 */
import { useEffect, useRef, useState } from 'react';
import { LAB_CONFIG, createLabSim, type LabMetrics, type LabSim } from '../lib/labSim';
import { LAB_CELL_M, SURFACE, type LabWorld } from '../lib/labTerrain';
import { extractPathways } from '../lib/predictionBands';

const SCALE = 8; // px per model cell

const SURFACE_COLORS: Record<number, [number, number, number]> = {
  [SURFACE.grass]: [116, 134, 70],
  [SURFACE.brush]: [94, 110, 58],
  [SURFACE.timber]: [56, 84, 52],
  [SURFACE.rock]: [122, 118, 110],
  [SURFACE.town]: [134, 130, 124],
  [SURFACE.water]: [38, 70, 110],
};

interface MapLabel {
  x: number;
  y: number;
  text: string;
}

const LABELS: MapLabel[] = [
  { x: 950, y: 2350, text: 'lake' },
  { x: 2050, y: 1960, text: 'ford' },
  { x: 3780, y: 380, text: 'town' },
  { x: 3000, y: 2460, text: 'peak' },
  { x: 1700, y: 2570, text: 'ridge' },
  { x: 1400, y: 1180, text: 'ignition' },
  { x: 700, y: 1500, text: 'river' },
];

function py(rows: number, row: number): number {
  return (rows - 1 - row) * SCALE; // north is up
}

/** Static terrain base: hillshade + fuel mosaic, baked once per world. */
function renderBase(world: LabWorld): HTMLCanvasElement {
  const { rows, cols } = world.grid;
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(cols, rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const s = world.surface[i];
      const [cr, cg, cb] = SURFACE_COLORS[s];
      // light from the north-west; water stays flat
      let shade = 1;
      if (s !== SURFACE.water) {
        shade = 0.78 + 1.5 * (-0.7 * world.grid.gradX[i] + 0.7 * world.grid.gradY[i]);
        shade = Math.min(Math.max(shade, 0.55), 1.3);
        // subtle fuel patchiness texture so the mosaic reads
        shade *= 0.94 + 0.06 * world.grid.patch[i];
      }
      const p = ((rows - 1 - r) * cols + c) * 4;
      img.data[p] = Math.min(255, cr * shade);
      img.data[p + 1] = Math.min(255, cg * shade);
      img.data[p + 2] = Math.min(255, cb * shade);
      img.data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

interface FrameCache {
  tau: number;
  overlay: HTMLCanvasElement;
  frontSegs: Array<[number, number, number, number]>;
  ghostSegs: Array<[number, number, number, number]>;
  paths: Array<Array<[number, number]>>;
}

/** Edges between an "inside" cell and an "outside" neighbor, in px. */
function maskEdges(
  rows: number,
  cols: number,
  inside: (i: number) => boolean,
): Array<[number, number, number, number]> {
  const segs: Array<[number, number, number, number]> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (!inside(i)) continue;
      const x0 = c * SCALE;
      const y0 = py(rows, r);
      if (c + 1 >= cols || !inside(i + 1)) segs.push([x0 + SCALE, y0, x0 + SCALE, y0 + SCALE]);
      if (c - 1 < 0 || !inside(i - 1)) segs.push([x0, y0, x0, y0 + SCALE]);
      if (r + 1 >= rows || !inside(i + cols)) segs.push([x0, y0, x0 + SCALE, y0]);
      if (r - 1 < 0 || !inside(i - cols)) segs.push([x0, y0 + SCALE, x0 + SCALE, y0 + SCALE]);
    }
  }
  return segs;
}

function buildFrame(sim: LabSim): FrameCache {
  const { rows, cols } = sim.world.grid;
  const tau = sim.tauMin;
  const field = sim.lookahead;

  const overlay = document.createElement('canvas');
  overlay.width = cols;
  overlay.height = rows;
  const ctx = overlay.getContext('2d')!;
  const img = ctx.createImageData(cols, rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const p = ((rows - 1 - r) * cols + c) * 4;
      const ignite = sim.igniteAt[i];
      if (ignite <= tau) {
        // burned, darkening with age
        const age = tau - ignite;
        const k = Math.min(age / 60, 1);
        img.data[p] = 200 - 130 * k;
        img.data[p + 1] = 60 - 48 * k;
        img.data[p + 2] = 28 - 22 * k;
        img.data[p + 3] = 205 + 25 * k;
      } else if (field && field.arrival[i] <= LAB_CONFIG.horizonMin) {
        // predicted within the horizon: banded orange, hotter near the front
        const b = field.arrival[i] / LAB_CONFIG.horizonMin;
        img.data[p] = 255;
        img.data[p + 1] = 175 - 70 * b;
        img.data[p + 2] = 60;
        img.data[p + 3] = 95 - 55 * b;
      }
    }
  }
  ctx.putImageData(img, 0, 0);

  const frontSegs = maskEdges(rows, cols, (i) => sim.igniteAt[i] <= tau);
  const lastForecast = sim.forecasts[sim.forecasts.length - 1];
  const ghostSegs = lastForecast
    ? maskEdges(rows, cols, (i) => lastForecast.predicted[i] === 1)
    : [];

  const paths: Array<Array<[number, number]>> = [];
  if (field) {
    const g = sim.world.grid;
    const raw = extractPathways(field, {
      minMinutes: LAB_CONFIG.horizonMin * 0.45,
      maxMinutes: LAB_CONFIG.horizonMin + 2,
      maxCount: 9,
      separationMeters: 160,
      minRunMeters: 90,
      smoothIterations: 2,
      originSeparationMeters: 150,
    });
    for (const path of raw) {
      paths.push(
        path.map((pt) => {
          const col = (pt.lng - g.lngMin) / g.dLng;
          const row = (pt.lat - g.latMin) / g.dLat;
          return [col * SCALE, (g.rows - 1 - row) * SCALE] as [number, number];
        }),
      );
    }
  }

  return { tau, overlay, frontSegs, ghostSegs, paths };
}

function strokeSegs(
  ctx: CanvasRenderingContext2D,
  segs: Array<[number, number, number, number]>,
  style: string,
  width: number,
  dash: number[] = [],
): void {
  ctx.save();
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of segs) {
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  }
  ctx.stroke();
  ctx.restore();
}

function drawScene(
  canvas: HTMLCanvasElement,
  base: HTMLCanvasElement,
  sim: LabSim,
  frame: FrameCache,
  nowMs: number,
): void {
  const { rows, cols } = sim.world.grid;
  const ctx = canvas.getContext('2d')!;
  const W = cols * SCALE;
  const H = rows * SCALE;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(base, 0, 0, W, H);
  ctx.drawImage(frame.overlay, 0, 0, W, H);

  // ghost of the last archived forecast (what the model believed then)
  strokeSegs(ctx, frame.ghostSegs, 'rgba(255, 255, 255, 0.55)', 1, [4, 4]);

  // minimum-travel-time pathways
  ctx.save();
  ctx.strokeStyle = 'rgba(232, 72, 48, 0.9)';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  for (const path of frame.paths) {
    ctx.beginPath();
    path.forEach(([x, y], k) => (k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.stroke();
  }
  ctx.restore();

  // active front edge, gently pulsing
  const pulse = 0.75 + 0.25 * Math.sin(nowMs / 350);
  strokeSegs(ctx, frame.frontSegs, `rgba(255, 196, 90, ${0.35 * pulse})`, 5);
  strokeSegs(ctx, frame.frontSegs, `rgba(255, 242, 190, ${0.9 * pulse})`, 2);

  // map labels
  ctx.save();
  ctx.font = '11px ui-monospace, monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 4;
  for (const l of LABELS) {
    const x = (l.x / LAB_CELL_M) * SCALE;
    const y = (rows - 1 - l.y / LAB_CELL_M) * SCALE;
    ctx.fillText(l.text, x + 4, y);
  }
  if (sim.metrics.spotIgnited) {
    const { x, y } = sim.world.xyOf(sim.world.spotCell);
    ctx.fillStyle = '#ffd2a0';
    ctx.fillText('spot fire', (x / LAB_CELL_M) * SCALE + 6, (rows - 1 - y / LAB_CELL_M) * SCALE - 6);
  }
  ctx.restore();

  // probe crosshair (the head cell the HUD numbers come from)
  const k = sim.metrics.kernel;
  if (k) {
    const { x, y } = sim.world.xyOf(k.probeCell);
    const px = (x / LAB_CELL_M) * SCALE + SCALE / 2;
    const pyy = (rows - 1 - y / LAB_CELL_M) * SCALE + SCALE / 2;
    ctx.save();
    ctx.strokeStyle = 'rgba(160, 220, 255, 0.95)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(px, pyy, 7, 0, Math.PI * 2);
    ctx.moveTo(px - 12, pyy);
    ctx.lineTo(px - 4, pyy);
    ctx.moveTo(px + 4, pyy);
    ctx.lineTo(px + 12, pyy);
    ctx.stroke();
    ctx.restore();
  }

  drawWindArrow(ctx, sim, W);
  if (k) drawKernelInset(ctx, k.effX, k.effY, k.eccentricity, H);
}

function drawWindArrow(ctx: CanvasRenderingContext2D, sim: LabSim, W: number): void {
  const wind = sim.metrics.wind;
  const cx = W - 74;
  const cy = 74;
  ctx.save();
  ctx.fillStyle = 'rgba(8, 12, 20, 0.72)';
  ctx.beginPath();
  ctx.arc(cx, cy, 52, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.stroke();
  const rad = (wind.bearingDeg * Math.PI) / 180;
  const len = 16 + wind.strength * 14;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad); // screen y is down
  ctx.strokeStyle = wind.shifting ? '#ffce54' : '#9fc4ff';
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - dx * len * 0.7, cy - dy * len * 0.7);
  ctx.lineTo(cx + dx * len * 0.55, cy + dy * len * 0.55);
  ctx.stroke();
  // arrowhead
  const hx = cx + dx * len * 0.55;
  const hy = cy + dy * len * 0.55;
  ctx.beginPath();
  ctx.moveTo(hx + dx * 10, hy + dy * 10);
  ctx.lineTo(hx - dy * 5, hy + dx * 5);
  ctx.lineTo(hx + dy * 5, hy - dx * 5);
  ctx.closePath();
  ctx.fill();
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.textAlign = 'center';
  ctx.fillText(`wind ${Math.round(wind.bearingDeg).toString().padStart(3, '0')}°`, cx, cy + 38);
  ctx.fillText(`U_w ${wind.strength.toFixed(2)}`, cx, cy + 48);
  ctx.restore();
}

/** Polar plot of R(θ) = R_h(1−ε)/(1−ε·cosθ), oriented along U⃗. */
function drawKernelInset(
  ctx: CanvasRenderingContext2D,
  effX: number,
  effY: number,
  ecc: number,
  H: number,
): void {
  const size = 150;
  const x0 = 12;
  const y0 = H - size - 12;
  const cx = x0 + size * 0.38;
  const cy = y0 + size * 0.55;
  const U = Math.hypot(effX, effY) || 1;
  const hx = effX / U;
  const hy = effY / U;
  ctx.save();
  ctx.fillStyle = 'rgba(8, 12, 20, 0.78)';
  ctx.fillRect(x0, y0, size, size);
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.strokeRect(x0, y0, size, size);
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fillText('R(θ) = R_h(1−ε)/(1−ε·cosθ)', x0 + 8, y0 + 14);

  const headPx = 86; // R_head plotted length
  ctx.strokeStyle = '#ffce54';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let k = 0; k <= 72; k++) {
    const theta = (k / 72) * Math.PI * 2;
    const r = ((1 - ecc) / (1 - ecc * Math.cos(theta))) * headPx;
    // direction = head rotated by θ (screen y down ⇒ flip world north)
    const wx = hx * Math.cos(theta) - hy * Math.sin(theta);
    const wy = hy * Math.cos(theta) + hx * Math.sin(theta);
    const x = cx + wx * r;
    const y = cy - wy * r;
    if (k === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
  // ignition point (rear focus) + head tick
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(cx, cy, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffce54';
  ctx.beginPath();
  ctx.arc(cx + hx * headPx, cy - hy * headPx, 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.fillText(`ε = ${ecc.toFixed(3)}`, x0 + 8, y0 + size - 8);
  ctx.restore();
}

function eventLine(m: LabMetrics): string {
  if (m.done) return `Run complete at τ = ${LAB_CONFIG.endMin} min.`;
  if (m.wind.shifting) return '⚠ Wind shifting 040° → 120° with a lull, then a surge — watch the forecast go stale.';
  if (m.tauMin >= LAB_CONFIG.wind.shiftEndMin) {
    return 'Wind settled toward 120° — the head climbs the ridge toward the town.';
  }
  if (m.spotIgnited) return '⚡ Ember spot fire across the river — two fronts, one model.';
  return 'Wind-driven run toward the river — the only way across is the ford.';
}

const fmt = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');

export default function ModelLab() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<LabSim | null>(null);
  const frameRef = useRef<FrameCache | null>(null);
  const [metrics, setMetrics] = useState<LabMetrics | null>(null);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(3); // fire-minutes per real second
  const [shifting, setShifting] = useState(true);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const speedRef = useRef(speed);
  speedRef.current = speed;

  // (re)create the sim when the wind mode changes
  useEffect(() => {
    const sim = createLabSim(shifting);
    simRef.current = sim;
    baseRef.current = renderBase(sim.world);
    frameRef.current = null;
    setMetrics(sim.metrics);
  }, [shifting]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let carry = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const sim = simRef.current;
      const canvas = canvasRef.current;
      const base = baseRef.current;
      if (!sim || !canvas || !base) {
        last = now;
        return;
      }
      const dt = Math.min((now - last) / 1000, 0.25);
      last = now;
      if (playingRef.current && !sim.metrics.done) {
        carry += dt * speedRef.current;
        let steps = 0;
        while (carry >= LAB_CONFIG.stepMin && steps < 4) {
          sim.step();
          carry -= LAB_CONFIG.stepMin;
          steps++;
        }
        if (steps > 0) setMetrics(sim.metrics);
      }
      if (!frameRef.current || frameRef.current.tau !== sim.tauMin) {
        frameRef.current = buildFrame(sim);
      }
      drawScene(canvas, base, sim, frameRef.current, now);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const restart = () => {
    simRef.current?.reset();
    frameRef.current = null;
    if (simRef.current) setMetrics(simRef.current.metrics);
    setPlaying(true);
  };

  const m = metrics;
  const k = m?.kernel ?? null;
  const sim = simRef.current;
  const W = sim ? sim.world.grid.cols * SCALE : 1120;
  const H = sim ? sim.world.grid.rows * SCALE : 800;

  return (
    <div className="lab-root">
      <header className="lab-top glass">
        <button className="lab-back" onClick={() => (window.location.hash = '')}>
          ← Scenario
        </button>
        <h1>
          Prediction Lab <span>same model · hostile terrain · live formulas</span>
        </h1>
        <div className="lab-controls">
          <button onClick={() => setPlaying(!playing)}>{playing ? '⏸ Pause' : '⏵ Play'}</button>
          <button onClick={restart}>↺ Restart</button>
          <span className="lab-seg">
            {[1, 3, 6].map((s) => (
              <button
                key={s}
                className={s === speed ? 'on' : ''}
                onClick={() => setSpeed(s)}
                title={`${s} fire-minutes per second`}
              >
                {s}×
              </button>
            ))}
          </span>
          <span className="lab-seg">
            <button className={shifting ? 'on' : ''} onClick={() => setShifting(true)}>
              Shifting wind
            </button>
            <button className={!shifting ? 'on' : ''} onClick={() => setShifting(false)}>
              Steady wind
            </button>
          </span>
          <span className="lab-clock">τ = {m ? Math.round(m.tauMin) : 0} min</span>
        </div>
      </header>

      <div className="lab-main">
        <div className="lab-canvas-wrap">
          <canvas ref={canvasRef} width={W} height={H} className="lab-canvas" />
          <p className="lab-event">{m ? eventLine(m) : ''}</p>
          <ul className="lab-legend">
            <li><i style={{ background: '#748646' }} /> grass</li>
            <li><i style={{ background: '#5e6e3a' }} /> brush</li>
            <li><i style={{ background: '#385434' }} /> timber</li>
            <li><i style={{ background: '#7a766e' }} /> rock</li>
            <li><i style={{ background: '#86827c' }} /> town</li>
            <li><i style={{ background: '#26466e' }} /> water</li>
            <li><i style={{ background: '#9c1e10' }} /> burned</li>
            <li><i style={{ background: '#ffaa3c' }} /> predicted ≤ {LAB_CONFIG.horizonMin} min</li>
            <li><i className="lab-legend-ghost" /> forecast (archived)</li>
            <li><i style={{ background: '#e84830' }} /> MTT pathways</li>
          </ul>
        </div>

        <aside className="lab-hud">
          <section>
            <h4>Wind — live input W⃗(t)</h4>
            <p>
              bearing <b>{m ? `${Math.round(m.wind.bearingDeg)}°` : '—'}</b> · strength{' '}
              <b>{m ? fmt(m.wind.strength, 2) : '—'}</b>
              {m?.wind.shifting && <em className="lab-badge">SHIFTING</em>}
            </p>
          </section>

          <section>
            <h4>Effective wind–slope vector</h4>
            <p className="lab-formula">U⃗ = W⃗ + k·(∇z/|∇z|)·min(|∇z|/0.35, 1)</p>
            <p>
              |∇z| = <b>{k ? fmt(k.slopeMag, 3) : '—'}</b> → U⃗ = (
              <b>{k ? fmt(k.effX, 2) : '—'}</b>, <b>{k ? fmt(k.effY, 2) : '—'}</b>) · U ={' '}
              <b>{k ? fmt(k.U, 2) : '—'}</b>
            </p>
          </section>

          <section>
            <h4>Head rate of spread</h4>
            <p className="lab-formula">R_h = R₀ · fuel · dry · (1 + a·U)</p>
            <p>
              = 6.0 · {k ? fmt(k.fuel, 2) : '—'} · 1.15 · (1 + 1.05·{k ? fmt(k.U, 2) : '—'}) ={' '}
              <b>{k ? fmt(k.headRos, 1) : '—'} m/min</b>
            </p>
          </section>

          <section>
            <h4>Elliptical kernel (Anderson 1983)</h4>
            <p className="lab-formula">L/B = 1 + 0.8·U · ε = √(1 − 1/(L/B)²)</p>
            <p>
              L/B = <b>{k ? fmt(k.lengthToBreadth, 2) : '—'}</b> · ε ={' '}
              <b>{k ? fmt(k.eccentricity, 3) : '—'}</b>
            </p>
            <p className="lab-formula">R(θ) = R_h·(1−ε)/(1−ε·cosθ)</p>
            <p>
              R(0°) = <b>{k ? fmt(k.rHead, 1) : '—'}</b> · R(90°) ={' '}
              <b>{k ? fmt(k.rFlank, 2) : '—'}</b> · R(180°) = <b>{k ? fmt(k.rBack, 2) : '—'}</b>{' '}
              m/min
            </p>
          </section>

          <section>
            <h4>Local terrain at the head ⌖</h4>
            <p>
              canyon ×<b>{k ? fmt(k.canyonMult, 2) : '—'}</b> · patchiness ×
              <b>{k ? fmt(k.patchMult, 2) : '—'}</b> → head speed{' '}
              <b>{k ? fmt(k.speedDownwind, 1) : '—'} m/min</b>
            </p>
          </section>

          <section>
            <h4>Minimum travel time (Dijkstra)</h4>
            <p className="lab-formula">T(c) = min over n [ T(n) + Δs / R(θ_nc) ]</p>
            <p>
              {m ? m.totalCells.toLocaleString('en-US') : '—'} cells ·{' '}
              <b>{m ? m.settledCells.toLocaleString('en-US') : '—'}</b> settled ·{' '}
              <b>{m ? fmt(m.dijkstraMs, 1) : '—'} ms</b> per refresh
            </p>
          </section>

          <section>
            <h4>Prediction — next {LAB_CONFIG.horizonMin} minutes</h4>
            <p className="lab-formula">envelope = {'{ c : T(c) ≤ '}{LAB_CONFIG.horizonMin}{' }'}</p>
            <p>
              <b>{m ? fmt(m.predictedHa, 1) : '—'} ha</b> · head reach{' '}
              <b>{m ? Math.round(m.headReachM) : '—'} m</b>
            </p>
          </section>

          <section>
            <h4>Forecast vs reality</h4>
            {m?.lastGrade ? (
              <p>
                forecast @ τ={m.lastGrade.madeAtMin}: hit{' '}
                <b
                  className={
                    m.lastGrade.hitRate < 0.75 ? 'lab-bad' : m.lastGrade.hitRate < 0.92 ? 'lab-mid' : 'lab-good'
                  }
                >
                  {Math.round(m.lastGrade.hitRate * 100)}%
                </b>{' '}
                · missed <b>{m.lastGrade.missedCells}</b> of{' '}
                <b>{m.lastGrade.newlyBurnedCells}</b> cells
              </p>
            ) : (
              <p>first grade arrives at τ = {LAB_CONFIG.horizonMin * 2} min…</p>
            )}
            <p className="lab-note">
              white dashes on the map = the archived forecast; when the wind shifts, reality
              leaves it behind — then the next refresh re-converges.
            </p>
          </section>

          <section>
            <h4>Burned</h4>
            <p>
              τ = <b>{m ? Math.round(m.tauMin) : 0} min</b> ·{' '}
              <b>{m ? fmt(m.burnedHa, 1) : '—'} ha</b> ({m ? m.burnedCells : 0} cells)
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
