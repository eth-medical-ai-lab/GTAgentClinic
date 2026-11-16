# GTAgentClinic: notes for Claude Code

A 3D embodied hospital environment for AI and human agents, starting with the emergency department: a three.js and React client, and a TypeScript server on Node 22 that runs the simulation. Humans (WebSocket) and AI agents (REST, MCP) play the same shifts with the same actions. Contributor guide: [CONTRIBUTING.md](CONTRIBUTING.md).

## Commands

```bash
npm run typecheck
npx vitest run                     # unit tests (tests/*.test.ts)
npm run build                      # client bundle + secret scan
node scripts/notices.mjs --check   # THIRD_PARTY_NOTICES.md is current
npx tsx tests/movement-e2e.ts      # GPU e2e in headless Chromium (also tablet-e2e, fullscreen-e2e, …)
```

- Don't run `npm start` to test: the player's own game may be on port 5317. The e2e scripts start private servers on random ports and stop them. For a server of your own: `npx tsx server/index.ts --port <7000–7999> --llm offline --tts off`, and stop it by its PID when done.
- Tests use offline NPCs (`--llm offline`, `--tts off`): free and deterministic. `tests/claude-code-e2e.ts` uses the player's own Claude Code login; run it only when asked.

## Code map

- `server/index.ts`: HTTP, WebSocket and the agent REST API.
- `server/sim/`: the simulation. `session.ts` (actions, clock), `physiology.ts`, `scoring.ts` (debrief), `views.ts` (the information firewall: the client only gets what this builds from observed state), `aiDoctor.ts` (agent-driven shifts, narration), `escalation.ts`, `hygiene.ts`, `ambient.ts` (waiting room).
- `server/npc/`: NPC brains. `prompts.ts`, `dialogue.ts` (talk, call), `brain.ts` (LLM or offline fallback, usage), `offline.ts`, `smalltalk.ts`, `watcher.ts`.
- `server/llm/`: `anthropicApi.ts` (API key), `claudeCode.ts` (the player's own `claude -p`, sandboxed), `provider.ts` (which brain), `pricing.ts`. Also `server/firstRun.ts` (the first `npm start` question), `server/localConfig.ts` (`agentclinic.local.json`), `server/usage.ts` (token ledger), `server/tts/` (voices; the optional engine lives in `voices/`), `server/observe.ts`.
- `client/src/world/`: the three.js world behind `WorldApi`; React never touches three.js directly.
- `client/src/ui/`: React UI: HUD, main menu, the tablet (`NpcPanel`, `Chat`), AgentChart EHR (`ui/ehr/`), debrief, usage chip, full screen. `client/src/net.ts` (WebSocket), `client/src/store.ts` (state).
- `shared/`: types (the `Action` union, views, protocol), clinical catalog, units, layout, usage helpers; used by both sides.
- `content/cases/`: each case's hidden truth (persona, physiology, labs, imaging, scoring); `content/scenarios.ts` (maps); `content/library/` (case library).
- `tests/`: vitest (`*.test.ts`) and GPU e2e scripts (`*-e2e.ts`, built on `tests/harness.ts`).
- `agents/` (REST client, demo agent, MCP server, Claude-as-doctor), `scripts/` (install.sh, Mac launcher, voices, assets, secret scan, notices), `docs/`.

## Conventions

- Strict TypeScript, ES modules; `tsx` runs the server without a build step. Follow the style around you: small functions, comments that say why.
- A new player capability is an `Action` variant (`shared/types.ts`) handled in `server/sim/session.ts`, so the 3D UI, REST and MCP all get it.
- Randomness only through the session's seeded generator; LLM replies change the simulation only through validated structured actions.
- Never import `content/` from `client/`.
- Prose in docs and UI: clear and short.

## Visual QA

Most bugs here are visual (floating things, clipping, hands that miss, things from nowhere). Every new feature or scripted plot ships with a storyboard scene in `tests/storyboard.ts` and a clean support audit: run `npm run storyboard -- --scene=<id>`, then read the contact sheet and frames from at least two angles with the Read tool before saying "done". Checklist and workflow: [docs/VISUAL_QA.md](docs/VISUAL_QA.md).

## Rules

- No brand names or logos.
- Assets: CC0, public domain, OFL or MIT-compatible only, credited in `THIRD_PARTY_NOTICES.md` (`node scripts/notices.mjs`, then `--check`).
- Licences: code, docs and project assets Apache-2.0 (`LICENSE`); cases in `content/cases/`, `content/library/`, `docs/cases/` and `docs/library/` CC BY 4.0 (`LICENSE-CASES`). `NOTICE` names both. Library sources must be CC BY or CC0.
- The AI-doctor and seed determinism tests must pass (`npx vitest run`).
- Never commit secrets (a pre-commit hook scans for them); keys stay in the server's environment. Never read, copy, log or store Claude credentials: only the unmodified `claude` binary handles them.
- Never commit `agentclinic.local.json` or change a player's choice in it.
- Stop every server, browser and `claude` process you start, by PID; never `pkill` or `killall`; never touch port 5317.
- No personal data (names, emails, account details) in external requests: a generic User-Agent only.
- Add user-visible changes to `CHANGELOG.md`.
