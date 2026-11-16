import { useEffect, useRef, useState } from 'react';
import type { MapSummary } from '../../../shared/types';

type Lookup = { query: string; hits: { mapId: string; diagnosis: string }[]; error?: boolean };

export function PracticePicker({ cases, selected, onChoose, onClose }: {
  cases: MapSummary[]; selected?: string; onChoose(id: string): void; onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [byDiagnosis, setByDiagnosis] = useState(false);
  const [specialty, setSpecialty] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const term = query.trim().toLowerCase();
  const specialties = [...new Set(cases.map(c => c.specialty).filter((s): s is string => !!s))].sort();
  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    search.current?.focus();
    return () => node.close();
  }, []);
  useEffect(() => {
    if (!byDiagnosis || !term) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch('/api/practice-search?q=' + encodeURIComponent(term), { signal: controller.signal });
        if (!res.ok) throw new Error('Lookup failed');
        const hits: Lookup['hits'] = await res.json();
        if (!controller.signal.aborted) setLookup({ query: term, hits });
      } catch {
        if (!controller.signal.aborted) setLookup({ query: term, hits: [], error: true });
      }
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [byDiagnosis, term]);
  const result = lookup?.query === term ? lookup : null;
  const diagnoses = new Map(result?.hits.map(h => [h.mapId, h.diagnosis]));
  const matches = cases.filter(c => (!specialty || c.specialty === specialty) && (!difficulty || c.difficulty === difficulty)
    && (byDiagnosis ? diagnoses.has(c.id) : c.title.toLowerCase().includes(term)));
  let status = matches.length === 1 ? '1 case' : matches.length + ' cases';
  if (byDiagnosis && !term) status = 'Enter a diagnosis or case ID.';
  else if (byDiagnosis && !result) status = 'Searching…';
  else if (byDiagnosis && result?.error) status = 'Search unavailable. Try again or search by presentation.';
  else if (!matches.length) status = 'No matching cases.';
  return <dialog ref={dialog} className="save-dialog practice-dialog" aria-labelledby="practice-title"
    onCancel={e => { e.preventDefault(); onClose(); }}
    onKeyDown={e => {
      e.stopPropagation(); // the game binds Tab and other keys globally
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    }}>
    <header className="slots-head"><h2 id="practice-title">Choose a practice case</h2>
      <button className="btn small" onClick={onClose}>Close</button></header>
    <div className="practice-controls">
      <label>{byDiagnosis ? 'Find a diagnosis or case ID' : 'Find a presentation'}
        <input ref={search} type="search" value={query} placeholder={byDiagnosis ? 'e.g. appendicitis' : 'e.g. chest pain'}
          onChange={e => setQuery(e.target.value)} /></label>
      <label className="practice-mode"><input type="checkbox" checked={byDiagnosis}
        onChange={e => setByDiagnosis(e.target.checked)} />Search by diagnosis or case ID (reveals diagnoses)</label>
      <div className="practice-filters">
        <label>Specialty<select value={specialty} onChange={e => setSpecialty(e.target.value)}>
          <option value="">All specialties</option>
          {specialties.map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
        </select></label>
        <label>Difficulty<select value={difficulty} onChange={e => setDifficulty(e.target.value)}>
          <option value="">All levels</option>
          {['easy', 'medium', 'hard'].map(d => <option key={d} value={d}>{d[0].toUpperCase() + d.slice(1)}</option>)}
        </select></label>
      </div>
    </div>
    <p className="practice-count dim" role="status">{status}</p>
    <ul className="practice-list" aria-label="Matching cases">{matches.map(c => <li key={c.id}>
      <button className="practice-result" aria-current={selected === c.id || undefined} onClick={() => onChoose(c.id)}>
        <span><strong>{c.title}</strong>{byDiagnosis && <span>{diagnoses.get(c.id)}</span>}
          <small>{c.specialty} · {c.description}</small></span><span className={'diff ' + c.difficulty}>{c.difficulty}</span>
      </button></li>)}</ul>
  </dialog>;
}
