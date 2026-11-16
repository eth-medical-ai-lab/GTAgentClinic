import { useState } from 'react';
import type { OrderView } from '../../../../../shared/types';
import { classNames, isActiveOrder } from '../util';
import type { SectionProps } from './common';

const CAT: Record<string, string> = { lab: 'Lab', imaging: 'Imaging', med: 'Med', nursing: 'Nursing', consult: 'Consult', ecg: 'ECG', procedure: 'Proc', supply: 'Supply' };

function paramText(o: OrderView): string {
  const x = o.params;
  if (!x) return '';
  return [x.dose, x.route, x.frequency].filter(Boolean).join(' · ') + (x.question ? ` — “${x.question}”` : '') + (x.comment ? ` — ${x.comment}` : '');
}

export function Orders(p: SectionProps) {
  const { chart, fmt } = p;
  const [filter, setFilter] = useState<'active' | 'all' | 'done'>('active');
  const [confirm, setConfirm] = useState<OrderView | null>(null);
  const sorted = [...chart.orders].sort((a, b) => b.placedAt - a.placedAt);
  const shown = sorted.filter((o) => (filter === 'all' ? true : filter === 'active' ? isActiveOrder(o) : !isActiveOrder(o)));
  const total = chart.orders.filter((o) => o.status !== 'Canceled').reduce((s, o) => s + o.costUSD, 0);

  return (
    <div className="ehr-stack">
      <div className="ehr-toolbar">
        <button className="ehr-btn primary" onClick={() => p.openOrderEntry()}>
          + New order
        </button>
        <div className="ehr-seg">
          {(['active', 'done', 'all'] as const).map((f) => (
            <button key={f} className={classNames('ehr-seg-b', filter === f && 'on')} onClick={() => setFilter(f)}>
              {f === 'active' ? `Active (${chart.orders.filter(isActiveOrder).length})` : f === 'done' ? 'Completed / canceled' : `All (${chart.orders.length})`}
            </button>
          ))}
        </div>
        <span className="ehr-dim">Encounter charges so far: ${total.toLocaleString()}</span>
      </div>
      <div className="ehr-card">
        {shown.length === 0 ? (
          <div className="ehr-empty big">No {filter === 'active' ? 'active ' : ''}orders.</div>
        ) : (
          <table className="ehr-table">
            <thead>
              <tr>
                <th>Placed</th>
                <th>Order</th>
                <th>Type</th>
                <th>Priority</th>
                <th>Status</th>
                <th>By</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((o) => (
                <tr key={o.id} className={o.status === 'Canceled' ? 'ehr-canceled' : ''}>
                  <td className="ehr-nowrap">{fmt(o.placedAt)}</td>
                  <td>
                    <b>{o.name}</b>
                    {paramText(o) && <div className="ehr-dim ehr-small">{paramText(o)}</div>}
                  </td>
                  <td>
                    <span className={`ehr-cat ehr-cat-${o.category}`}>{CAT[o.category] ?? o.category}</span>
                  </td>
                  <td>
                    <span className={`ehr-pri ${o.priority === 'STAT' ? 'stat' : ''}`}>{o.priority}</span>
                  </td>
                  <td>
                    <span className={`ehr-status s-${o.status.replace(/\s+/g, '-').toLowerCase()}`}>{o.status}</span>
                    {o.statusText && <div className="ehr-dim ehr-small">{o.statusText}</div>}
                    {o.collectedAt !== undefined && o.category === 'lab' && <div className="ehr-dim ehr-small">collected {fmt(o.collectedAt)}</div>}
                    {o.resultedAt !== undefined && <div className="ehr-dim ehr-small">resulted {fmt(o.resultedAt)}</div>}
                    {o.completedAt !== undefined && <div className="ehr-dim ehr-small">completed {fmt(o.completedAt)}</div>}
                  </td>
                  <td className="ehr-small">{o.placedBy}</td>
                  <td>
                    {isActiveOrder(o) && (
                      <button className="ehr-btn small" onClick={() => setConfirm(o)}>
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {confirm && (
        <div className="ehr-modal-back" onMouseDown={(e) => e.target === e.currentTarget && setConfirm(null)}>
          <div className="ehr-dialog">
            <div className="ehr-dialog-h">Cancel order?</div>
            <p>
              <b>{confirm.name}</b> ({confirm.status}) placed at {fmt(confirm.placedAt)}.
            </p>
            <div className="ehr-dialog-actions">
              <button className="ehr-btn" onClick={() => setConfirm(null)}>
                Keep order
              </button>
              <button
                className="ehr-btn danger"
                onClick={async () => {
                  const o = confirm;
                  setConfirm(null);
                  await p.act({ type: 'cancel_order', orderId: o.id }, `Canceled: ${o.name}`);
                }}
              >
                Cancel order
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function Mar(p: SectionProps) {
  const { chart, fmt } = p;
  const entries = [...chart.mar].sort((a, b) => b.t - a.t);
  const pendingMeds = chart.orders.filter((o) => o.category === 'med' && isActiveOrder(o));
  return (
    <div className="ehr-stack">
      <div className="ehr-card">
        <div className="ehr-card-h">
          Medications due / pending administration <span className="ehr-badge">{pendingMeds.length}</span>
        </div>
        {pendingMeds.length ? (
          <table className="ehr-table compact">
            <tbody>
              {pendingMeds.map((o) => (
                <tr key={o.id}>
                  <td className="ehr-nowrap">{fmt(o.placedAt)}</td>
                  <td>
                    <b>{o.name}</b> <span className="ehr-dim">{paramText(o)}</span>
                  </td>
                  <td>
                    <span className={`ehr-status s-${o.status.replace(/\s+/g, '-').toLowerCase()}`}>{o.status}</span>
                    {o.statusText && <span className="ehr-dim ehr-small"> {o.statusText}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="ehr-empty">No medications pending.</div>
        )}
      </div>
      <div className="ehr-card">
        <div className="ehr-card-h">Medication administration record</div>
        {entries.length ? (
          <table className="ehr-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Medication</th>
                <th>Dose</th>
                <th>Route</th>
                <th>Action</th>
                <th>By</th>
                <th>Comment</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((m) => (
                <tr key={m.id}>
                  <td className="ehr-nowrap">{fmt(m.t)}</td>
                  <td>
                    <b>{m.med}</b>
                  </td>
                  <td>{m.dose}</td>
                  <td>{m.route}</td>
                  <td>
                    <span className={`ehr-status s-${m.status.toLowerCase()}`}>{m.status}</span>
                  </td>
                  <td className="ehr-small">{m.by}</td>
                  <td className="ehr-small">{m.comment ?? (m.orderId ? '' : <span className="ehr-warn-inline">no linked order</span>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="ehr-empty">No medications administered this encounter.</div>
        )}
      </div>
    </div>
  );
}
