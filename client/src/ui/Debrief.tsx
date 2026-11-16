import { useState } from 'react';
import { clockAt, DISPO_LABELS, type CaseDebrief, type InfectionControlDebrief, type Vitals } from '../../../shared/types';
import { formatBP, map as mapOf } from '../../../shared/units';
import { client } from '../net';
import { store, useStore } from '../store';
import { level } from '../../../shared/saveGame';
import { rememberRotation } from '../rotation';
import { savedNpcSelection } from './LlmSources';
import { DebriefUsage } from './Usage';

export function Debrief() {
  const solo = useStore(s => s.solo);
  const savedGame = useStore(s => s.lastSave);
  const rotation = useStore(s => s.rotation);
  const d = useStore((s) => s.debrief);
  const view = useStore((s) => s.view);
  // observe mode: the debrief of an AI doctor's shift, with its own reflection
  const observed = view?.driver?.kind === 'agent';
  const reflections = useStore((s) => s.feed).filter((e) => e.kind === 'reflection');
  const [open, setOpen] = useState<string | null>(d?.cases[0]?.patientId ?? null);
  const [copied, setCopied] = useState(false);
  if (!d) return null;
  const clockStart = view?.clockStart ?? '00:00';
  const goal = rotation.goal;
  const replayItem = goal && goal.map === d.mapId && goal.seed === d.seed
    ? d.cases.find(c => c.patientId === goal.patient)?.items.find(i => (i.id ?? i.label) === goal.objective) : undefined;
  const challenge = `${location.origin}/?map=${d.mapId}&seed=${d.seed}`;
  return (
    <div className="debrief">
      <div className="db-inner">
        <header className="db-head">
          <div className={`grade g-${d.grade}`}>{d.grade}</div>
          <div>
            <h1>Shift debrief — {d.mapTitle}</h1>
            <div className="dim">
              {d.playerName} · score {d.score} / {d.maxScore} ({d.percent}%) · resource use ${d.costUSD.toLocaleString()} · seed {d.seed}
            </div>
          </div>
          <div className="db-actions">
            <button
              className="btn"
              onClick={() => {
                navigator.clipboard?.writeText(`I scored ${d.percent}% (${d.grade}) on AgentClinic "${d.mapTitle}". Same shift, same patients — beat me: ${challenge}`);
                setCopied(true);
              }}
            >
              {copied ? '✓ Copied' : '⚔ Challenge a friend'}
            </button>
            {observed ? (
              <button className="btn primary" onClick={() => store.set({ screen: 'game' })}>
                ← Back to the ED
              </button>
            ) : (
              <button className="btn primary" onClick={() => client.start(d.mapId, d.playerName, undefined, d.seed, savedNpcSelection(), true)}>
                Replay same shift
              </button>
            )}
            <button className="btn" onClick={() => solo ? client.leaveSolo() : store.set({ screen: 'menu', view: null, debrief: null })}>
              Main menu
            </button>
          </div>
        </header>

        {solo && !observed && <section className="db-safety rotation-card">
          <div className="slots-head"><h2>Rotation locker</h2><b>Level {level(rotation.xp)} · {rotation.xp} XP</b></div>
          <p>First disposition on each case earns 50 XP. Each percentage point in your personal best earns 1 XP.</p>
          <progress max={100} value={rotation.xp % 100} aria-label="Progress to the next level" />
          <p>{rotation.items.length ? rotation.items.join(' · ') : 'Next unlock at level 2 · Surgeon’s vest'}</p>
          {savedGame && <p role="status" className="dim">Saved to slot {savedGame.slot} · {savedGame.name}</p>}
          {goal && <p><b>Practice goal</b> · {goal.label}
            {replayItem && <span> · {goal.points} → {replayItem.points} / {replayItem.max}{replayItem.ok && ' ✓'}</span>}
          </p>}
          <div className="db-actions">
            <button className="btn" onClick={() => client.openSlots('save')}>Save game</button>
            <button className="btn" onClick={() => client.leaveSolo(true)}>Choose next shift</button>
            <a className="btn" href={'https://github.com/eth-medical-ai-lab/GTAgentClinic/issues/new?' + new URLSearchParams({
              title: 'Teaching case idea', body: 'What decision should the player face?\n\nWhat makes it hard?\n',
            })} target="_blank" rel="noreferrer">Suggest a case</a>
          </div>
        </section>}

        {observed && (
          <section className="db-safety">
            <h2>The AI resident’s reflection</h2>
            {reflections.length ? reflections.map((r) => <p key={r.id} style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{r.text}</p>) : <p className="dim">No reflection yet: it appears in the feed when the AI doctor sends it.</p>}
            <p className="dim">
              Same shift yourself: seed {d.seed} on the main menu. Run log: <a href={`/api/runs/${view?.sessionId}`} target="_blank" rel="noreferrer" style={{ color: '#9fdcff' }}>JSON</a>
            </p>
          </section>
        )}

        {d.safetyEvents.length > 0 && (
          <section className="db-safety">
            <h2>Safety events</h2>
            {d.safetyEvents.map((e, i) => (
              <div key={i} className={`safety ${e.caught ? 'caught' : 'missed'}`}>
                <b>{e.caught ? '🛡 Caught' : '⚠ Missed'} — {e.label}</b> <span className="pts">{e.caught ? `+${e.points}` : '0'}</span>
                <div className="dim">{e.detail}</div>
              </div>
            ))}
          </section>
        )}

        {!!d.escalations?.length && (
          <section className="db-safety db-esc">
            <h2>Escalations to the attending</h2>
            {d.escalations.map((e, i) => (
              <div key={i} className={`safety esc-row ${e.unstable ? 'unstable' : 'stable'}`}>
                <b>
                  {clockAt(clockStart, e.t)} · {e.bedLabel} · {e.name} — {e.mode === 'bedside' ? '🏃 to the bedside' : '☎ by phone'}
                  {e.arrivedAt !== undefined ? `, there at ${clockAt(clockStart, e.arrivedAt)}` : ''}
                </b>{' '}
                <span className="pts">{e.unstable ? 'unstable' : 'stable'}</span>
                <div className="mono esc-vitals">
                  {escalationVitals(e.vitals)}
                  {e.onMonitor ? ` · alarms: ${e.alarms.join(', ') || 'none'}` : ' · not on a monitor'}
                </div>
                <div className="dim">{e.unstable ? `Unstable: ${e.why.join('; ')}.` : 'Stable at the time: no hypotension, hypoxia, falling GCS or critical page.'}</div>
                {e.reason && <div className="dim">Your reason: “{e.reason}”</div>}
              </div>
            ))}
            <p className="dim">Listed for reflection: escalating does not change your score.</p>
          </section>
        )}

        {d.infectionControl && <InfectionControl ic={d.infectionControl} clockStart={clockStart} observed={observed} />}

        <DebriefUsage usage={view?.usage} modelLabel={view?.llm.model} />

        <section className="db-cases">
          {d.cases.map((c) => (
            <CaseCard key={c.patientId} c={c} open={open === c.patientId} onToggle={() => setOpen(open === c.patientId ? null : c.patientId)} clockStart={clockStart} />
          ))}
        </section>
      </div>
    </div>
  );
}

const PRECAUTION_LABEL = { contact: 'contact', droplet: 'droplet', airborne: 'airborne' } as const;

/**
 * Hand hygiene (WHO moments 1 and 4) and masks, from where you went, whom you examined, and your rubs
 * and washes (server/sim/hygiene.ts). Not scored.
 */
function InfectionControl({ ic, clockStart, observed }: { ic: InfectionControlDebrief; clockStart: string; observed: boolean }) {
  const pct = (m: { met: number; of: number }) => (m.of ? `${Math.round((100 * m.met) / m.of)}%` : '—');
  const rubs = ic.actions.filter((a) => a.kind === 'rub').length;
  const washes = ic.actions.filter((a) => a.kind === 'wash').length;
  const masksOn = ic.actions.filter((a) => a.kind === 'mask_on').length;
  const glovesOn = ic.actions.filter((a) => a.kind === 'gloves_on').length;
  const gloves = ic.gloves ?? [];
  const after = (ic.afterGloves ?? []).filter((g) => !g.open);
  const how = (k: 'rub' | 'wash') => (k === 'rub' ? 'alcohol rub' : 'hand wash');
  return (
    <section className="db-safety db-ic">
      <h2>Infection control</h2>
      <div className="ic-tiles">
        <div className="ic-tile">
          <div className="ic-n mono">
            {ic.moment1.met}/{ic.moment1.of}
          </div>
          <div className="ic-k">Moment 1 · before touching a patient</div>
          <div className="dim">{pct(ic.moment1)}</div>
        </div>
        <div className="ic-tile">
          <div className="ic-n mono">
            {ic.moment4.met}/{ic.moment4.of}
          </div>
          <div className="ic-k">Moment 4 · after touching a patient</div>
          <div className="dim">{pct(ic.moment4)}{ic.open ? ` · ${ic.open} not yet due` : ''}</div>
        </div>
        <div className="ic-tile">
          <div className="ic-n mono">{ic.masks.length ? `${ic.masks.filter((m) => m.masked).length}/${ic.masks.length}` : '—'}</div>
          <div className="ic-k">Masked where required</div>
          <div className="dim">{ic.masks.length ? 'droplet / airborne precautions' : 'no patient needed one'}</div>
        </div>
        <div className="ic-tile">
          <div className="ic-n mono">
            {rubs} · {washes}
          </div>
          <div className="ic-k">Rubs · washes</div>
          <div className="dim">{masksOn ? `${masksOn} mask${masksOn > 1 ? 's' : ''} worn` : 'no mask worn'}</div>
        </div>
        <div className="ic-tile">
          <div className="ic-n mono">{gloves.length ? `${gloves.filter((g) => g.gloved).length}/${gloves.length}` : '—'}</div>
          <div className="ic-k">Gloved where required</div>
          <div className="dim">{gloves.length ? 'contact precautions' : 'no contact precautions'}</div>
        </div>
        <div className="ic-tile">
          <div className="ic-n mono">{after.length ? `${after.filter((g) => g.ok).length}/${after.length}` : '—'}</div>
          <div className="ic-k">Hands cleaned after gloves</div>
          <div className="dim">{glovesOn ? `${glovesOn} pair${glovesOn > 1 ? 's' : ''} used` : 'no gloves used'}</div>
        </div>
      </div>
      {observed && <p className="dim">This AI doctor's tools have no hand hygiene yet (the API has a <span className="mono">hygiene</span> action), so it misses every moment by construction.</p>}
      {ic.opportunities.map((o, i) => (
        <div key={i} className={`safety ${o.ok ? 'caught' : 'missed'}`}>
          <b>
            {clockAt(clockStart, o.t)} · {o.bedLabel} · {o.name} — moment {o.moment} {o.ok ? '✓' : '✗'}
          </b>
          <div className="dim">
            {o.ok && o.by
              ? `${how(o.by.kind)} at ${clockAt(clockStart, o.by.t)}, ${o.by.roomLabel}`
              : o.moment === 1
                ? 'No rub or wash between the last room (or patient) and your first examination.'
                : 'No rub or wash after your last examination, before the next room or patient.'}
          </div>
        </div>
      ))}
      {ic.masks.map((m, i) => (
        <div key={`m${i}`} className={`safety ${m.masked ? 'caught' : 'missed'}`}>
          <b>
            {clockAt(clockStart, m.t)} · {m.bedLabel} · {m.name} — {PRECAUTION_LABEL[m.precaution]} precautions: {m.masked ? 'masked ✓' : 'no mask ✗'}
          </b>
        </div>
      ))}
      {gloves.map((g, i) => (
        <div key={`g${i}`} className={`safety ${g.gloved ? 'caught' : 'missed'}`}>
          <b>
            {clockAt(clockStart, g.t)} · {g.bedLabel} · {g.name} — contact precautions, examined {g.gloved ? 'in gloves ✓' : 'without gloves ✗'}
          </b>
        </div>
      ))}
      {after.map((g, i) => (
        <div key={`a${i}`} className={`safety ${g.ok ? 'caught' : 'missed'}`}>
          <b>
            {clockAt(clockStart, g.t)} · gloves off — {g.ok ? 'hands cleaned after ✓' : 'no rub or wash after ✗'}
          </b>
          <div className="dim">{g.ok && g.by ? `${how(g.by.kind)} at ${clockAt(clockStart, g.by.t)}, ${g.by.roomLabel}` : 'Gloves leak and hands get contaminated taking them off: clean them before the next patient or room.'}</div>
        </div>
      ))}
      <p className="dim">
        Listed for reflection: hand hygiene doesn't change your score. Counted from where you went, whom you examined, and your rubs and washes: a rub at the
        dispenser outside the bay or inside it counts before you examine, and after it until you go into another room or touch another patient. Moments 2, 3 and 5
        (aseptic tasks, body fluids, the patient's surroundings) aren't simulated.
      </p>
    </section>
  );
}

/** "HR 118 · BP 84/50 (MAP 61) · RR 26 · SpO₂ 93% on RA · GCS 13" */
function escalationVitals(v: Vitals): string {
  const parts: string[] = [];
  if (v.hr !== undefined) parts.push(`HR ${v.hr}`);
  if (v.sbp !== undefined && v.dbp !== undefined) parts.push(`BP ${formatBP(v)} (MAP ${mapOf(v)})`);
  if (v.rr !== undefined) parts.push(`RR ${v.rr}`);
  if (v.spo2 !== undefined) parts.push(`SpO₂ ${v.spo2}%${v.o2 ? ` on ${v.o2}` : ''}`);
  if (v.gcs !== undefined) parts.push(`GCS ${v.gcs}`);
  return parts.join(' · ');
}

function CaseCard({ c, open, onToggle, clockStart }: { c: CaseDebrief; open: boolean; onToggle: () => void; clockStart: string }) {
  const pct = c.maxScore > 0 ? Math.max(0, Math.round((100 * c.score) / c.maxScore)) : 0;
  const best = useStore(s => s.solo ? s.rotation.best[c.caseId ?? (s.debrief?.mapId + '/' + c.patientId)] : undefined);
  return (
    <div className={`case ${open ? 'open' : ''}`}>
      <button className="case-head" onClick={onToggle}>
        <div className="case-score" style={{ ['--p' as string]: `${pct}` }}>
          <span>{pct}%</span>
        </div>
        <div className="case-title">
          <div className="dim">
            {c.bedLabel} · {c.name}
          </div>
          <b>{c.caseTitle}</b>
          <div className="case-verdicts">
            <span className={`v ${c.dxVerdict}`}>Dx: {c.dxVerdict}</span>
            <span className={`v ${c.dispoCorrect === true ? 'correct' : c.dispoCorrect === false ? 'incorrect' : 'none'}`}>Dispo: {c.disposition ? DISPO_LABELS[c.disposition] : 'none'}</span>
            <span className="v none">${c.costUSD}</span>
          </div>
        </div>
        <span className="chev">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="case-body">
          <p className="outcome">{c.outcome}</p>
          {best !== undefined && <p>Personal best · {best}%</p>}
          <div className="truth">
            <b>Final diagnosis:</b> {c.trueDiagnosis}
            <br />
            <b>Yours:</b> {c.yourDiagnoses.join('; ') || '—'}
            <br />
            <b>Best disposition:</b> {c.expectedDispositions.map((x) => DISPO_LABELS[x]).join(' / ')}
          </div>
          <table className="items">
            <tbody>
              {c.items.map((it, i) => (
                <tr key={i} className={it.points < 0 ? 'neg' : it.ok ? 'ok' : 'miss'}>
                  <td className="ic">{it.points < 0 ? '−' : it.ok ? '✓' : '✗'}</td>
                  <td>
                    {it.label}
                    {store.get().solo && <div className="rotation-links">
                      {!it.ok && it.max > 0 && <button onClick={() => {
                        const d = store.get().debrief!;
                        rememberRotation({ ...store.get().rotation, goal: { map: d.mapId, seed: d.seed, patient: c.patientId, label: it.label, objective: it.id ?? it.label, points: it.points } });
                      }}>{store.get().rotation.goal?.patient === c.patientId && store.get().rotation.goal?.objective === (it.id ?? it.label) ? 'Pinned' : 'Pin for replay'}</button>}
                      <a href={'https://github.com/eth-medical-ai-lab/GTAgentClinic/issues/new?' + new URLSearchParams({
                        title: 'Scoring feedback · ' + it.label, body: [c.caseTitle, 'Shift ' + store.get().debrief?.mapTitle, 'Seed ' + store.get().debrief?.seed, it.label, '', 'What would you change?'].join('\n'),
                      })} target="_blank" rel="noreferrer">Flag scoring</a>
                    </div>}
                    {it.detail && <div className="dim">{it.detail}</div>}
                  </td>
                  <td className="pts">{it.max > 0 || it.points !== 0 ? `${it.points}${it.max > 0 ? ` / ${it.max}` : ''}` : 'n/a'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="two-col">
            <div>
              <h3>Key history</h3>
              <ul className="facts">
                {c.keyFacts.map((k) => (
                  <li key={k.label} className={k.elicited ? 'ok' : 'miss'}>
                    {k.elicited ? '✓' : '○'} {k.label}
                    {k.elicited && k.source ? <span className="dim"> — from {k.source}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Timeline</h3>
              <ul className="timeline">
                {c.timeline.map((e, i) => (
                  <li key={i}>
                    <span className="mono dim">{clockAt(clockStart, e.t)}</span> {e.text}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <h3>Teaching points</h3>
          <ul className="teaching">
            {c.teaching.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <h3>References</h3>
          {c.origin && <p className="dim">
            {c.origin.kind === 'adapted' ? 'Adapted case' : c.origin.kind === 'legacy' ? 'Original project case' : 'Fictional case'}
            {' · '}{c.origin.author === 'Not recorded' ? 'Authorship not recorded' : c.origin.author}{' · Clinical review: '}{c.origin.review}.
            {c.origin.source && <> <a href={c.origin.source.url} target="_blank" rel="noreferrer">Published case report</a> ({c.origin.source.license}).</>}
          </p>}
          <ol className="refs">
            {c.references.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
