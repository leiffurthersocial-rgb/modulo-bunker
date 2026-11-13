import { ui, useStore } from './store';

export interface ResourceView {
  clock: string;
  speed: number;
  effective: number;
  power: { produced: number; demand: number; shed: number };
  heat: { min: number; avg: number; outside: number };
  co2: number;
  co2Bad: number;
  water: number;
  waterTrend: number | null;
  food: number;
  foodTrend: number | null;
  store: { used: number; cap: number };
  overlay: string;
}

const SPEEDS = [0, 1, 4, 10, 100];

function trend(t: number | null, unit = '/h') {
  if (t === null || Math.abs(t) < 0.05) return <span class="trend">·</span>;
  return (
    <span class={`trend ${t > 0 ? 'up' : 'down'}`}>
      {t > 0 ? '▲' : '▼'} {Math.abs(t).toFixed(1)}
      {unit}
    </span>
  );
}

export function ResourceBar(props: { setSpeed(s: number): void; cycleOverlay(): void; openTablet(): void }) {
  const r = useStore(ui, (s) => s.resources);
  if (!r) return null;
  const powerState = r.power.shed < 5 ? 'bad' : r.power.produced - r.power.demand < 4 ? 'warn' : 'ok';
  const heatState = r.heat.min < 5 ? 'bad' : r.heat.min < 12 ? 'warn' : 'ok';
  const airState = r.co2 > r.co2Bad ? 'bad' : r.co2 > r.co2Bad * 0.6 ? 'warn' : 'ok';
  const waterState = r.water < 8 ? 'bad' : r.water < 20 ? 'warn' : 'ok';
  const foodState = r.food < 4 ? 'bad' : r.food < 12 ? 'warn' : 'ok';
  return (
    <div class="resbar" data-testid="resource-bar">
      <div class={`res ${powerState}`} title="Power: produced / demand">
        <b>⚡</b> {r.power.produced.toFixed(0)}/{r.power.demand.toFixed(0)} kW
        {r.power.shed < 5 && <span class="tag">shed P{r.power.shed}+</span>}
      </div>
      <div class={`res ${heatState}`} title="Coldest room / average / outside">
        <b>🌡</b> {r.heat.min.toFixed(0)}°{' '}
        <span class="dim">
          avg {r.heat.avg.toFixed(0)}° · out {r.heat.outside.toFixed(0)}°
        </span>
      </div>
      <div class={`res ${airState}`} title="CO2 (ppm)">
        <b>💨</b> {r.co2.toFixed(0)} ppm
      </div>
      <div class={`res ${waterState}`} title="Drinkable water (L)">
        <b>💧</b> {r.water.toFixed(0)} L {trend(r.waterTrend)}
      </div>
      <div class={`res ${foodState}`} title="Food portions (meals + rations + produce)">
        <b>🍲</b> {r.food.toFixed(0)} {trend(r.foodTrend)}
      </div>
      <div class="res dim" title="Store used / capacity">
        📦 {r.store.used.toFixed(0)}/{r.store.cap.toFixed(0)}
      </div>
      <div class="spacer" />
      <div class="clock">{r.clock}</div>
      <div class="speeds">
        {SPEEDS.map((s) => (
          <button key={s} class={r.speed === s ? 'on' : ''} onClick={() => props.setSpeed(s)}>
            {s === 0 ? '❚❚' : `x${s}`}
          </button>
        ))}
        {r.speed > 0 && r.effective < r.speed * 0.9 && (
          <span class="tag">running x{r.effective.toFixed(0)}</span>
        )}
      </div>
      <button class="ov" onClick={props.cycleOverlay} title="Overlay (O)">
        {r.overlay === 'none' ? 'Overlay' : r.overlay}
      </button>
      <button onClick={props.openTablet} title="Tablet (T)">
        Tablet
      </button>
    </div>
  );
}
