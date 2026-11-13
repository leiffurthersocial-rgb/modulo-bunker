import { useState } from 'preact/hooks';
import type {
  TabletActions,
  TabletItem,
  TabletNeed,
  TabletRoom,
  TabletSurvivor,
  TabletView,
} from './tabletTypes';

type TabId = 'survivors' | 'rooms' | 'store' | 'research' | 'log';

const TABS: { id: TabId; label: string }[] = [
  { id: 'survivors', label: 'Survivors' },
  { id: 'rooms', label: 'Rooms' },
  { id: 'store', label: 'Store' },
  { id: 'research', label: 'Research' },
  { id: 'log', label: 'Log' },
];

const ACTION_TEXT: Record<string, string> = {
  idle: 'Idle',
  work: 'Working',
  eat: 'Eating',
  drink: 'Drinking',
  sleep: 'Sleeping',
  warm: 'Warming up',
  relax: 'Relaxing',
  downed: 'Collapsed',
};

const clampPct = (v: number) => Math.max(0, Math.min(100, v));

function Bar(p: { label: string; value: number; cls: string }) {
  return (
    <div class="tb-bar" title={`${p.label}: ${Math.round(p.value)}`}>
      <span class="tb-bar-label">{p.label}</span>
      <span class="tb-bar-track">
        <span class={`tb-bar-fill ${p.cls}`} style={{ width: `${clampPct(p.value)}%` }} />
      </span>
      <span class="tb-bar-val">{Math.round(p.value)}</span>
    </div>
  );
}

const needClass = (n: TabletNeed) => (n.value < n.critical ? 'danger' : n.value < n.low ? 'warn' : 'ok');

function SurvivorCard(p: { s: TabletSurvivor; rooms: TabletRoom[]; actions: TabletActions }) {
  const { s } = p;
  return (
    <div class="tb-card">
      <div class="row">
        <i class="tb-dot" style={{ background: s.color }} />
        <b>{s.name}</b>
        <span class="dim">
          {ACTION_TEXT[s.action] ?? s.action} · floor {s.floor}
        </span>
      </div>
      <Bar label="Health" value={s.health} cls={s.health < 30 ? 'danger' : s.health < 60 ? 'warn' : 'ok'} />
      <Bar label="Stress" value={s.stress} cls={s.stress > 70 ? 'danger' : s.stress > 40 ? 'warn' : 'ok'} />
      {s.needs.map((n) => (
        <Bar key={n.id} label={n.name} value={n.value} cls={needClass(n)} />
      ))}
      <div class="tb-chips">
        {s.skills.map((k) => (
          <span key={k.id} class="tb-chip">
            {k.name} {k.level}
          </span>
        ))}
        {s.traits.map((t) => (
          <span key={t.name} class="tb-chip trait" title={t.description}>
            {t.name}
          </span>
        ))}
      </div>
      <select
        aria-label={`Assign ${s.name}`}
        value={s.assignedRoomId === null ? '' : String(s.assignedRoomId)}
        onChange={(e) => {
          const v = (e.currentTarget as HTMLSelectElement).value;
          p.actions.assign(s.id, v === '' ? null : Number(v));
        }}
      >
        <option value="">Unassigned</option>
        {p.rooms
          .filter((r) => r.capacity > 0)
          .map((r) => {
            const full = r.workers.length >= r.capacity && !r.workers.includes(s.id);
            return (
              <option key={r.id} value={String(r.id)} disabled={full || r.damaged}>
                {`${r.short} T${r.tier} · floor ${r.floor} (${r.workers.length}/${r.capacity})`}
                {r.damaged ? ' (damaged)' : ''}
              </option>
            );
          })}
      </select>
    </div>
  );
}

const powerText = (r: TabletRoom) =>
  r.damaged ? 'damaged' : r.powered >= 0.95 ? 'on' : r.powered > 0.05 ? 'brownout' : 'off';

function RoomRow(p: { r: TabletRoom; actions: TabletActions }) {
  const { r } = p;
  const pw = powerText(r);
  return (
    <div class="tb-room">
      <div class="tb-room-name">
        <i class="tb-dot" style={{ background: r.color }} />
        <b>{r.name}</b>
        <span class="dim">
          T{r.tier}
          {r.width > 1 ? ` x${r.width}` : ''}
        </span>
      </div>
      <span class="dim">Floor {r.floor}</span>
      <span>{r.temp.toFixed(1)} °C</span>
      <span class={`tb-power ${pw}`}>{pw}</span>
      <span>{r.capacity > 0 ? `${r.workers.length}/${r.capacity}` : '—'}</span>
      <div class="tb-prio" role="group" aria-label={`Priority for ${r.name}`}>
        {[1, 2, 3, 4].map((n) => (
          <button
            key={n}
            class={r.priority === n ? 'primary' : ''}
            aria-label={`Priority ${n} for ${r.name}`}
            aria-pressed={r.priority === n}
            onClick={() => p.actions.setPriority(r.id, n)}
          >
            {n}
          </button>
        ))}
      </div>
      <button
        class={r.enabled ? 'primary' : ''}
        aria-pressed={r.enabled}
        onClick={() => p.actions.toggleRoom(r.id, !r.enabled)}
      >
        {r.enabled ? 'On' : 'Off'}
      </button>
    </div>
  );
}

const fmtQty = (q: number) => (q < 10 ? q.toFixed(1) : String(Math.round(q)));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function StoreTab(p: { view: TabletView }) {
  const { view } = p;
  const groups = new Map<string, TabletItem[]>();
  for (const it of view.store) {
    if (it.qty <= 0.05) continue;
    const g = groups.get(it.category);
    if (g) g.push(it);
    else groups.set(it.category, [it]);
  }
  const pct = view.storeCap > 0 ? (view.storeUsed / view.storeCap) * 100 : 0;
  return (
    <div class="col">
      <div>
        <b>
          Storage {Math.round(view.storeUsed)} / {Math.round(view.storeCap)}
        </b>
        <div class="tb-bar-track tb-store-bar">
          <span
            class={`tb-bar-fill ${pct > 95 ? 'danger' : pct > 80 ? 'warn' : 'ok'}`}
            style={{ width: `${clampPct(pct)}%` }}
          />
        </div>
      </div>
      {groups.size === 0 && <span class="dim">The store is empty.</span>}
      {[...groups.entries()].map(([cat, items]) => (
        <div key={cat}>
          <h4 class="tb-cat">{cap(cat)}</h4>
          <div class="tb-items">
            {items.map((it) => (
              <div key={it.id} class="tb-item">
                <i class="tb-dot" style={{ background: it.color }} />
                <span>{it.name}</span>
                <b>{fmtQty(it.qty)}</b>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function Tablet(props: { view: TabletView; actions: TabletActions }) {
  const { view, actions } = props;
  const [tab, setTab] = useState<TabId>('survivors');
  return (
    <div
      class="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) actions.close();
      }}
    >
      <div class="panel tablet" data-testid="tablet" role="dialog" aria-label="Tablet">
        <div class="tb-head">
          <h3>Tablet</h3>
          <button class="close-x" onClick={actions.close} aria-label="Close tablet">
            ✕
          </button>
        </div>
        <div class="tabs">
          {TABS.map((t) => (
            <button key={t.id} class={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <div class="tb-body">
          {tab === 'survivors' && (
            <div class="tb-grid">
              {view.survivors.map((s) => (
                <SurvivorCard key={s.id} s={s} rooms={view.rooms} actions={actions} />
              ))}
            </div>
          )}
          {tab === 'rooms' && (
            <div class="col">
              <span class="dim">
                Priority 1 = critical. In a brownout, priority 4 rooms lose power first.
              </span>
              <div class="tb-rooms">
                {view.rooms.map((r) => (
                  <RoomRow key={r.id} r={r} actions={actions} />
                ))}
              </div>
            </div>
          )}
          {tab === 'store' && <StoreTab view={view} />}
          {tab === 'research' && <p class="dim">Research tree arrives in Phase 2.</p>}
          {tab === 'log' && (
            <p class="dim">The radio is silent. Restore the radio room to start the mystery log (Phase 2).</p>
          )}
        </div>
      </div>
    </div>
  );
}
