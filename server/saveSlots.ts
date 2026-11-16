import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { level, SLOT_COUNT, type PlayerSave, type SlotInfo } from '../shared/saveGame';
import type { ShiftHistory } from './sim/shiftJournal';

export function validOwner(owner: unknown): owner is string {
  return typeof owner === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(owner);
}

interface SlotFile {
  version: 1;
  info: SlotInfo;
  history: ShiftHistory;
  player: PlayerSave;
  usage?: Pick<import('../shared/types').UsageView, 'session' | 'byNpc' | 'models'>;
  digest?: string;
  actions: { t: number; action: import('../shared/types').Action; ok: boolean; message?: string }[];
}

export class SaveSlots {
  constructor(readonly root: string) {}

  private file(owner: string, slot: number) {
    if (!validOwner(owner) || !Number.isInteger(slot) || slot < 1 || slot > SLOT_COUNT) throw new Error('Choose a valid save slot.');
    return path.join(this.root, owner, slot + '.json');
  }

  read(owner: string, slot: number): SlotFile | null {
    const file = this.file(owner, slot);
    if (!existsSync(file)) return null;
    const data = JSON.parse(readFileSync(file, 'utf8')) as SlotFile;
    if (data.version !== 1 || !Array.isArray(data.history?.entries) || data.info?.slot !== slot) throw new Error('Incompatible save in slot ' + slot + '.');
    return data;
  }

  list(owner: string) {
    return Array.from({ length: SLOT_COUNT }, (_, i) => this.read(owner, i + 1)?.info ?? null);
  }

  write(owner: string, slot: number, expected: string | null, name: string, data: Omit<SlotFile, 'info' | 'version'>, meta: Pick<SlotInfo, 'map' | 'clock' | 'ended'>) {
    const file = this.file(owner, slot);
    if ((this.read(owner, slot)?.info.revision ?? null) !== expected) throw new Error('This slot changed. Reopen the slot list to see its latest save.');
    const info: SlotInfo = { ...meta, level: level(data.player.rotation.xp), slot, name: name.trim().slice(0, 60) || meta.map, date: new Date().toISOString(), revision: randomUUID() };
    mkdirSync(path.dirname(file), { recursive: true });
    const temp = file + '.' + info.revision;
    writeFileSync(temp, JSON.stringify({ version: 1, info, ...data }), { mode: 0o600 });
    renameSync(temp, file);
    return info;
  }
}
