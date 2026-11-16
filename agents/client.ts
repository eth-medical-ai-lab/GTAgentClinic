/**
 * Minimal typed client for the AgentClinic agent API (HTTP). Used by the demo agent,
 * the MCP server, and as a reference for Python/Gym wrappers.
 */
import type { Action, ActionResult, Debrief, MapSummary } from '../shared/types';

export interface AgentObservation {
  sessionId: string;
  t: number;
  clock: string;
  ended: boolean;
  location: string;
  observation: string;
  contacts?: string;
  spectateUrl?: string;
}

export class AgentClinicClient {
  constructor(readonly baseUrl = process.env.AGENTCLINIC_URL ?? 'http://127.0.0.1:5317') {}

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json()) as T & { error?: string };
    if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
    return json;
  }

  health() {
    return this.req<{ ok: boolean; llm: { label: string } }>('GET', '/api/health');
  }

  maps() {
    return this.req<MapSummary[]>('GET', '/api/maps');
  }

  /** pace: seconds between actions for human watchers (observe mode); model: shown in the spectator UI */
  start(mapId = 'night_shift', opts: { seed?: number; playerName?: string; llm?: string; pace?: number; model?: string } = {}) {
    return this.req<AgentObservation>('POST', '/api/sessions', { mapId, mode: 'step', ...opts });
  }

  observe(sessionId: string) {
    return this.req<AgentObservation>('GET', `/api/sessions/${sessionId}`);
  }

  /** phone directory text (same format as start's `contacts`) */
  contacts(sessionId: string) {
    return this.req<{ contacts: string }>('GET', `/api/sessions/${sessionId}/contacts`).then((r) => r.contacts);
  }

  act(sessionId: string, action: Action) {
    return this.req<AgentObservation & { result: ActionResult }>('POST', `/api/sessions/${sessionId}/act`, { action });
  }

  debrief(sessionId: string) {
    return this.req<Debrief>('GET', `/api/sessions/${sessionId}/debrief`);
  }

  catalog() {
    return fetch(`${this.baseUrl}/api/catalog?format=text`).then((r) => r.text());
  }
}
