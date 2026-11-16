/**
 * Order entry with a pending-orders cart and realistic clinical decision support:
 * allergy hard stops (override reason required), cross-reactivity warnings,
 * high-alert medication confirmation, duplicate-order checks and a pregnancy
 * prompt before ionizing-radiation imaging in women of reproductive age.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ORDERS, ORDER_SETS, searchOrders } from '../../../../shared/catalog';
import type { OrderDef, OrderParams, PatientChart, Priority } from '../../../../shared/types';
import { PENICILLIN_WORDS, allergyList, classNames, hasAllergyTo, isActiveOrder, weightDoseHint } from './util';

export interface CartItem {
  key: string;
  code: string;
  name: string;
  params?: OrderParams;
  priority: Priority;
  notes: string[];
  error?: string;
}

interface Alert {
  kind: 'hard' | 'soft' | 'confirm' | 'preg';
  title: string;
  body: string;
}

interface Pending {
  item: CartItem;
  alerts: Alert[];
}

export interface OrderEntryProps {
  chart: PatientChart;
  onSign: (items: CartItem[]) => Promise<{ failed: { key: string; message: string }[] }>;
  onClose: () => void;
  initialSet?: string;
}

const CAT_LABEL: Record<string, string> = {
  lab: 'Lab',
  imaging: 'Imaging',
  med: 'Medication',
  nursing: 'Nursing',
  consult: 'Consult',
  ecg: 'ECG',
  procedure: 'Procedure',
  supply: 'Supply',
};

const OVERRIDE_REASONS = [
  'Benefit outweighs risk',
  'Low-risk allergy history (remote, non-severe)',
  'Patient has tolerated this medication before',
  'Allergy reviewed with pharmacy',
  'Desensitization / graded challenge planned',
];

let keySeq = 0;

function defaultParams(def: OrderDef): OrderParams {
  if (def.med) return { dose: def.med.doses[0], route: def.med.routes[0], frequency: def.med.frequencies[0] };
  return {};
}

function describe(def: OrderDef, params?: OrderParams): string {
  if (def.med && params) return [params.dose, params.route, params.frequency].filter(Boolean).join(' · ');
  if (def.category === 'lab') return `${def.specimen ?? 'Blood'}${def.tatMin ? ` · TAT ~${def.tatMin[0] >= 600 ? Math.round(def.tatMin[0] / 60) + ' h' : def.tatMin[0] + '–' + def.tatMin[1] + ' min'}` : ''}`;
  if (def.category === 'imaging') return `${def.modality}${def.contrast ? ' · IV contrast' : ''}`;
  return CAT_LABEL[def.category] ?? def.category;
}

export function OrderEntry({ chart, onSign, onClose, initialSet }: OrderEntryProps) {
  const [tab, setTab] = useState<'search' | 'sets'>(initialSet ? 'sets' : 'search');
  const [query, setQuery] = useState('');
  const [hi, setHi] = useState(0);
  const [selected, setSelected] = useState<OrderDef | null>(null);
  const [params, setParams] = useState<OrderParams>({});
  const [priority, setPriority] = useState<Priority>('STAT');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [queue, setQueue] = useState<Pending[]>([]);
  const [overrideReason, setOverrideReason] = useState('');
  const [addPreg, setAddPreg] = useState(true);
  const [ack, setAck] = useState(false);
  const [setCode, setSetCode] = useState<string>(initialSet ?? ORDER_SETS[0].code);
  const [setChecks, setSetChecks] = useState<Record<string, boolean>>({});
  const [signing, setSigning] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const commentRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => searchOrders(query, 30), [query]);
  const activeSet = ORDER_SETS.find((s) => s.code === setCode) ?? ORDER_SETS[0];

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // keyboard flow: after picking an orderable, focus the field that needs input (or the Add button)
  useEffect(() => {
    if (!selected) return;
    const id = setTimeout(() => (selected.category === 'imaging' ? commentRef.current : addRef.current)?.focus(), 0);
    return () => clearTimeout(id);
  }, [selected?.code]);

  useEffect(() => {
    const init: Record<string, boolean> = {};
    activeSet.items.forEach((it, i) => (init[`${it.code}#${i}`] = it.defaultChecked));
    setSetChecks(init);
  }, [setCode]);

  const choose = (def: OrderDef) => {
    setSelected(def);
    setParams(defaultParams(def));
    setPriority('STAT');
    setComposerError(null);
  };

  const isFemaleReproductive = chart.sex === 'F' && chart.age >= 12 && chart.age <= 55;
  const hasPregTest = (pendingCart: CartItem[]) =>
    chart.orders.some((o) => (o.code === 'hcg_u' || o.code === 'hcg_q') && o.status !== 'Canceled') || pendingCart.some((c) => c.code === 'hcg_u' || c.code === 'hcg_q');

  function alertsFor(item: CartItem, pendingCart: CartItem[]): Alert[] {
    const def = ORDERS[item.code];
    const alerts: Alert[] = [];
    if (!def) return alerts;
    const med = def.med;
    const allergies = Array.isArray(chart.allergies) ? chart.allergies : [];
    const pcnAllergy = hasAllergyTo(chart, PENICILLIN_WORDS);
    if (med) {
      const groups = med.allergyGroups ?? [];
      if (groups.includes('penicillin') && pcnAllergy) {
        const a = allergies.find((x) => PENICILLIN_WORDS.some((w) => `${x.substance} ${x.reaction}`.toLowerCase().includes(w)));
        alerts.push({
          kind: 'hard',
          title: 'ALLERGY — HARD STOP',
          body: `Documented allergy: ${a ? `${a.substance} (${a.reaction})` : 'Penicillin'}. ${def.name} is a penicillin-class antibiotic (${med.drugClass}). An override reason is required.`,
        });
      } else {
        const direct = allergies.find((x) => {
          const s = x.substance.toLowerCase();
          return s.length > 2 && (med.generic.toLowerCase().includes(s) || groups.some((g) => s.includes(g) || g.includes(s)));
        });
        if (direct)
          alerts.push({
            kind: 'hard',
            title: 'ALLERGY — HARD STOP',
            body: `Documented allergy: ${direct.substance} (${direct.reaction}). ${def.name} matches this allergy class. An override reason is required.`,
          });
      }
      if (pcnAllergy && (groups.includes('cephalosporin') || groups.includes('carbapenem'))) {
        const pct = groups.includes('carbapenem') ? '<1%' : '~1–2% (lower for 3rd/4th generation)';
        alerts.push({
          kind: 'soft',
          title: 'Possible cross-sensitivity',
          body: `Penicillin allergy on file. Cross-reactivity with ${groups.includes('carbapenem') ? 'carbapenems' : 'cephalosporins'} is ${pct}. Review the reaction history before ordering.`,
        });
      }
      if (med.highAlert)
        alerts.push({
          kind: 'confirm',
          title: 'High-alert medication',
          body: `${def.name} (${item.params?.dose ?? ''}) is on the high-alert list. Nursing will perform an independent double-check. Confirm the dose and indication.`,
        });
    }
    const existing = chart.orders.find((o) => o.code === item.code && isActiveOrder(o));
    const inCart = pendingCart.find((c) => c.code === item.code);
    if (existing)
      alerts.push({
        kind: 'soft',
        title: 'Duplicate order',
        body: `${def.name} is already active on this patient (status: ${existing.status}${existing.statusText ? ' — ' + existing.statusText : ''}).`,
      });
    else if (inCart) alerts.push({ kind: 'soft', title: 'Duplicate order', body: `${def.name} is already in your pending orders.` });
    if (def.category === 'imaging' && (def.modality === 'CT' || def.modality === 'XR') && isFemaleReproductive && !hasPregTest(pendingCart))
      alerts.push({
        kind: 'preg',
        title: 'Pregnancy status unknown',
        body: `${chart.firstName} is a ${chart.age}-year-old woman. No pregnancy test is on file or pending. Imaging with ionizing radiation${def.contrast ? ' and IV contrast' : ''} usually requires a documented pregnancy test.`,
      });
    return alerts;
  }

  const enqueue = (items: CartItem[]) => {
    let simulatedCart = [...cart];
    const direct: CartItem[] = [];
    const pend: Pending[] = [];
    for (const it of items) {
      const alerts = alertsFor(it, simulatedCart);
      if (alerts.length) pend.push({ item: it, alerts });
      else direct.push(it);
      simulatedCart = [...simulatedCart, it];
    }
    if (direct.length) setCart((c) => [...c, ...direct]);
    if (pend.length) {
      setQueue((q) => [...q, ...pend]);
      setOverrideReason('');
      setAddPreg(true);
      setAck(false);
    }
  };

  const addSelected = () => {
    if (!selected) return;
    if (selected.category === 'imaging' && !(params.comment && params.comment.trim().length >= 3)) {
      setComposerError('Reason for exam is required by Radiology.');
      return;
    }
    const item: CartItem = { key: `k${++keySeq}`, code: selected.code, name: selected.name, params: { ...params }, priority, notes: [] };
    enqueue([item]);
    setSelected(null);
    setQuery('');
    setHi(0);
    searchRef.current?.focus();
  };

  const addSetItems = () => {
    const items: CartItem[] = [];
    activeSet.items.forEach((it, i) => {
      if (!setChecks[`${it.code}#${i}`]) return;
      const def = ORDERS[it.code];
      if (!def) return;
      const p: OrderParams = { ...defaultParams(def), ...(it.params ?? {}) };
      if (def.category === 'imaging' && !p.comment) p.comment = `Order set: ${activeSet.name}`;
      items.push({ key: `k${++keySeq}`, code: it.code, name: def.name, params: p, priority: 'STAT', notes: [`from ${activeSet.name}`] });
    });
    enqueue(items);
  };

  const current = queue[0];
  const resolveCurrent = (accept: boolean) => {
    if (!current) return;
    if (accept) {
      const hard = current.alerts.some((a) => a.kind === 'hard');
      const preg = current.alerts.some((a) => a.kind === 'preg');
      const item = { ...current.item, params: { ...(current.item.params ?? {}) }, notes: [...current.item.notes] };
      if (hard) item.params!.comment = [item.params!.comment, `Allergy override — ${overrideReason}`].filter(Boolean).join('; ');
      const add: CartItem[] = [item];
      if (preg && addPreg && !hasPregTest(cart)) {
        const def = ORDERS['hcg_u'];
        add.unshift({ key: `k${++keySeq}`, code: 'hcg_u', name: def.name, params: {}, priority: 'STAT', notes: ['added by pregnancy check'] });
      }
      setCart((c) => [...c, ...add]);
    }
    setQueue((q) => q.slice(1));
    setOverrideReason('');
    setAddPreg(true);
    setAck(false);
  };

  const sign = async () => {
    if (!cart.length || signing) return;
    setSigning(true);
    const res = await onSign(cart);
    setSigning(false);
    if (res.failed.length === 0) {
      setCart([]);
      onClose();
    } else {
      const failed = new Map(res.failed.map((f) => [f.key, f.message]));
      setCart((c) => c.filter((x) => failed.has(x.key)).map((x) => ({ ...x, error: failed.get(x.key) })));
    }
  };

  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHi((h) => Math.min(results.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHi((h) => Math.max(0, h - 1));
    } else if (e.key === 'Enter' && results[hi]) {
      e.preventDefault();
      choose(results[hi]);
    }
  };

  const onComposerKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      addSelected();
    }
  };

  const total = cart.reduce((s, c) => s + (ORDERS[c.code]?.costUSD ?? 0), 0);
  const hardInCurrent = current?.alerts.some((a) => a.kind === 'hard');
  const confirmInCurrent = current?.alerts.some((a) => a.kind === 'confirm');
  const canAccept = !current || ((!hardInCurrent || overrideReason) && (!confirmInCurrent || ack));
  const allergies = allergyList(chart);

  return (
    <div className="ehr-modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ehr-oe" onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onClose())}>
        <div className="ehr-oe-head">
          <div>
            <div className="ehr-oe-title">Order entry</div>
            <div className="ehr-oe-sub">
              {chart.name} · {chart.age} y {chart.sex} · {chart.weightKg} kg · MRN {chart.mrn} ·{' '}
              <span className={allergies.length ? 'ehr-allergy-inline' : ''}>
                Allergies: {Array.isArray(chart.allergies) ? (chart.allergies.length ? chart.allergies.map((a) => a.substance).join(', ') : 'NKDA') : chart.allergies}
              </span>
            </div>
          </div>
          <button className="ehr-x" onClick={onClose} title="Close">
            ✕
          </button>
        </div>
        <div className="ehr-oe-body">
          <div className="ehr-oe-left">
            <div className="ehr-tabs">
              <button className={classNames('ehr-tab', tab === 'search' && 'on')} onClick={() => setTab('search')}>
                Search orders
              </button>
              <button className={classNames('ehr-tab', tab === 'sets' && 'on')} onClick={() => setTab('sets')}>
                Order sets
              </button>
            </div>
            {tab === 'search' && (
              <>
                <input
                  ref={searchRef}
                  className="ehr-input ehr-oe-search"
                  placeholder="Search labs, imaging, meds, nursing, consults…  (e.g. lact, ctx, cxr, zosyn)"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setHi(0);
                  }}
                  onKeyDown={onSearchKey}
                />
                <div className="ehr-oe-results">
                  {query && results.length === 0 && <div className="ehr-empty">No orderables match “{query}”.</div>}
                  {!query && <div className="ehr-empty">Start typing to search the order catalog. Use ↑ ↓ and Enter.</div>}
                  {results.map((o, i) => (
                    <button key={o.code} className={classNames('ehr-oe-res', i === hi && 'hi', selected?.code === o.code && 'sel')} onMouseEnter={() => setHi(i)} onClick={() => choose(o)}>
                      <span className={`ehr-cat ehr-cat-${o.category}`}>{CAT_LABEL[o.category]}</span>
                      <span className="ehr-oe-res-name">{o.name}</span>
                      <span className="ehr-oe-res-meta">{describe(o, defaultParams(o))}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {tab === 'sets' && (
              <div className="ehr-oe-sets">
                <select className="ehr-input" value={setCode} onChange={(e) => setSetCode(e.target.value)}>
                  {ORDER_SETS.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <div className="ehr-oe-setlist">
                  {activeSet.items.map((it, i) => {
                    const def = ORDERS[it.code];
                    if (!def) return null;
                    const k = `${it.code}#${i}`;
                    const p = { ...defaultParams(def), ...(it.params ?? {}) };
                    return (
                      <label key={k} className="ehr-oe-setitem">
                        <input type="checkbox" checked={!!setChecks[k]} onChange={(e) => setSetChecks((c) => ({ ...c, [k]: e.target.checked }))} />
                        <span className={`ehr-cat ehr-cat-${def.category}`}>{CAT_LABEL[def.category]}</span>
                        <span className="ehr-oe-res-name">{def.name}</span>
                        <span className="ehr-oe-res-meta">{describe(def, p)}</span>
                      </label>
                    );
                  })}
                </div>
                <button className="ehr-btn primary" onClick={addSetItems}>
                  Add selected to pending orders
                </button>
                <div className="ehr-hint">Order sets are convenient — but every checked item counts toward cost and stewardship.</div>
              </div>
            )}
          </div>

          <div className="ehr-oe-mid" onKeyDown={onComposerKey}>
            {!selected && <div className="ehr-empty ehr-oe-placeholder">Select an orderable to configure it.</div>}
            {selected && (
              <div className="ehr-composer">
                <div className="ehr-composer-title">
                  <span className={`ehr-cat ehr-cat-${selected.category}`}>{CAT_LABEL[selected.category]}</span> {selected.name}
                </div>
                {selected.description && <div className="ehr-info">{selected.description}</div>}
                {selected.med && (
                  <>
                    <div className="ehr-kv">
                      <span>Class</span>
                      <b>{selected.med.drugClass}</b>
                    </div>
                    <label className="ehr-field">
                      <span>Dose</span>
                      <select className="ehr-input" value={params.dose} onChange={(e) => setParams((p) => ({ ...p, dose: e.target.value }))}>
                        {selected.med.doses.map((d) => (
                          <option key={d}>{d}</option>
                        ))}
                      </select>
                    </label>
                    {weightDoseHint(params.dose, chart.weightKg) && <div className="ehr-hint">{weightDoseHint(params.dose, chart.weightKg)}</div>}
                    <label className="ehr-field">
                      <span>Route</span>
                      <select className="ehr-input" value={params.route} onChange={(e) => setParams((p) => ({ ...p, route: e.target.value }))}>
                        {selected.med.routes.map((d) => (
                          <option key={d}>{d}</option>
                        ))}
                      </select>
                    </label>
                    <label className="ehr-field">
                      <span>Frequency</span>
                      <select className="ehr-input" value={params.frequency} onChange={(e) => setParams((p) => ({ ...p, frequency: e.target.value }))}>
                        {selected.med.frequencies.map((d) => (
                          <option key={d}>{d}</option>
                        ))}
                      </select>
                    </label>
                    {selected.med.highAlert && <div className="ehr-warn-inline">⚠ High-alert medication</div>}
                  </>
                )}
                {selected.category === 'lab' && (
                  <div className="ehr-kv-block">
                    <div className="ehr-kv">
                      <span>Specimen</span>
                      <b>{selected.specimen ?? 'Blood'}</b>
                    </div>
                    <div className="ehr-kv">
                      <span>Expected TAT</span>
                      <b>{selected.tatMin ? (selected.tatMin[0] >= 600 ? `${Math.round(selected.tatMin[0] / 60)}–${Math.round(selected.tatMin[1] / 60)} h` : `${selected.tatMin[0]}–${selected.tatMin[1]} min`) : '—'}</b>
                    </div>
                    <div className="ehr-kv">
                      <span>Components</span>
                      <b>{selected.analytes?.length ?? 0}</b>
                    </div>
                  </div>
                )}
                {selected.category === 'imaging' && (
                  <div className="ehr-kv-block">
                    <div className="ehr-kv">
                      <span>Modality</span>
                      <b>
                        {selected.modality}
                        {selected.contrast ? ' with IV contrast' : ''}
                      </b>
                    </div>
                  </div>
                )}
                {selected.category === 'consult' && (
                  <label className="ehr-field">
                    <span>Question for consultant</span>
                    <input className="ehr-input" value={params.question ?? ''} onChange={(e) => setParams((p) => ({ ...p, question: e.target.value }))} placeholder="e.g. Inferior STEMI — please evaluate for emergent PCI" />
                  </label>
                )}
                {selected.category === 'consult' && <div className="ehr-hint">Consults are not real until you talk: call the consultant from a phone after signing.</div>}
                <div className="ehr-field">
                  <span>Priority</span>
                  <div className="ehr-seg">
                    {(['STAT', 'Routine'] as Priority[]).map((p) => (
                      <button key={p} className={classNames('ehr-seg-b', priority === p && 'on')} onClick={() => setPriority(p)}>
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="ehr-field">
                  <span>{selected.category === 'imaging' ? 'Reason for exam *' : 'Comment'}</span>
                  <input
                    ref={commentRef}
                    className="ehr-input"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
                        e.preventDefault();
                        addSelected();
                      }
                    }}
                    value={params.comment ?? ''}
                    onChange={(e) => {
                      setParams((p) => ({ ...p, comment: e.target.value }));
                      setComposerError(null);
                    }}
                    placeholder={selected.category === 'imaging' ? 'e.g. RLQ pain, fever — r/o appendicitis' : 'Optional'}
                  />
                </label>
                {composerError && <div className="ehr-error">{composerError}</div>}
                <div className="ehr-composer-foot">
                  <span className="ehr-dim">~${selected.costUSD} charge</span>
                  <button className="ehr-btn" onClick={() => setSelected(null)}>
                    Discard
                  </button>
                  <button ref={addRef} className="ehr-btn primary" onClick={addSelected} title="Enter / Ctrl+Enter">
                    Add to pending
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="ehr-oe-cart">
            <div className="ehr-oe-cart-head">
              Pending orders <span className="ehr-badge">{cart.length}</span>
            </div>
            <div className="ehr-oe-cart-list">
              {cart.length === 0 && <div className="ehr-empty">Nothing pending. Add orders on the left.</div>}
              {cart.map((c) => {
                const def = ORDERS[c.code];
                return (
                  <div key={c.key} className={classNames('ehr-oe-cart-item', c.error && 'err')}>
                    <div className="ehr-oe-cart-name">
                      <span className={`ehr-pri ${c.priority === 'STAT' ? 'stat' : ''}`}>{c.priority}</span> {c.name}
                    </div>
                    {def && <div className="ehr-oe-cart-meta">{describe(def, c.params)}</div>}
                    {c.params?.comment && <div className={c.params.comment.includes('Allergy override') ? 'ehr-oe-cart-note' : 'ehr-oe-cart-meta'}>“{c.params.comment}”</div>}
                    {c.notes.map((n, i) => (
                      <div key={i} className="ehr-oe-cart-note">
                        {n}
                      </div>
                    ))}
                    {c.error && <div className="ehr-error">{c.error}</div>}
                    <button className="ehr-oe-remove" onClick={() => setCart((x) => x.filter((y) => y.key !== c.key))} title="Remove">
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="ehr-oe-cart-foot">
              <div className="ehr-dim">Estimated charges: ${total.toLocaleString()}</div>
              <button className="ehr-btn sign" disabled={!cart.length || signing || !!current} onClick={sign}>
                {signing ? 'Signing…' : `Sign orders (${cart.length})`}
              </button>
            </div>
          </div>
        </div>

        {current && (
          <div className="ehr-cds-back">
            <div className={classNames('ehr-cds', hardInCurrent && 'hard')}>
              <div className="ehr-cds-head">
                <span className="ehr-cds-icon">{hardInCurrent ? '⛔' : '⚠'}</span>
                <div>
                  <div className="ehr-cds-title">Clinical decision support</div>
                  <div className="ehr-cds-order">{current.item.name}</div>
                </div>
                {queue.length > 1 && <span className="ehr-cds-count">{queue.length - 1} more alert(s) queued</span>}
              </div>
              {current.alerts.map((a, i) => (
                <div key={i} className={`ehr-cds-alert ${a.kind}`}>
                  <div className="ehr-cds-alert-title">{a.title}</div>
                  <div>{a.body}</div>
                  {a.kind === 'preg' && (
                    <label className="ehr-check">
                      <input type="checkbox" checked={addPreg} onChange={(e) => setAddPreg(e.target.checked)} /> Add “Pregnancy test, urine (POC)” to pending orders
                    </label>
                  )}
                  {a.kind === 'confirm' && (
                    <label className="ehr-check">
                      <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I have verified dose, route and indication
                    </label>
                  )}
                </div>
              ))}
              {hardInCurrent && (
                <label className="ehr-field">
                  <span>Override reason (required)</span>
                  <select className="ehr-input" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)}>
                    <option value="">— select —</option>
                    {OVERRIDE_REASONS.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </label>
              )}
              <div className="ehr-cds-actions">
                <button className="ehr-btn" onClick={() => resolveCurrent(false)}>
                  Remove order
                </button>
                <button className={classNames('ehr-btn', hardInCurrent ? 'danger' : 'primary')} disabled={!canAccept} onClick={() => resolveCurrent(true)}>
                  {hardInCurrent ? 'Override and keep' : 'Accept and keep'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
