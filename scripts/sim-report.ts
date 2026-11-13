/**
 * Quick headless report: runs N game days on a seed with auto-assigned survivors and prints
 * daily stats plus sim cost per tick. Usage: npx tsx scripts/sim-report.ts [seed] [days]
 */
import { newWorld, step, run, TICKS_PER_GAME_DAY, formatClock } from '../src/sim';
import { autoAssign } from '../tests/unit/helpers';
import { storeCapacity, storeUsed } from '../src/sim/core/store';

const seed = process.argv[2] ?? 'ember-07';
const days = Number(process.argv[3] ?? 5);
const w = newWorld(seed);
step(w, autoAssign(w));
const fmt = (n: number | undefined) => (n ?? 0).toFixed(1);
for (let d = 0; d < days; d++) {
  const t0 = performance.now();
  run(w, TICKS_PER_GAME_DAY);
  const ms = (performance.now() - t0) / TICKS_PER_GAME_DAY;
  const st = w.state;
  const temps = st.rooms.map((r) => r.temp);
  console.log(
    `${formatClock(st.tick)} | power ${fmt(st.power.produced)}/${fmt(st.power.demand)} kW shed>=${st.power.shedFrom}` +
      ` | temp ${fmt(Math.min(...temps))}..${fmt(Math.max(...temps))} out ${fmt(st.outsideTemp)}` +
      ` | co2 ${st.co2.toFixed(0)} | water ${fmt(st.store.water)} ice ${fmt(st.store.ice)} meal ${fmt(st.store.meal)} ration ${fmt(st.store.ration)} produce ${fmt(st.store.produce)} filter ${fmt(st.store.filter)}` +
      ` | store ${storeUsed(w).toFixed(0)}/${storeCapacity(w).toFixed(0)} | ${ms.toFixed(4)} ms/tick`,
  );
  console.log(
    '   ' +
      st.survivors
        .map(
          (s) =>
            `${s.name}:${s.action} h${s.needs.hunger!.toFixed(0)} t${s.needs.thirst!.toFixed(0)} s${s.needs.sleep!.toFixed(0)} w${s.needs.warmth!.toFixed(0)} hp${s.health.toFixed(0)}`,
        )
        .join('  '),
  );
}
