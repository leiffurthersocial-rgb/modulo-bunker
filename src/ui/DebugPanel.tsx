import { useEffect, useRef, useState } from 'preact/hooks';
import { ui, useStore } from './store';
import type { Sample } from '../app/metrics';
import { SERIES } from '../app/metrics';

export interface DebugStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  simMsPerTick: number;
  tick: number;
  entities: string;
  heapMb: number | null;
}

/** Draws each series normalized to its own min/max (labels show the current value). */
function Graphs({ samples }: { samples: Sample[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    const W = c.width;
    const rowH = 34;
    ctx.clearRect(0, 0, W, c.height);
    ctx.font = '11px ui-monospace, monospace';
    SERIES.forEach((s, i) => {
      const y0 = i * rowH;
      const vals = samples.map((p) => p[s.key] as number);
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(0, y0, W, rowH - 4);
      if (vals.length > 1) {
        let lo = Math.min(...vals);
        let hi = Math.max(...vals);
        if (hi - lo < 1e-6) {
          hi += 1;
          lo -= 1;
        }
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        vals.forEach((v, k) => {
          const x = (k / (vals.length - 1)) * W;
          const y = y0 + (rowH - 6) - ((v - lo) / (hi - lo)) * (rowH - 10);
          if (k === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }
      ctx.fillStyle = s.color;
      const last = vals.length ? vals[vals.length - 1]!.toFixed(1) : '-';
      ctx.fillText(`${s.label}: ${last}`, 4, y0 + 12);
    });
  }, [samples]);
  return <canvas ref={ref} width={300} height={SERIES.length * 34} class="graphs" />;
}

export function DebugPanel(props: { run(cmd: string): string; samples: () => Sample[] }) {
  const stats = useStore(ui, (s) => s.debug);
  const [log, setLog] = useState<string[]>(['Type "help" for commands.']);
  const [cmd, setCmd] = useState('');
  if (!stats) return null;
  const submit = (e: Event) => {
    e.preventDefault();
    if (!cmd.trim()) return;
    const out = props.run(cmd.trim());
    setLog([...log.slice(-8), `> ${cmd}`, out]);
    setCmd('');
  };
  return (
    <div class="debug panel" data-testid="debug-panel">
      <div class="dbg-stats">
        <div>
          FPS <b>{stats.fps.toFixed(0)}</b> · frame {stats.frameMs.toFixed(1)} ms
        </div>
        <div>
          draws {stats.drawCalls} · tris {(stats.triangles / 1000).toFixed(1)}k · geo {stats.geometries} · tex{' '}
          {stats.textures}
        </div>
        <div>
          sim {stats.simMsPerTick.toFixed(3)} ms/tick · tick {stats.tick}
          {stats.heapMb !== null && ` · heap ${stats.heapMb.toFixed(0)} MB`}
        </div>
        <div class="dim">{stats.entities}</div>
      </div>
      <Graphs samples={props.samples().slice()} />
      <div class="console">
        {log.map((l, i) => (
          <div key={i} class={l.startsWith('>') ? 'dim' : ''}>
            {l}
          </div>
        ))}
        <form onSubmit={submit}>
          <input
            aria-label="Debug console"
            value={cmd}
            onInput={(e) => setCmd((e.target as HTMLInputElement).value)}
            placeholder="give scrap 100"
          />
        </form>
      </div>
    </div>
  );
}
