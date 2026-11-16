import type { Action, ActionResult, PatientChart, PlayerView, UnitSystem } from '../../../../../shared/types';

export type SectionId = 'snapshot' | 'review' | 'results' | 'vitals' | 'ecg' | 'imaging' | 'orders' | 'mar' | 'notes' | 'dx' | 'board';

export const SECTIONS: { id: SectionId; label: string; icon: string }[] = [
  { id: 'snapshot', label: 'Snapshot', icon: '◧' },
  { id: 'review', label: 'Chart Review', icon: '☰' },
  { id: 'results', label: 'Results', icon: '⚗' },
  { id: 'vitals', label: 'Vitals / Flowsheet', icon: '♥' },
  { id: 'ecg', label: 'ECG', icon: '∿' },
  { id: 'imaging', label: 'Imaging', icon: '◩' },
  { id: 'orders', label: 'Orders', icon: '✎' },
  { id: 'mar', label: 'MAR', icon: '℞' },
  { id: 'notes', label: 'Notes', icon: '✉' },
  { id: 'dx', label: 'Diagnosis & Dispo', icon: '⚑' },
];

export interface SectionProps {
  chart: PatientChart;
  view: PlayerView;
  units: UnitSystem;
  /** wraps props.onAction and reports failures in the status bar */
  act: (a: Action, okMessage?: string) => Promise<ActionResult>;
  go: (section: SectionId, arg?: string) => void;
  openOrderEntry: (orderSet?: string) => void;
  /** game time → "HH:MM" (or "N d ago" for historical) */
  fmt: (t: number) => string;
}
