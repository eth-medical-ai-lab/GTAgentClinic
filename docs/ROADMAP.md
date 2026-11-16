# Roadmap: where to help

GTAgentClinic grows through contributors working with their own Claude Code. To take part:

1. Pick a track below and make a branch.
2. Start from the prompt given for that track. Claude Code reads [CLAUDE.md](../CLAUDE.md) on its own, with the code map and the rules.
3. Send a pull request.

Each track lists what exists, what's missing, the files to start from, and a prompt to paste into Claude Code. Every PR must pass the same checks:

- **Always:** `npm run typecheck`, and `npx vitest run`, which includes the AI-doctor and seed-determinism tests.
- **Visual work:** a storyboard scene and a clean audit ([VISUAL_QA.md](VISUAL_QA.md)).
- **Clinical content:** review by a clinician, signed off in the PR.
- **User-visible changes:** a line in the [CHANGELOG](../CHANGELOG.md).

## 1. New cases

**Exists:**
- A [playable catalog](cases/README.md) of original teaching cases and adaptations of published cases. All can be practiced alone or drawn into a mixed shift; five also feature in the fixed scenarios.
- A [case library](CASE_LIBRARY.md) of 51 published case reports with source evidence, including reports without a playable adaptation.

**Wanted:**
- Review the new cases clinically, deepen the existing encounters, and adapt further reports where the engine can represent their findings and decisions.
- Bread-and-butter ED cases: PE, DKA, stroke code, anaphylaxis, upper GI bleed, a febrile child, COPD exacerbation, overdose.
- One droplet-precaution case, such as influenza in a frail patient.

**Start from:**
- Guides: [CONTENT_GUIDE.md](CONTENT_GUIDE.md), [CASE_LIBRARY.md](CASE_LIBRARY.md).
- Code: `content/cases/urosepsis.ts` (a full example), `content/types.ts` (the schema), `content/scenarios.ts` (which shift a case appears in).
- `npm run cases` rewrites the case sheets in `docs/cases/`.

> Read CLAUDE.md, docs/CONTENT_GUIDE.md and content/cases/urosepsis.ts. Draft a new case `<id>`: `<one-line presentation>`. Include the hidden truth, persona and history facts, physiology and how it evolves with and without treatment, labs with realistic turnaround, imaging reads, belongings if they hold a clue, and scoring: critical actions with time windows, harms, low-value tests, and the best and acceptable dispositions. Add it to a scenario, run `npm run cases` and `npx vitest run`, then list every clinical choice I should review, with sources.

**Done when** the tests pass, a clinician has signed it off in the PR, and `npm run agent:demo` or a Claude agent can play it to a debrief.

To open this up to many clinicians, see [§7](#7-future-work-clinicians-adding-cases-at-scale).

## 2. Patient flow: admission and beyond

**Exists:**
- Dispositions end a case: discharge, observation, admit (floor, telemetry, step-down or ICU), OR, cath lab, transfer, AMA.
- Consultants by phone, escalation to the attending, and a Floor 2 ward with its own patients.

**Wanted**, each as an `Action` in `shared/types.ts` handled in `server/sim/session.ts`, so the 3D UI, REST and MCP all get it:
- **Admission as a process:** the bed request, the call to the admitting team with a structured handoff (SBAR or I-PASS), and boarding in the ED with orders still running. Then transport: the patient really rolls to Floor 2, with a nurse.
- **Shift change** with a handoff to the next doctor, scored on what was passed on.
- **Discharge:** instructions, prescriptions and follow-up, with bounce-backs for unsafe discharges.
- Bed management under load: the ED filling up, waiting times, the charge nurse asking for beds.

**Start from:** `server/sim/session.ts` (disposition, the clock), `server/sim/escalation.ts`, `client/src/world/ward.ts` and `upperFloor.ts`, and `content/scenarios.ts`.

> Read CLAUDE.md and how a disposition ends a case in server/sim/session.ts. Design "admission as a process" as new Action variants: bed request, admitting call with an I-PASS handoff, boarding, transport to Floor 2. Propose the state, the actions, what the debrief scores and the agent text, before writing code. Keep the AI-doctor and determinism tests passing.

## 3. Evaluation: deeper checkpoints

**Exists:**
- The single-player debrief (`server/sim/scoring.ts`) scores against the event log: critical actions with timing, the diagnosis, the disposition, harms, stewardship and safety catches.
- Infection control is recorded but unscored.

**Wanted:**
- **History:** which facts were elicited out of those that matter, and red flags asked about.
- **Exam:** completeness for the presentation.
- **Time to key actions:** ECG, antibiotics, reperfusion, analgesia, as distributions rather than pass/fail.
- **Communication:** explaining, consent, talking with family and breaking bad news, graded by an LLM judge against a rubric and calibrated on human ratings.
- **Documentation and handoff quality.**
- A reference behind every checkpoint, and inter-rater checks on a sample of runs.
- Clinical decisions still open: should gloves without hand hygiene first be flagged? Should belongings count as WHO moment 5? Should infection control be scored at all?

**Start from:** `server/sim/scoring.ts`.

## 4. Standardized experiments: humans and LLM agents on the same cases

**Exists:**
- A seed fixes arrivals, lab values, turnaround and staff behaviour.
- Agents play in step mode, so their thinking time costs no game time.
- Every human and agent run is saved in `data/runs/*.json`, with the full action list, the debrief and token usage.
- Agents: a scripted baseline (`npm run agent:demo`), your Claude Code as the doctor (`npm run agent:claude`), and REST and MCP for any agent ([AI_AGENTS.md](AI_AGENTS.md)). You can watch any agent's shift in 3D.

**Wanted for a first experiment, E0:**
- **A fixed protocol:** case set, seeds, time limit, NPCs offline or on one pinned model (so NPC wording doesn't confound), and the information each side gets.
- **An experiment runner** that plays N agents × M seeds headless and writes one table: score, checkpoints, time to key actions, harms, tokens and cost.
- **Study mode for humans:** a consent screen, no hints, fixed seeds, the run exported at the end.
- **Fair timing:** humans play in real time and agents in steps. Record both game time and wall time, and decide whether humans may pause to read.
- An analysis notebook.

> Read CLAUDE.md, docs/AI_AGENTS.md and agents/demo-agent.ts. Write `scripts/experiment.ts`: given a config (cases, seeds, agents, NPC mode, time limit), it starts its own server on a free port with `--llm offline --tts off`, plays every combination in step mode and writes `data/experiments/<name>/results.csv` plus the run logs. Start with the demo agent and the Claude agent.

## 5. How agents steer the doctor

In Clinical actions mode agents act at the semantic level: `move` to a room, then `talk`, `examine`, `order`, `inspect`, `give_item` and so on. The engine walks the AI doctor's avatar there and poses it for the 3D view (`server/sim/aiDoctor.ts`). Embodied mode runs the player client. The three control levels are:

| Level | The agent sees | The agent sends | Good for |
|---|---|---|---|
| **L1 semantic** (today) | Observation text: the patients, results, who is here, belongings | Clinical actions; walking is implied by `move` | Clinical reasoning. Cheap, deterministic, and the same clinical actions humans take in 3D |
| **L2 spatial** (next) | What is around it: people, objects, devices, with distances, and what is in reach and in view | `walk_to(entity)`, `face`, `interact(entity, verb)` with the 3D verbs (pick up, look at, give, use, sit, put down) | The 3D affordances: hygiene, belongings, devices. Still text, still deterministic in step mode |
| **L3 embodied** (available in Watch an AI doctor) | Rendered player view plus the HUD (over-the-shoulder by default) | Real input: WASD for a duration, mouse-look deltas, E/F/G/Esc | Vision-language-action agents, playing like a human |

Embodied mode captures the screen and limits the number of model turns. Its real-time clock includes model latency. A future lockstep option could pause the simulation during inference to isolate clinical and navigation skill. See the [embodied mode guide](AI_AGENTS.md#embodied-mode).

**Recommendation:**
1. Run E0 at L1.
2. Build L2 next. It makes the embodied parts of care measurable without vision.
3. Evaluate L3 on short, well-defined tasks: walk to Bed 4 and give Mrs. Brunner her handbag; clean your hands before entering a room; log in at a workstation.

## 6. Visual realism and known issues

Most bugs here are visual. The [VISUAL_QA.md](VISUAL_QA.md) loop (storyboards plus the audit) catches them before players do. Known issues in this preview:

- **Bodies:**
  - In third person with the tablet open at a bedside, the player's left hand sits 2–4 cm inside the trunk.
  - Seated waiting-room poses: a daughter's feet are 12 cm off the floor in the phone pose, and a hand goes 4 cm into a seat.
  - Lena's heel touches a chair caster.
  - The attending's workroom chair faces away from her screen.
- **Scene:**
  - EMS patients appear in the department from nowhere.
  - A tissue box on Bed 4's bedside table dips 1.8 cm into it.
- **Performance:** the hub runs at 35–39 fps where 50 is the target; it needs profiling.
- **Experimental, partly built:**
  - cupboards and drawers that open, some locked;
  - CT and X-ray rooms with a control room.
- **Designed, not built:**
  - **Mission control:** set the pace of arrivals, up to a mass-casualty surge.
  - FHIR export of the chart.
- **Withdrawn until it is ready:** hands-on bedside ultrasound (a cart at the bedside, the probe in your hand, a live image). Today the ultrasound views are text reads in the Examine tab.

## 7. Future work: clinicians adding cases at scale

The aim: hundreds of clinicians adding cases, most of them without git, Node or TypeScript. Claude writes the case. The clinician brings what only a clinician can: the point of the case (the trap, what residents miss, what changes management) and the sign-off.

**Exists:**
- The case prompt in [§1](#1-new-cases), the schema (`content/types.ts`) and a full example (`content/cases/urosepsis.ts`).
- Readable case sheets for review (`npm run cases` writes `docs/cases/`).
- Validation and benchmark hygiene, not built yet: a schema check against the clinical catalog, and consistency rules for hemodynamics, lab arithmetic, marker kinetics and ECG criteria.

**The idea: one loop from idea to signed case.**
1. **Interview.** A `/new-case` skill asks what a blank prompt misses: what do residents get wrong here, which clue is easy to miss, what harmful thing do people do, which guideline and region does the case follow.
2. **Draft.** Claude writes the `CaseDef`, adds it to a scenario and runs the checks.
3. **A review report, not a diff:**
   - the case sheet;
   - automated checks: lab consistency, kinetics, no diagnosis leak, every key fact reachable;
   - vital-sign curves, untreated and under guideline care;
   - dry runs: a guideline policy recovers, doing nothing deteriorates, each harm trips its flag;
   - how the scripted doctor and an AI doctor scored.
4. **Revise.** The clinician comments in plain language and Claude revises.
5. **Sign-off** by a second clinician, ideally from another institution. A case moves from draft to reviewed, signed and benchmark.

**Ways in, in this order:**
1. **Now:** the `/new-case` skill, for the first 10–20 clinicians who run Claude Code.
2. **Next:** a "propose a case" GitHub issue form. A Claude GitHub Action drafts the pull request and posts the review report in the thread, and clinicians answer there. It runs on an API key the lab pays for, never on someone's Claude Code login.
3. **Later, if the pilot shows the need:** a hosted case workshop where clinicians play their draft right away.

**Why clinicians would join:**
- **Credit:** consortium authorship on the benchmark paper with CRediT roles, a citable DOI per case, and "Case by …, reviewed by …" on the case sheet and in the debrief.
- **Use:** their case becomes playable for their own students. Simulation educators can convert the scenarios they already run.
- **Stump the AI:** see how frontier models handle your case. Record how each case was made: cases chosen because models fail on them bias the benchmark.
- **Case sprints:** half a day, 10–20 clinicians, one facilitator, about two cases each.

**Guardrails:**
- **No real patient data.** Fictional or composite cases only, with a required checkbox and an automated screen. Issues are public.
- **A private held-out set.** Public cases end up in training data. Benchmark cases are submitted privately, stay out of the public repo and carry a canary string.
- **Practice varies.** Each case states its guidelines and region, and the scoring accepts reasonable alternatives.
- **Editors.** A few specialty editors settle disagreements. New catalog items (drugs, tests) get a maintainer's review, because every case shares the catalog.

**First step:** build the `/new-case` skill and the review report, then run one case sprint with about 10 clinicians. Where they get stuck decides whether the issue form or a hosted workshop comes next.

## 8. Student rotations

Solo players can save a shift in five independent slots, build a locker, earn XP for case completion and improved scores, and pin a debrief objective for a replay. The debrief can open a draft scoring report or case pitch. See the [solo rotation guide](../README.md#solo-rotations-and-save-slots).

**Student pilot**

Compare ordinary solo play with a rotation in a small student pilot. Count how many students return within a week for another completed case, how many improve the objective they chose, and how many feedback drafts become actionable reports or case pitches. Measure active playtime alongside those outcomes. If sessions get longer while completions fall, ask students where they got stuck before adding rewards.
