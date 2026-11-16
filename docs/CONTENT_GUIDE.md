# Writing cases

Every playable patient resolves to a server-side `CaseDef` (`content/types.ts`). Register the case in [the case registry](../content/cases/registry.ts) and it becomes available to individual practice and mixed shifts. Give it a presenting complaint that makes sense before the workup. The shift supplies the bed and nurse; write pages using `{bed}` wherever the text names the patient's bay.

Use [a case brief](../content/cases/brief.ts) for a focused encounter, or [the urosepsis case](../content/cases/urosepsis.ts) for independently scripted relatives, phone calls and physiology. The two fixed teaching shifts can still specify a room, an arrival time and scenario events in `content/scenarios.ts`.

**Provenance:** Keep who created the simulation separate from what inspired it. An original case records its author (a contributor ID or the actual tool/model, plus reasoning setting if known), authoring file, method and review status. A sourced adaptation also records the dataset, record ID, original citation, URL and licence. For the PMC cases, the linked source JSON distinguishes reported findings from additions. Clinical references used to check an invented vignette do not make it a published patient. The five legacy cases leave missing authorship explicit. Run `npm run cases` to regenerate the [review sheets](cases/README.md).

**Choosing an external source:** Check the underlying publication and attachments before adapting a record. For example, the [MedSP1000 release](https://huggingface.co/datasets/byrLLCC/MedSP1000) identifies each MedEdPORTAL article and labels its own distribution MIT; the [source stroke simulation](https://www.mededportal.org/doi/10.15766/mep_2374-8265.10009) carries a noncommercial, share-alike licence. This catalog does not import MedSP1000 or credentialed MIMIC patient records.

## Checklist

1. **Patient & presentation.**
   - Demographics, appearance, PCP, insurance, emergency contact.
  - Appearance drives the 3D character. The realistic avatar is chosen in `client/src/world/casting.ts`: authored per NPC id, or a stable pick from a pool matching role, outfit and age. You can also set `appearance.avatar` to a file name from `client/public/res/chars/index.json`, or to `{ id, scrubs: '#hex', skin: '#hex', hair: '#hex', grey: 0..1 }` for scrub color, skin tone, hair color and greyed hair.
  - `items` (optional): belongings and documents at the bedside, e.g. `{ id, kind: 'medBag' | 'pillBottle' | 'handbag' | 'letter' | 'sportsBag' | …, label, where: 'bedside' | 'chair' | 'foot', text, facts: [...] , arrivesWith?: 'family' }`. Inspecting reveals `text` and credits `facts` as history. Good uses are a "brown bag" medication review that exposes an undisclosed drug, or a prior culture result in a GP letter.
  - Rule: characters wear no religious symbols or garments. `tests/casting.test.ts` enforces this for the cast, the avatar set and accessories.
   - Triage note and vitals.
   - Patients walk to the exit after a home discharge by default. Set `presentation.dischargeMobility` to `'wheelchair'` for a patient who needs an escort. The player can also request one at discharge.
   - *Documented* allergies and home meds. These may differ from `truth.allergies` and from what family or the GP know, which is how you create med-rec discrepancies.
   - Problem list, prior encounters, historical labs.
2. **Truth.**
   - Diagnosis label and ICD-10.
   - `accept` and `partial` synonym lists, matched as lowercase substrings, so make them generous.
   - Best and acceptable dispositions.
   - Good and bad outcome narratives.
3. **Persona** (patient, family, phone contacts):
   - `facts`: one idea each, written in the NPC's own first-person voice. `keywords` drive offline matching. Mark the ones you want scored with `key: true` and a short `label`. Facts with the same label across sources are deduplicated in scoring, so "baseline cognition" from the daughter or the GP counts once.
   - `unknowns`: what they don't know. Patients never know their diagnosis or results.
   - `behavior`: disclosure rules, e.g. "only admit the sildenafil if asked about ED pills; hesitate if your wife is present".
   - `counseling`: what the doctor should explain, scored when the NPC sees it addressed.
   - `actions`: allowed side-effects (`consent`, `step_out`, `fax_records`, …).
   - `capacity: 'impaired'` gives delirious or unreliable historians.
   - **Voice casting.** Put a `voice: { id, speed? }` on the patient (`patient.voice`), the family member and each phone contact, choosing from the Kokoro voices in `shared/voices.ts` (af/am = US female/male, bf/bm = UK female/male). Use `speed` ≈ 0.85–0.95 for elderly speakers, and `openingVoice` when an answering service picks up first. Choose deliberately; nothing is inferred from names. `npm test` checks that everyone is cast, that the patient's voice matches the chart sex, and that people on the same floor sound different.
4. **Consults.** Per contact (`cards`, `surg`, `hosp`, `icu`, …):
   - Natural-language `criteria` for the LLM consultant.
   - A deterministic `guard` rule (e.g. an ECG must exist).
   - `onAccept` effects: a physiology tag after N min, disposition, departure, consult note.
5. **Physiology.**
   - Baseline, drift per hour, limits and noise.
   - `effects` keyed by intervention tag. Med tags live in `shared/catalog.ts`; special tags are `reperfusion`, `surgical_care`, `rice`, `brace` and `oxygen`.
   - `delta` (with onset, ramp and wear-off) for symptomatic effects. `driftMult` for disease-modifying effects; a negative value means recovery.
   - `harm` for treatments that hurt *this* patient (flag + page, optional probability).
   - `triggers` for deterioration pages, VT runs, arrests and perforation.
   - Check trajectories with a quick script (see `tests/sim.test.ts`). Untreated vs treated should look clinically plausible over 4 h.
6. **Labs.** For each analyte that matters: a number, a string, `{var}` (physiology-linked) or a curve. Unspecified analytes default to mid-normal for the patient's sex.
7. **Imaging.** Findings + impression per order code; `blocked` makes radiology refuse a study, and `criticalCall` makes them phone you.
8. **ECG.**
   - Params: rate, rhythm, intervals, axis, per-lead ST deviation in mm.
   - Machine read, and `readKeywords` for grading the physician read.
   - Optional right-sided version; `autoAtMin` for triage protocol ECGs.
9. **Exam.** Overrides per maneuver id (`shared/catalog.ts → EXAM_MANEUVERS`). Variants can depend on physiology (e.g. mottling when SBP < 85).
10. **Scoring.**
    - Points for dx, dispo and history.
    - `critical` actions written in the rule DSL, with time windows (relative to arrival).
    - `harms`, `lowValue` groups with a one-line "why", and `secondaryDx`.
11. **Teaching & references.** 3–6 crisp teaching points and guideline-level references (shown in the debrief).

## Clinical quality bar

- Values, units and turnaround must survive review by an emergency physician. Reference ranges come from `shared/catalog.ts`; prefer them over ad-hoc values.
- Every trap should be *discoverable* through realistic behavior: asking the right question, calling the GP, reading the chart, examining. Avoid gotchas that only a guess can solve.
- Scored "harms" should reflect consensus guidance (cite it in `teaching`), not local preference.
- Run `npm test`, then play the case once with offline NPCs and once with an LLM, and read the debrief critically.
- Run `npm run cases` after editing a case or map. It regenerates the readable case sheets in [docs/cases/](cases/README.md), including the untreated course and lab kinetics, which are a quick plausibility check. `npm test` fails while the sheets are stale.
