# Design & architecture

## Vision

AgentClinic (2024) showed that clinical reasoning looks very different once an LLM has to *gather* information instead of being handed a vignette. This game pushes that idea into a richer emulator, an explorable emergency department. The goals:

1. **Teach** clinical reasoning, triage, patient communication and systems thinking to humans, with clinical realism where it matters: lab turnaround, click depth to find a lactate trend, an after-hours GP line that needs a date of birth, an insurer that denies an MRI.
2. **Evaluate and train** AI doctors in the *same* environment through the *same* action space, with richer dynamics than a text harness: time pressure, evolving physiology, parallel patients, other agents who make mistakes.
3. **Compare**: identical shifts by seed, so leaderboards and human-vs-AI comparisons are fair.

## Architecture

```
            ┌────────────── server (Node, authoritative) ───────────────┐
 3D client ─┤ WebSocket  ─┐                                             │
 (React +   │             ├─► GameSession ─► Physiology (per patient)   │
  Three.js) │ REST /api ──┤     │  orders, tasks, triggers, errors      │
 AI agents ─┤ MCP (stdio)─┘     ├─► NpcBrain ─► LLM provider            │
            │                   │     (claude-code | anthropic-api |    │
            │                   │      offline)                         │
            │                   ├─► views.ts  (information firewall)    │
            │                   └─► scoring.ts (deterministic debrief)  │
            └───────────────────────────────────────────────────────────┘
 content/ (server-only truth)        shared/ (types, catalog, units, floor plan)
```

- **One action union** (`shared/types.ts → Action`): move, talk, examine, order, cancel_order, call, hangup, ehr_view, sign_ecg, note, set_diagnoses, disposition, assign_self, ack_page, mark_read, wait, end_shift. The 3D UI, REST and MCP all emit it.
- **Information firewall.** `content/` holds hidden truth (diagnosis, physiology, future lab values, persona facts). Clients only receive `PlayerView` and `PatientChart`, which are built in `server/sim/views.ts` from *observed* state: resulted labs, recorded vitals, documented (possibly incomplete) allergies and meds. The browser bundle never imports `content/`.
- **Two clocks.** *Realtime* (humans): game time = wall time × time scale (default 4–6×), slowed to 0.35× while a panel is open, with pause and "+10 min". *Step* (agents): time advances only by action costs (talk 1 min, exam 0.5–5 min, order 0.5 min, walking by distance, `wait` N).
- **Determinism.** Seeded PRNG for lab turnaround, measurement noise, staff timing and probabilistic harms. LLM wording varies, but simulation state only changes through validated structured actions. The waiting-room crowd (`server/sim/ambient.ts`) draws from its own seed stream and only ever changes the 3D view, so it can't shift a clinical outcome.

## 3D client

`client/src/world/` implements `WorldApi`; React and the HUD never touch three.js directly.
- **Renderer and lighting:** `render/renderer.ts` (WebGPU, quality presets, GTAO, bloom, TRAA) and `render/lighting.ts` (one light per fixture, clustered).
- **Building:** `builder.ts` and `props.ts` build it from the shared floor plan (`shared/layout.ts`).
- **People:** `avatars.ts` (Rocketbox glTF, mocap, postures, head look, voice-driven nods) and `casting.ts` (which avatar plays whom).
- **Interaction and navigation:** `controls.ts`, `pathfinding.ts` and the labels layer are renderer-agnostic.

See [ART_DIRECTION.md](ART_DIRECTION.md) for the pipeline, assets and licenses.

## Simulation

- **Physiology** (`server/sim/physiology.ts`). Per-variable baseline plus integrated disease drift. Drift is multiplied by treatment effects that switch on after an onset delay and ramp in (negative multipliers mean recovery). Treatment deltas have ramp and wear-off. Triggers fire on thresholds or on time-unless-treated (e.g. VT at 75 min unless reperfused). Stepped per game minute and cached. Variables: HR, SBP/DBP, RR, SpO₂, temperature, pain, GCS, glucose, lactate, creatinine. Labs are static, physiology-linked (`{var: 'lactate'}`) or kinetic curves (troponin sigmoid, piecewise series).
- **Orders** (`server/sim/session.ts`). Each category has its own pipeline:
  - **Labs:** collection task (nurse or tech, whoever is less busy; draws are batched), then the lab, then results within the catalog turnaround window (STAT runs faster). Critical values trigger a phone page.
  - **Imaging:** scheduling, then transport to CT or X-ray, then the scan, then the read and a final report note. CT/XR in women 12–55 is held until a pregnancy test results. Radiology can refuse studies.
  - **Meds:** pharmacy verification, then a nurse task, then the MAR and physiology effects. Allergy cross-reactions are checked against the *true* allergies.
  - **Nursing:** monitor, IV, vitals with temperature, O₂, NPO, and so on.
  - **Consults:** must be completed by phone.
- **Staff** have task queues, walking time and an `activity` label shown in 3D. Nurses do routine vitals; monitors record every 15 min.
- **Staff errors** (per scenario). Each is catchable through ordinary play:
  - *missing_triage_vital*: caught by having vitals rechecked.
  - *abx_before_cultures*: the nurse announces it, giving a 3-minute window; caught by telling her "cultures first".
  - *wrong_patient_med*: the nurse announces the look-alike name; caught by challenging her ("stop — check the wristband").
- **Patient flow:** arrivals (EMS or walk-in, with triage note, EMS sheet and triage vitals), family arriving later, imaging trips, disposition, then departure. Admissions need an accepting team. Low-acuity patients nobody sees will complain and eventually leave without being seen.

## NPCs

- **Persona = facts + behavior.** Each fact has an id, first-person text and keywords. The prompt lists *only* these facts and forbids inventing medical information (a pre-build latency test showed Haiku happily invents family history otherwise).
- **Structured output** for every NPC turn: `{say, emotion, revealed[], counseled[], actions[]}`.
  - `revealed` drives the "key history elicited" score.
  - `counseled` detects whether the doctor explained the plan, return precautions, and so on.
  - `actions` are validated against a per-NPC allowlist: verbal orders (enum of order codes), vitals, cultures_first, stop_med, step_out, consent, accept/decline, fax_records, deny_auth.
- **Per-turn `[Situation]` note** carries the dynamic truth that NPC may know. A patient gets their pain, feelings driven by physiology (light-headed if SBP < 95), who is in the room, and what they were given. A nurse gets her patients' charts and her task list, including the error she is about to make. A consultant gets ED chart summaries and whether the server-side acceptance prerequisites are met. System prompts stay stable, so they're cacheable and warm sessions can be reused.
- **Guards over the LLM.**
  - Consult acceptance is checked against case rules (e.g. cardiology can't accept a cath lab until an ECG exists).
  - GP facts only count after name + DOB have been given (checked deterministically).
  - Verbal orders go through the normal order pipeline.
- **Everyone can be talked to, but not everyone is on the record.** Ambient staff (registration, security, housekeeping, the cafeteria, the clinic) and the waiting-room crowd still make scripted barks on their own, and E on any of them opens the tablet for small talk (`server/npc/smalltalk.ts`, personas in `content/smalltalk.ts`): a waiting patient knows their own complaint and their wait, staff know their jobs, nobody knows anyone's case or takes a clinical order. Those chats cost no game time, write nothing to the log, the score or the AI agents' observations, and draw nothing from the seeded stream (`tests/smalltalk.test.ts`).

## Voices

NPC speech is synthesized **on the game server** with Kokoro-82M (`onnx-community/Kokoro-82M-v1.0-ONNX`) via kokoro-js, transformers.js and ONNX Runtime on the CPU. It runs in a worker thread (`server/tts/worker.mjs`), so the 100 ms simulation loop never waits on it.
- **Lazy loading.** The model loads the first time a session turns voice on. It is cached in `~/.cache/GTAgentClinic/models` (`AGENTCLINIC_CACHE_DIR` / `XDG_CACHE_HOME` override this), outside the repo. The fp32 download is 326 MB once. The voice files ship inside kokoro-js.
- **Pipeline** (`server/tts/index.ts`):
  - When a speech event is emitted, the server casts the voice from content and turns the line into speech text (`shared/speechText.ts`). That step drops stage directions like `*sighs*`, spells out what eSpeak misreads ("IV" as "roman four", "94/56", "x4410", phone numbers read as ranges, OR/AKI/COPD read as words), and splits the line into sentence chunks with a short first chunk.
  - Each chunk is queued as a clip, first sentences ahead of continuations, with id = hash(voice + speed + text). The clip ids travel in the event: `voice: {id, speed, clips[], phone}`.
  - The worker returns PCM. The main thread levels it to about −21 dBFS (raw voices differ by ~9 dB), fades the edges and encodes 24 kHz 16-bit WAV, about 1.6 ms per clip. Clips are kept in a 64 MB LRU.
  - Routes: `GET /api/tts/:clipId` (held until the clip is ready), `POST /api/tts {text, voice, speed, priority?}` → WAV for ad-hoc use (`priority: "background"` queues it behind every NPC line: the soundscape's pages, TV and radio host), `GET /api/tts` → status.
- **Client** (`client/src/ui/speech.ts`):
  - One AudioContext, resumed on the first gesture.
  - Each speaker has a queue whose clips are scheduled on the audio clock, so sentences join without gaps and lines never overlap even when the main thread stalls.
  - Phone lines get a 300–3400 Hz band-pass. Turning 🔊 off stops everything.
  - The 3D world reads `speechLevel(key)` (AnalyserNode, smoothed 0..1) and `isSpeaking(key)`, keyed by npc id or `phone:<contactId>`.
  - **Fallback.** While the model downloads or loads, if it fails, or with `--tts browser`, lines use `speechSynthesis`. `voicePick.ts` blocks the macOS novelty and Eloquence voices, prefers Premium/Enhanced/Natural/Google/Microsoft Online voices, matches the cast voice's sex and accent (af/am → en-US, bf/bm → en-GB), and keeps pitch at 1 ± 0.04 and rate at 0.95–1.05 per NPC.
- **Casting** (`voice` on StaffDef, FamilyDef, PhoneContactDef and the case patient; `openingVoice` for answering services):
  - Voices are authored, never inferred from names. Uncast patients fall back on chart sex and age.
  - Tests require every speaker to be cast, every patient's voice to match their chart sex, and people who share a floor to have distinct voices. Elderly speakers are slower (0.86–0.93).
  - Phone contacts may reuse voices of bark-only extras; the band-pass separates them further.
- **Measured** (M1 Max, ORT 1.21 CPU EP, 2-sentence lines of 6–7 s audio, real-time factor = synthesis time ÷ audio time):

  | dtype | download | RTF, default threads | RTF, 6 threads | RTF, 8 threads |
  |---|---|---|---|---|
  | **fp32** (default) | 326 MB | 0.25 | 0.215 | 0.18 |
  | fp16 | 163 MB | 0.26 | 0.23 | 0.21 |
  | q8 | 92 MB | 0.60 | — | 0.58 |

  - q8 is about 3× slower on ARM64 (int8 kernels).
  - The server uses 6 intra-op threads (cores − 4, leaving room for the browser's 3D rendering; `AGENTCLINIC_TTS_THREADS` changes it).
  - Load from cache: 1.0–1.2 s. Cold first line (spawn, load, synthesis): 2.7 s.
  - Warm: the first sentence is audible 0.6–1.1 s after the event, and a 2-sentence line is complete in about 1.5 s. Cached clips return in milliseconds.
  - Server RSS: +0.75 GB once loaded, plateauing at 1.0–1.3 GB above idle after synthesis. `AGENTCLINIC_TTS_DTYPE=q8` roughly halves that on small machines.
- **Licenses.** Kokoro-82M weights, kokoro-js and transformers.js are Apache-2.0; ONNX Runtime is MIT. The `phonemizer` package is labelled Apache-2.0 but embeds eSpeak NG (GPL-3.0-or-later) as WASM. It runs server-side only, never in the client bundle, but review it before redistributing a packaged build.

## Soundscape

`client/src/audio/` gives the department its sound. It uses the voices' AudioContext and listener (`speech.ts` → `sharedAudio()`). Every source is positional and goes through a wall low-pass like the voices: 0 walls, open; 1 wall, 1.1 kHz and −6 dB; 2 or more, 480 Hz and −11 dB. Ambience pans equal-power; HRTF is used only for the two nearest alarming monitors. What is synthetic in reality is synthesized: tones, rings, beeps, hums, noise beds. Each sound is rendered to a buffer once, in idle time, so a beep or a step costs one buffer source. No recordings are used except the radio's music.
- **Bedside monitors** (`monitors.ts`, `clinical.ts`, `heartbeat.ts`). Only patients on continuous monitoring (`PlayerView.monitors`) have one running.
  - **QRS tone.** One beat clock per patient is shared by the 3D monitor's sweep, the monitor panel and the tone, so each beep lands on its drawn R wave. The beep follows the R wave by 30 ms (detection delay) and is scheduled at least 1 s ahead on the audio clock (up to 1.6 s while frames come slowly), so a stalled frame never drops a beat. Beat-to-beat variability is ±3 % in sinus rhythm; AF is irregularly irregular (RR 0.55–1.45 × the mean). There is no tone in VF or asystole.
  - **Pitch follows SpO₂.** It is log-linear: 662 Hz at 100 %, an octave lower per 24 %, i.e. half a semitone per 1 % step. This is the typical pulse-oximeter mapping described in Philips' patent US10687763, about 19 Hz/% near 100 %; commercial oximeters measure 4–21 Hz/%. The pitch is clamped at 50 %.
  - **Alarms** follow IEC 60601-1-8 general alarm signals.
    - High priority: 10 pulses (3 + 2, pause, 3 + 2). td = 125 ms, x = 85 ms, a 2x + td gap after pulses 3 and 8, 0.6 s between pulses 5 and 6, a 3.5 s interburst interval, f0 = 659 Hz.
    - Medium priority: 3 pulses. td = 180 ms, y = 160 ms, a 9 s interburst interval, f0 = 523 Hz, −4.4 dB relative to high.
    - Both have the fundamental plus four harmonics within 15 dB of it (300–4000 Hz), and rise and fall over 15 % of td. `tests/soundscape.test.ts` checks every value against the standard's ranges.
  - **Alarm conditions.** `shared/alarms.ts` is the one table behind the server's banner text and the tones.
    - Yellow: SBP < 90, HR < 45 or > 140, SpO₂ < 90.
    - Red: SBP < 70, HR < 40 or > 160, SpO₂ < 85, and VT, VF or asystole.
    - The tone starts after an alarm delay (2 s red, 5 s yellow) and stops 2 s after the condition clears.
    - The banner flashes red at 2 Hz or yellow at 0.6 Hz.
  - **Audio pause.** Opening the monitor panel is pressing its alarm-pause key: AUDIO PAUSED for 2 min, shown as 🔕 with a countdown on the monitor. A later escalation to red breaks through. A nurse silences an unattended yellow alarm after 40–80 s; a red one sounds until you come.
  - **NIBP.** The cuff inflates and deflates (~26 s) every 15 game minutes.
  - **Fixed alongside:** the 3D monitor's sweep never drew the QRS complex or the pleth upstroke (it sampled 0.3 s past each beat), and ran ~3 % fast.
- **Rooms** (`ambience.ts`).
  - The HVAC bed (pink/brown noise) changes with the room kind: a lower corner and less air in offices, more air in resus and imaging, the exhaust fan in restrooms, and a setback in a closed clinic.
  - Equipment hum is 120 Hz and its harmonics (60 Hz mains) plus fan noise. Vending machine and fridges have compressors that cycle with a start clunk. The CT gantry has its cooling, and the station's computers and the medication dispenser hum too.
  - Outdoors you hear traffic and air, which also leak in through an exterior door while it stands open.
- **Department life** (`life.ts`, `movement.ts`, `outside.ts`).
  - **Phones.** Desk phones (2 s on / 4 s off) ring at the station and in the workroom every few minutes. If staff are within 8 m, the nearest picks up after 2–3 rings and greets the caller in their own cast voice. Otherwise the phone rings out. Phones never ring while you're on that phone.
  - **Printers and pumps.** The printer runs a job now and then, and the label printer runs when labs are ordered. Infusion pumps alert only where the chart shows a running infusion, until a nurse comes.
  - **The station.** Staff seated at desks type. The nurse-call chime sounds when patients are roomed, and pneumatic-tube carriers arrive at the station.
  - **Elsewhere in the building:** carts and doors 12–30 m away.
  - **Footsteps** for the player and every walking NPC. Cadence is 1.55 + 0.25 × speed steps/s. The surface sets the sound: sheet vinyl (rubber soles that sometimes squeak), asphalt or concrete stairs. Steps are heavier when running and when landing a jump.
  - **Automatic doors.** The operators whir open for someone approaching within 1.5 m, stay open while someone stands in the threshold, and close 2.8 s after.
  - **Outside.** Now and then a siren is heard. It either passes on the road (Doppler, distance and air absorption) or approaches and switches off a block away, as ambulances do near a hospital at night. When EMS walks in, their ambulance in the bay sounds: reversing alarm, rear doors, stretcher. (A synthesized diesel idle was removed: playtesters heard it as a chainsaw.)
- **Spoken** (`spoken.ts`, `radio.ts`).
  - Spoken ambience uses `POST /api/tts` with background priority. It plays only while voices are on and the model is ready; with voices off, the rest plays without it.
  - **Overhead pages** are routine only, never a code. They come every 4–8 min by day and 10–20 min at night. The operator says each twice, through a ceiling-speaker chain (24 dB/oct band-pass 300 Hz–4.5 kHz, cone peak, a little drive, two delayed speakers, a 0.85 s room reverb). A page waits for a gap in NPC speech.
  - **The waiting-room TV** runs a fictional local channel, with news and weather through a TV speaker. Its screen shows each headline.
  - **The station radio** plays a classical station on a virtual broadcast timeline, so the piece has moved on when you come back. It plays CC0 recordings (the Open Goldberg Variations; see [ART_DIRECTION.md](ART_DIRECTION.md#assets-and-licenses)), loaded as blobs so seeking needs no HTTP Range support. The host back-announces and gives the time.
- **API for other systems** (documented at the top of `soundscape.ts`):
  - `playSound(nameOrUrlOrBuffer, { at | npc, loop, gain, rate, range, hrtf, delay })` returns `{ stop, setGain, playing }`.
  - `startAmbience(name, spec?)` / `stopAmbience(name)`: built-ins `radio`, `tv`, `traffic`, `hvac`, `paging`, or your own looping sound.
  - `overheadPage(text, { priority: 'routine' | 'stat', repeat })`.
  - Built-ins include `phone.mobile`, `phone.vibrate`, `earbuds`, `thud`, `footstep.run`, `cart`, `door.close`, `pump.alarm`, `alarm.high` and `siren.approach`.
- **Settings and battery.**
  - The HUD's 🎚 button sets Off / Low / Med / High (−10 / −5 / 0 dB), stored in `localStorage["ac.ambient"]` and independent of 🔊.
  - The context is suspended while the tab is hidden; a voice line arriving meanwhile waits until the tab is back. It is also suspended when ambience and voices are both off.
  - Sources beyond earshot are parked, and idle emitters disconnect. Slow layers update 4–10 times a second.
  - Parameters glide with ramps that end and panners move by plain value updates, never `setTargetAtTime`: Chrome computes a parameter that is still automating per sample (filter coefficients, panning).
  - Measured in headless Chromium on an M1 Max (`tests/audio-e2e.ts`): 0.10 ms of main thread per sound frame (median, worst 0.2–0.3 ms; ~0.3 % of a core at 30 frames/s). The browser's total CPU with ambience on was within ~3 points of one core of ambience off, inside the run-to-run noise of the 3D rendering. Rendered sounds take about 14 MB (24 kHz).

## LLM providers

| Provider | When | Notes |
|---|---|---|
| `claude-code` | only with the player's own choice (yes to the first-run question of `npm start`, `--llm claude-code`, `AGENTCLINIC_LLM`, or `"claudeCode": true` in the git-ignored `agentclinic.local.json`), then if `claude auth status` says logged in | Warm, sandboxed `claude -p` per conversation (stream-json; `--tools ""`, `--safe-mode`, `--strict-mcp-config`, `--no-session-persistence`, `--json-schema`), LRU pool of 4. Measured: ~3.2 s cold, ~1.1–1.4 s per warm turn, ~245 MB per process. **For personal/local use with your own login.** |
| `anthropic-api` | `auto` when `ANTHROPIC_API_KEY` is set (or `--llm api`) | `claude-haiku-5-5`, `output_config.format` JSON schema, effort `low`, cached system prompt. Right for hosted/public deployments (operator key behind a relay). |
| `offline` | `auto` without a key; tests, fast RL | Deterministic keyword retrieval over persona facts and intent rules. |
| *(planned)* local GPU | — | OpenAI-compatible endpoint (vLLM/Ollama) behind the same `LlmProvider` interface. |

**Usage accounting** (`server/usage.ts`, `server/llm/pricing.ts`). Every NPC turn records input, output, cache-read and cache-write tokens, model, latency and cost per session, NPC, process, day and all-time (`data/usage.json`, plus `usage` in each run log).
- **claude-code:** reads the `result` event. Per turn, `model_usage_since_last_result` includes Claude Code's own list-price `costUSD`. `total_cost_usd` and `modelUsage` are cumulative per process. `--json-schema` is a forced `StructuredOutput` tool call that ends the turn, so it adds one API request per NPC turn, not two.
- **Subscription window:** a `rate_limit_event` carries the plan window utilization (e.g. 7-day 29%), which the HUD shows.
- **anthropic-api:** prices `res.usage` with the list-price table.
- **Measured (Haiku 5.5):** about 3–5k prompt tokens per turn, nearly all prompt-cached, plus 200–500 output tokens including adaptive thinking. That is ≈ $0.0003–0.0004 per warm turn and ≈ $0.001 for the first turn of a conversation, at list price.
- **Budget:** `--max-tokens` / `--max-usd` caps NPC usage per process, then NPCs fall back to the offline brain.

Policy (Anthropic Legal & Compliance, checked 2026-11-06): "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, Max, or Ultra plan credentials on behalf of their users." An end user signing in to the unmodified Claude Code binary with their own subscription is fine. So since v0.2, `auto` uses the player's own API key or offline NPCs, and the Claude Code login is an explicit personal opt-in that prints a startup notice (re-checked 2026-11-07, with the Agent SDK overview's "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products"; see [SETUP.md](SETUP.md#claude-code)). A hosted game should run on an operator API key behind a relay, or obtain approval.

## Scoring

Deterministic, from the event log (`server/sim/scoring.ts`), per case:
- **Diagnosis:** accept or partial synonym lists.
- **Secondary diagnoses**, e.g. RV involvement, AKI, delirium.
- **Disposition:** best, acceptable, or wrong.
- **History:** fraction of key facts elicited from any source, deduplicated by label.
- **Critical actions:** rule DSL covering order, given, collected, before, consult, fact, counseled, exam, ecg_signed/ecg_read, vitals, dispo, dx, flag, not/any/all/if, with time windows.
- **Harms and low-value tests:** penalties.
- **Resource cost** in USD.

Shift level: safety catches, a grade, and "replay the same seed". Runs are saved to `data/runs/<session>.json` (actions, event log, debrief) as trajectories for imitation learning and analysis.

## Multiplayer (next)

The session layer is already per-player and seed-deterministic. Planned:
- **Duel**: two players, same seed, separate sessions, live scoreboard.
- **Co-op**: shared session, multiple doctors with avatars, server-authoritative positions.
- **Leaderboards** per map and seed.
- **Humans vs AI** on the same shift.

## Roadmap

- **Content:** a hard map (aortic dissection masquerading as STEMI, PE in pregnancy, subdural on a DOAC, DKA); region packs (CH/DE/UK triage scales, units, drug names, insurance processes); a pediatric ED.
- **Imaging:** a real PACS viewer with openly licensed studies, plus bedside POCUS.
- **AI:** a Gymnasium wrapper (Python), FHIR export of charts (MedAgentBench-style), vision-agent mode with randomized rendering, and an LLM-judged communication rubric next to the deterministic score.
- **Realism:** shift handoffs (I-PASS), family meetings, interpreters, bed boarding, more error types (mislabelled specimens, missed allergy, wrong dose).
- **UX:** controller support, accessibility (captions are always on), localized voices.
