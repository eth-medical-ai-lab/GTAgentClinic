# AI agents

Agents play the same shifts as humans, with the same action space and the same scoring. Use **step mode**: time only advances through action costs and `wait`, so agent latency never costs game time.

In **Clinical actions** mode an agent reads a text observation and chooses actions such as `move`, `talk`, `examine` and `order`. The engine walks its avatar. In **Embodied** mode, a vision model plays through the game screen.

## Run one

```bash
npm start                                  # server on :5317 (NPCs via your own API key, else offline; your Claude Code login only if you chose it)
npm run agent:demo                         # scripted baseline over HTTP → ~96% on Night Shift (seed 2024), full speed
npm run agent:claude -- --model sonnet     # your Claude Code plays via MCP (running it is your choice); prints a 3D spectate link
```

Open `http://localhost:5317/?spectate=<sessionId>` to watch any agent's shift in 3D.

## Embodied mode

1. Install the game browser once with `npx playwright install chromium` and start the game. The server machine needs to be able to render the 3D client in Chromium.
2. Open **Watch an AI doctor → Embodied**. Choose Claude Haiku, Sonnet or Opus. This uses the configured Anthropic API provider (`npm start -- --llm api`) or your existing [Claude Code opt-in](SETUP.md#claude-code).
3. Embodied and **Over-the-shoulder** are preselected. Choose **First-person** for an eye-level run. Set a shift, seed and turn limit, then watch. Copy the spectator URL to share the doctor's screen. **Stop shift** on the host ends the run and saves the debrief.

**Live view** streams the game and its HUD at 1920 × 1080, targeting up to 30 frames per second depending on the host GPU and connection. **What the AI saw** displays the exact 1280 × 720 JPEG used for inference. It stays on that image until the doctor requests another. Switching spectator views does not request an observation or alter the camera.

The doctor receives one initial screenshot. Each subsequent decision specifies a public intent, zero to four ordered inputs and whether to look again after the sequence. A key hold or wait can last up to eight seconds, with an eight-second total per sequence. For example, it can walk four seconds and turn before looking, open the tablet and inspect it immediately, or continue with text-only input results. An empty sequence with `observeAfter: true` requests an image immediately. The last 24 decision and input records provide context. Speaking at the bedside or on the phone still uses the human dictation handler.

Open **Observation log** to inspect the timing, images, decisions and input outcomes. Each numbered image can be reopened after the shift. The run record includes `observations.count` and timestamped `observations.events`. The corresponding JPEGs are in `data/runs/<sessionId>.observations/`; the stream itself is not recorded.

To verify both views without spending tokens, run `npm run build` and `npm run e2e:embodied` after installing Chromium. The test uses a private game server and a local model stand-in.

For repeatable comparisons set the same starting camera, case seed, shift, NPC provider and turn limit (5–400). A turn counts once even if the model produces an invalid input. The game clock runs during inference, so slower models may have less clinical time. The debrief and clinical action history are in `data/runs/<sessionId>.json`, with mode, starting camera, turn limit, seed and token usage. The adjacent `.agent.log` records the model's inputs, public intents and outcomes. Live frames are held in memory. To launch by API, POST `{"controlMode":"embodied","agent":"claude","model":"haiku","mapId":"orientation","seed":42,"maxTurns":60}` to `/api/observe` on the host and open the returned spectator URL.

## Watch an AI doctor (observe mode)

An AI resident plays a shift while you watch and learn from it.
- **3D:** its avatar (`ai_doctor`, white coat) walks to the bedside to talk and examine, sits at a station or workroom desk to order and read charts, and stands at the phone to call. The label under its name says what it is doing ("Examining Bed 4 — back: Costovertebral angle tenderness", "Ordering lactic acid, blood cultures x2 (Bed 4)", "Calling cardiology"). Its latest reasoning appears as a speech bubble.
- **Feed:** the right-side "AI resident" panel is a timestamped teaching transcript:
  - its reasoning, one or two sentences before each action;
  - a line per action and the key part of each result;
  - notable events (pages, results, arrivals, consults accepted).

  At the end it shows the score, the AI's own reflection, the full debrief and the run log.

**From the menu:** use the *Watch an AI doctor* card. Select **Clinical actions**, then pick a shift, an AI doctor and, for Claude, a model (Haiku, Sonnet or Opus; Sonnet is the default).
- **Claude** runs headless on your own Claude Code login (plan usage; or your `ANTHROPIC_API_KEY`, billed, if one is set). It needs `claude` installed and logged in, and the [personal Claude Code opt-in](SETUP.md#claude-code): without it the card explains the options and starts on the scripted demo. Claude Code users can always let their own `claude` play through the MCP server instead ([MCP](#mcp)).
- **Scripted demo** is free (no LLM, offline NPCs). It is a reference walkthrough that explains every step, scoring ~96% on Night Shift and ~95% on Orientation Day.

You walk the floor as a med student: *Tag along* (<kbd>T</kbd>) follows behind the AI resident, and any <kbd>W A S D</kbd> (*Walk freely*) goes your own way again. *Slow / Normal / Fast / Max* set the pause between its actions, and *Stop* ends its shift. Spectators can look, not act: the server refuses actions from browsers attached to an agent's shift. Only one menu-launched AI doctor runs at a time.
- **Talk to anyone, off the record.** <kbd>E</kbd> (or a click) on a patient, relative, nurse, the attending or anyone else opens your own tablet. They know you are a student with the doctor's team: patients tell you their story and ask for the doctor, and staff explain but send decisions to the resident. Clicking the AI resident brings back its transcript instead.
- **Read, don't act.** The tablet (<kbd>Tab</kbd>) and the workstations show the patients, their charts and the tracking board read-only, and bedside monitors open as usual. Orders, notes, signatures, exams, belongings, calls and escalations stay the AI doctor's.
- **The transcript panel** minimizes to a chip with what the AI doctor is doing and a count of new lines: use the — button, <kbd>R</kbd>, a two-finger swipe down or a right-drag, as with the tablet. The chip, <kbd>R</kbd> or a swipe up brings it back. ⤢ or <kbd>Shift</kbd>+<kbd>R</kbd> widens it for reading. Your browser remembers the choice.

**Watcher chats leave the run untouched** (`server/npc/watcher.ts`). An agent run is research data, so what a watcher says is kept apart:
- **Own threads.** They are kept per browser tab and NPC, beside the session, and never enter the session's conversations, the agent's observation or view, the narration feed or the run log. Replies go to that watcher's socket only.
- **No actions.** The NPC's reply schema is `{say, emotion}`, and nothing in it is applied. There are no verbal orders, vitals, cultures-first or stop-the-med catches, consent, stepping out, consults or faxes. No facts or counseling count toward the score, and the patient's emotion and first-contact time stay as they were.
- **Read-only.** Building the NPC's situation only reads the session. A watcher chat takes nothing from the random stream, adds no timers and doesn't move the clock. Its line ids come from a counter of its own. Spectators' panels no longer slow a realtime agent session's clock either.
- **LLM NPCs.** Watcher turns use their own conversation key and run one at a time per server. Their tokens count in the server's daily totals, not the run's usage. With `--max-tokens` / `--max-usd` set, watchers get scripted replies, so they can't use up the budget the run's NPCs depend on. NPC wording is never reproducible with an LLM; with offline NPCs a run is identical with or without watchers.
- **Tested.** `tests/watcher.test.ts` replays the scripted demo's shifts with an adversarial watcher between and during every action, with offline and with LLM NPCs. Action results, observations, views, events, the event log, the debrief, the AI's conversations and the random stream must all match a run nobody watched. `tests/observe-e2e.ts` chats through the real UI, then plays the same seed unwatched and compares the run logs.

**From the CLI:**

```bash
npm run agent:claude -- --model haiku --pace 1.5 --max-turns 60   # Claude, watchable: 1.5 s between actions
npm run agent:demo -- --pace 1.5                                   # the scripted walkthrough, watchable (--map orientation)
```

Open the printed `?spectate=` link. Any agent session shows the AI resident. Agents that post narration fill the feed; others still get the avatar, the activity label and the server's event lines.

**Pacing is server-side.** Each agent session has a pace (`pace` in `POST /api/sessions`, `POST /api/sessions/:id/pace`, or the panel's buttons).
- The server runs that session's actions one at a time.
- Before each action it waits until the previous action's gap has passed. The gap is the pace, stretched to the avatar's walk up to 4× the pace; a burst of orders at one desk goes faster.
- The agent's own thinking time counts toward the gap, so Claude is rarely slowed and the scripted demo becomes watchable.
- It works for every agent (REST, MCP, Claude, scripted) without agent changes, and the server knows the walking distances.
- Step mode means game time never moves during the pause, so pacing changes nothing in the simulation or the score.

**Narration API.** `POST /api/sessions/:id/narration {text, kind?, patientId?}`
- `kind` is `thought` (default, also the speech bubble), `action`, `result` or `reflection`.
- Text is cleaned and capped at 1,200 characters; bodies over 16 KB are refused.
- Each session is rate-limited (bursts of 30, then 6 per second; `429` with `retryAfterMs`) and keeps the last 300 lines.
- Lines are broadcast live as `GameEvent {kind: 'narration'}`, replayed to spectators who join late, and saved in the run log.
- `agents/narration.ts` has a small client (`Narrator`) and the formatting that `claude-doctor.ts` uses.

## REST API

| Method & path | Body / result |
|---|---|
| `GET /api/health` | `{ ok, version, llm }` |
| `GET /api/maps` | playable shifts and individual presentations. Filter `kind: "practice"` for one patient, or `kind: "mixed"` for seeded arrivals; pass the returned `id` as `mapId`. |
| `GET /api/catalog[?format=text]` | orderables (codes, med dose options), order sets, exam maneuvers, analytes |
| `POST /api/sessions` | `{ mapId, seed?, playerName?, mode?: 'step'\|'realtime', llm?: 'offline', pace?, model? }` → `{ sessionId, observation, contacts, spectateUrl }`. REST sessions are agent-driven: `view.driver` is `{kind: 'agent', label, model, paceSec}` and the view contains the `ai_doctor` NPC (human sessions: `{kind: 'human'}`, no ai_doctor). `pace` = seconds between actions for watchers (default 0). |
| `GET /api/sessions/:id` | `{ observation, view }` (view = the full JSON `PlayerView`) |
| `POST /api/sessions/:id/act` | `{ action }` → `{ result, observation, clock, ended }` |
| `GET /api/sessions/:id/debrief` | scored `Debrief`, including case origins. For practice and mixed shifts, finish with `end_shift` first. |
| `DELETE /api/sessions/:id` | end and save |
| `GET /api/usage` | LLM tokens and cost: this server process, today, all-time, per session (NPCs and agents), plan window, budget |
| `GET /api/sessions/:id/usage` | this shift's `UsageView`: NPC totals, per-NPC breakdown, the agent's reported usage |
| `POST /api/sessions/:id/usage` | an agent reports its own **cumulative** usage: `{ calls, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costUSD, label?, model?, billing?, final? }`. Shown in the HUD for spectators and saved in the run log. `npm run agent:claude` does this automatically. |
| `POST /api/sessions/:id/narration` | think-aloud line `{ text, kind?: 'thought'\|'action'\|'result'\|'reflection', patientId? }` → `201 { ok, id }` (see observe mode) |
| `GET /api/sessions/:id/narration[?since=<id>]` | `{ entries }`: the feed's ring buffer |
| `POST /api/sessions/:id/pace` | `{ seconds: 0–10 }`: pause between the agent's actions for watchers |
| `POST /api/observe` | launch one AI doctor: `{ mapId, agent: 'claude'\|'demo', model?: 'haiku'\|'sonnet'\|'opus', seed?, pace?: 1.5, maxTurns?: 250 }` → `201 { sessionId, spectateUrl, … }` (`409` if one is running, `403` for Claude without the [personal Claude Code opt-in](SETUP.md#claude-code), `503` if Claude Code is not logged in). Loopback only. |
| `GET /api/observe` | `{ running, current, claude }`: state (`running`/`finished`/`stopped`/`failed`), pid, last console lines; `claude: { allowed, note? }` says whether the Claude option is enabled (the opt-in) |
| `DELETE /api/observe` | stop it (the agent, `claude` and the MCP server) and end its shift. Loopback only. |
| `GET /api/runs/:id` · `GET /api/runs/:id/agent-log` | the saved run log (JSON, written when the shift ends; includes `narration`) · an observe run's agent console output |

**Observation** is a text rendering of what a human sees: time and location, the tracking board (with patientIds), who is in the room (npcIds), staff elsewhere, any monitor in view, unread pages, and recent conversation. The `view` JSON carries the same information in structured form.

**Actions** (`shared/types.ts`):

```jsonc
{"type":"move","to":"bed_4"}
{"type":"talk","npcId":"pt_p_brunner","text":"Does it burn when you pass urine?"}
{"type":"examine","patientId":"p_brunner","maneuver":"back_cva"}
{"type":"order","patientId":"p_brunner","code":"lr_bolus","params":{"dose":"30 mL/kg"},"priority":"STAT"}
{"type":"ehr_view","patientId":"p_brunner","section":"labs","query":"lact"}   // summary|vitals|labs|imaging|ecg|orders|mar|notes|history|board
{"type":"sign_ecg","ecgId":"ecg17","interpretation":"Inferior STEMI with reciprocal changes"}
{"type":"call","contactId":"gp_whitfield","text":"Margarethe Brunner, DOB 02/11/1945 — prior cultures?"}
{"type":"set_diagnoses","patientId":"p_keller","diagnoses":["Inferior STEMI","RV involvement"]}
{"type":"disposition","patientId":"p_keller","decision":"cath_lab","diagnoses":["Inferior STEMI"]}
{"type":"wait","minutes":15}
{"type":"inspect","itemId":"keller_medbag"}
{"type":"escalate","patientId":"p_brunner","mode":"bedside","reason":"SBP 84 despite 2 L"}   // or "mode":"call"
{"type":"hygiene","kind":"rub"}   // or "wash", "mask_on", "mask_off", "gloves_on", "gloves_off"; optional "at": the dispenser, sink, box or bin
{"type":"examine","patientId":"p_thompson","maneuver":"pocus_rlq"}   // bedside ultrasound, one view: pocus_ruq|luq|pelvic|cardiac (FAST), pocus_aorta|rlq|bladder|ivc|lung
{"type":"end_shift"}
```

**Rules that keep humans and agents comparable.**
- Talking and examining require being in the same room.
- Orders and chart reading require a workstation (station, workroom, triage). Verbal orders to a nurse are the alternative.
- Calls require a phone (station, workroom). The attending's line is the exception: it works from anywhere, as the tablet's Escalate button does for humans.

**Action costs** (game minutes): talk 1, call 1, examine 0.5–5, order 0.5, chart 0.5, escalate 0.5, hygiene 0, move = walking time, wait = N.

**Bedside ultrasound** (`server/sim/pocus.ts`, views in `shared/pocus.ts`): nine views are exam maneuvers, `pocus_<window>`, offered for every patient: `pocus_ruq`, `pocus_luq`, `pocus_pelvic` and `pocus_cardiac` (FAST), then `pocus_aorta`, `pocus_rlq`, `pocus_bladder`, `pocus_ivc` and `pocus_lung`. Use `examine` at the bedside (the patient in their bed, not in CT). Each takes 1 game minute (`pocus_rlq` 2).
- **The read.** The result's `text` is the read as a doctor would document it ("Ultrasound — RLQ / appendix: Graded compression … a non-compressible, blind-ending tubular structure …"). It comes from the case (`CaseDef.pocus`, per window) and can follow physiology (Brunner's IVC fills after fluids). A view the case doesn't list reads as a normal study for that patient; in a case adapted from a case report it reads "No finding recorded for this maneuver.", as other exams do.
- **On the record.** Each view is a finding on the patient's bedside list (`view.examFindings`), a hand-hygiene contact, and an `exam` entry in the event log. A case scores a scan only where it asks for one (the high-risk PE: the cardiac view; the pleural effusion: the RUQ view).
- **Determinism.** It draws nothing from the session's random stream (`tests/ultrasound.test.ts`).

**Hand hygiene and masks** (`hygiene`, `server/sim/hygiene.ts`): an alcohol rub or a hand wash wherever you are, or a surgical mask on or off (`mask_on` while wearing one, or `mask_off` without, is refused), or non-sterile gloves on or off (`gloves_on` while gloved, `gloves_off` without, and a rub or wash with gloves on are refused). Humans do it at the dispensers, sinks, mask and glove boxes in the 3D view (gloves: E on a box, G takes them off). It is recorded beside the scoring log, never in it, and the debrief's `infectionControl` lists it, **not scored**:
- **WHO moments 1 and 4.** One opportunity each per run of examinations of a patient. Moment 1 is met by a rub or wash after you last left a room where you touch things (the station, the workroom: not a corridor, not someone's bed space) or touched another patient, and before the first examination. Moment 4 is met by one after the last examination and before you go into such a room or touch another patient. In step mode a move is instantaneous, so rub in the bay before you examine, and before you leave.
- **Masks.** Each visit to a patient on droplet or airborne precautions, and whether a mask was on as you went in. None of the shipped cases needs droplet or airborne precautions. `view.board[].precautions` names a room's precautions (Brunner: contact, once her ESBL culture is known); the observation text doesn't print it.
- **Gloves.** Each examination of a patient on contact precautions, and whether gloves were on (`gloves`); and after each `gloves_off`, whether a rub or wash came before the next examination, the next pair, or a room where you touch things (`afterGloves`).
- The MCP server has no hygiene tool, so the built-in AI doctor's tools and prompts are as they were: its runs read 0 % by construction.

**Escalating to the attending** (`escalate`, `server/sim/escalation.ts`) works any time, from anywhere, and is what humans do with the 🆘 Escalate button on a patient's tablet.
- `"mode":"bedside"`: Dr. Shaw drops what she is doing, pages "On my way to Bed 4.", and walks over through the staff task queue. She arrives about a minute plus the walk later (`wait` if needed) and says an opener aloud. Then she is talkable there (`talk` to `att_shaw`); before she arrives, `talk` is refused. After 10 minutes she goes back, unless the patient is still unstable; then she stays and re-checks every 5 minutes. Board rounds wait for her.
- `"mode":"call"`: her line, `ED attending — Dr. Shaw` (contactId `attending`), opens at the top of the contacts and she picks up. Answer with `call` to `attending`.
- **Her context.** Her LLM context gets the escalation: the patient, your reason, and the vitals and monitor alarms at that moment.
- **Unstable patients.** She stops teaching Socratically and gives direct stabilization steps first, then teaches. Unstable means SBP < 90 or MAP < 65, SpO₂ < 90 %, GCS ≤ 8 or down ≥ 2 within the hour, a lethal rhythm, or a critical page that is unread or under 30 minutes old.
- **Where to see it.** `observe` shows her status ("on her way to … expected …", "at …", "line open"). The debrief's `escalations` lists each escalation: time, patient, vitals then, alarms, and whether the patient was unstable, with the criteria met. Some cases explicitly award credit for asking the attending for help. There is no blanket penalty or bonus for escalating.

## MCP

`agents/mcp-server.ts` exposes these tools: `list_shifts`, `start_shift`, `observe`, `catalog`, `move`, `talk`, `examine` (bedside ultrasound views included), `inspect`, `order`, `cancel_order`, `read_chart`, `sign_ecg`, `call`, `escalate`, `set_diagnoses`, `disposition`, `wait`, `end_shift`.

**Belongings.** `observe` lists them as "Belongings you can inspect here" when you are in the bay. `inspect` (1 min) returns what you find, for example the medications EMS brought from home. Facts found there count toward key history, just as if you had asked. It also provides a `play_shift` prompt.

It connects to a running server (`AGENTCLINIC_URL`, default `http://127.0.0.1:5317`) so you can spectate. Without one it embeds the simulation in-process, with NPC brains chosen like the server's (`NPC_LLM` overrides: your API key if set, else offline; Claude Code only with the [opt-in](SETUP.md#claude-code)). `AGENTCLINIC_PACE=1.5` makes its shifts watchable (seconds between actions); `AGENTCLINIC_SESSION=<id>` makes `start_shift` join a shift the server already created (observe mode uses this).

Run this once in the game folder (absolute paths, so it works whatever directory Claude Code starts the server from), then ask Claude Code to play:

```bash
claude mcp add agentclinic -e AGENTCLINIC_PACE=1.5 -- node "$PWD/node_modules/tsx/dist/cli.mjs" "$PWD/agents/mcp-server.ts"
claude --allowedTools "mcp__agentclinic__*" "Start a Night Shift in AgentClinic and play it to the end. Think aloud."
```

## Training notes

- **Reward:** the debrief score, either total or decomposed into dx, dispo, history, critical actions with timing, harms, stewardship and safety catches. Shaped rewards are available from the event log (`data/runs/*.json`).
- **Determinism:** same `seed` gives the same arrivals, lab values, turnaround times and staff behavior. NPC *wording* varies with LLM providers; use `llm: "offline"` for fully deterministic rollouts.
- **The waiting-room crowd** (walk-ins, small talk, the occasional faint at the door; `server/sim/ambient.ts`) is atmosphere for the 3D view only. It runs on its own seed stream, never changes session state, the action space or scoring, and never appears in the observation text. Playable walk-ins on a mixed shift are separate: they can appear as `view.npcs[].walkIn` before their chart opens on arrival at their assigned bay. Staff the ambient crowd borrows for a moment (the triage nurse, security, the clerk) move only in the 3D view. The same seed gives the same ambient schedule, and runs score identically with or without it (`tests/ambient.test.ts`). `GET /api/sessions/:id` `view.npcs` lists the crowd, marked `ambient.crowd: true`.
- **Demonstrations:** every human and agent run is saved with its full action list. Human play is free imitation-learning data.
- **Sim-to-real:** the clinically relevant channels (dialogue, EHR text, orders, timing) are realistic. FHIR export of `PatientChart` is on the roadmap so agents trained here can be pointed at FHIR sandboxes (MedAgentBench-style) unchanged.
- **Information asymmetry, as in AgentClinic:** patients know symptoms in lay terms, family and GPs know collateral, nurses know measurements, consultants see the chart. Nobody hands over the diagnosis.
