# Case library

The case library is a collection of emergency-medicine vignettes, each grounded in one published, openly licensed case report from PubMed Central (PMC), found through Europe PMC. Each case carries a few multiple-choice questions and can seed a future playable case.

A library case is a structured, citable summary of a real report, with marked additions and 2–4 questions. Selected reports also have [playable adaptations](cases/README.md), with patient dialogue, findings and scored actions. Adding a library record alone does not register it for 3D play.

Reviewer sheets, one page per case, are in [docs/library/](library/README.md).

## Files

| Path | What |
|---|---|
| `shared/caseLibrary.ts` | Schema (`LibraryCase`) and the grounding rules |
| `content/library/<id>.json` | One case per file |
| `content/library.ts` | `loadLibrary()`, `byCategory()`, `libraryCase(id)`, plus field-path and grounding helpers |
| `scripts/library/fetch-europepmc.mjs` | Europe PMC search, full-text cache, citation and licence, quote verification, JSON formatter |
| `scripts/library/sheets.ts` | Generates `docs/library/*.md` and the licence table below |
| `tests/case-library.test.ts` | Schema, licence, grounding, questions, plausibility, flags, quote cross-check, sheet freshness |

`loadLibrary()` reads the JSON files at runtime and works in Node only, for the server and tools. It returns cases sorted by id. `byCategory()` returns a `Map` in the category order of the schema.

## Grounding rules

These rules come from the doc comment in `shared/caseLibrary.ts`. The test enforces them.

1. **Open licence only.**
   - Allowed: open-access articles under CC BY (any version) or CC0.
   - Rejected:
     - NC, ND or SA licences;
     - "free to read" articles without a licence;
     - publisher-specific terms.
   - Each case records the citation, the licence with its version, the URL, and the PMCID, PMID and DOI.
   - Library records and the cases adapted from them are released under CC BY 4.0 ([LICENSE-CASES](../LICENSE-CASES)). NC, ND or SA sources would restrict that release, which is why they are rejected.
2. **Read the full text, then paraphrase.**
   - The case is a structured paraphrase.
   - The only verbatim text is in the short `evidence` quotes.
   - Full texts stay in the local cache (`~/.cache/GTAgentClinic/library`) and are never committed.
3. **Every fact is either quoted or flagged.**
   - Each fact-bearing field needs one of two things:
     - an `evidence` entry: a quote from the source, under 30 words;
     - an augmentation flag.
   - Fact-bearing fields are:
     - patient age, sex and arrival mode;
     - chief complaint and HPI;
     - each PMH, medication and allergy item;
     - social and family history;
     - each vital sign;
     - each exam line, investigation, imaging study and management step;
     - the ECG, diagnosis and outcome.
   - These core facts must be quoted and can never be augmented: age, sex, chief complaint, HPI, primary diagnosis and outcome.
4. **Quotes are verbatim.**
   - Copy them from `fetch-europepmc.mjs show <PMCID>`.
   - Quote matching ignores case, whitespace, and dash and quote styles.
   - `…` marks an elision; each fragment must appear in the source, in order.
   - When the cache is present, the test looks up every quote in the cached source text.
5. **Numbers match their quotes.**
   - Results keep the source's own units and values.
   - The test checks that each quoted vital or numeric result appears in its quote. Temperatures may be converted from °F.
   - Where the report gives no exact figure ("tachycardic", "HR in the 120s"), choose a consistent value and flag it, e.g. `"vitals.hr: report says tachycardic"`.
6. **Allowed augmentation** keeps the case playable. Examples:
   - unreported normal labs;
   - exact vitals where the text only describes them;
   - medications, allergies and social history consistent with the case;
   - a normal ECG where none was reported;
   - a GCS derived from "alert and oriented".

   Mark each finding or imaging item `"augmented": true`, or list its path in `augmented` with a short note.
7. **Forbidden augmentation:**
   - changing the diagnosis, the key findings, the timeline or the outcome;
   - adding abnormal results that steer toward (or away from) the diagnosis when the report does not give them;
   - contradicting the report in any way.
8. **Flags** are H, L or `critical`, against adult reference ranges.
   - Where `shared/catalog.ts` has the analyte, its ranges apply (the test checks them, with a 2% margin).
   - `critical` matches the catalog's critical limits.
   - Pediatric cases use age-appropriate judgment; the adult check is skipped.

### Field paths

The `evidence[].field` and `augmented[]` entries name fields with paths:

- `presentation.chiefComplaint`, `presentation.hpi`, `presentation.meds[1]` (or `presentation.meds` for the whole list)
- `vitals.hr`, `vitals.sbp`, `vitals.tempC`, …
- `exam[2]`, `management[0]`, `imaging[1]`, `ecg`, `outcome`, `diagnosis.primary`, `patient` (age and sex), `patient.arrival`
- `investigations[3]`, or by name: `investigations[Potassium]`

One evidence entry can serve several fields, separated by commas: `"vitals.hr, vitals.sbp, vitals.dbp"`.

An `augmented` entry is a path, optionally followed by `: note`, e.g. `"presentation.social: not reported"`. Investigations and imaging items may instead carry `"augmented": true` inline.

## Writing a case

- **Title:** short and neutral, with no diagnosis. "Sudden paraplegia after a fleeting chest pain" is right; "Aortic dissection presenting as paraplegia" is not. The test rejects titles, chief complaints and HPIs that contain the main diagnosis term.
- **HPI:** what the patient, the family, EMS or the referring team tell you before the ED workup. It contains no diagnosis and no ED results.
- **Exam:** ED findings, one finding or system per line. Later bedside findings may say when they occurred ("6 h after arrival: …").
- **Investigations:** one result per entry, in the source's units. Use text values where the report gives no number, e.g. `"High anion gap metabolic acidosis with raised lactate"`. Imaging goes in `imaging`; the ECG goes in `ecg`.
- **Diagnosis:** the report's final diagnosis, coded in ICD-10-CM as the playable cases are. Give 2–5 real differentials that were considered or that a clinician would weigh.
- **Management and outcome:** what was actually done and what happened, in order.
- **Acuity:** the ESI level (1–5) that is right at arrival. This is an authoring judgment, not a fact taken from the source.
- **Id:** `pmc-<PMCID>-<short-slug>`, which is also the file name. Ids are internal, so the slug may name the diagnosis.

### Questions

Each case has 2–4 multiple-choice questions.

- **The stem** is the patient, the presentation, the vitals and the exam.
  - Investigations, imaging, the ECG and the diagnosis are not assumed to be visible.
  - Whatever a question needs beyond the stem goes in `extra`, e.g. `"ECG: 2–3 mm ST elevation in II, III, aVF"`.
  - Questions are shown in order, so a later `extra` may reveal an earlier answer. A diagnosis question usually comes first.
- **Kinds:** `diagnosis`, `next-step`, `interpretation`, `management` and `risk`. Use at least two different kinds per case.
- **One clearly best answer.**
  - Four plausible options of similar length and specificity.
  - No "all/none of the above".
  - Vary the position of the correct answer; the test checks the spread across the library.
- **Explanation:** 1–3 sentences on why the answer is right and the main distractor wrong. Name the guideline where one applies (ESC, AHA/ACC, AHA/ASA, Surviving Sepsis Campaign, NICE, ACEP, ADA, EAACI/WAO, ATLS, …). Cite at the level you are sure of: the guideline and its recommendation, not invented class or level numbers.

## Adding a case

```sh
node scripts/library/fetch-europepmc.mjs search '"thyroid storm" AND emergency' --n 20   # CC BY / CC0 open-access case reports
node scripts/library/fetch-europepmc.mjs fetch PMC1234567       # caches XML, plain text and metadata; checks the licence
node scripts/library/fetch-europepmc.mjs show PMC1234567        # read the full text (add --grep <regex> to search)
node scripts/library/fetch-europepmc.mjs cite PMC1234567        # prints the `source` block
# write content/library/pmc-PMC1234567-<slug>.json
node scripts/library/fetch-europepmc.mjs verify content/library/pmc-PMC1234567-*.json   # every quote found in the source
node scripts/library/fetch-europepmc.mjs fmt                    # canonical compact layout
LIBRARY_ONLY=pmc-PMC1234567 npx vitest run tests/case-library.test.ts
npm run library                                                 # regenerate docs/library and the licence table
```

`npm run library:fetch -- <command>` runs the fetch tool, and `npm run library:check` reports stale sheets.

When choosing a source, prefer reports that:

- give real vitals and lab values;
- turn on an ED decision, such as a missed or atypical presentation or a time-critical treatment;
- state the outcome.

Avoid:

- reports that only describe surgery or pathology;
- extremely rare zebras with no teachable pattern;
- series that pool several patients.

Requests to Europe PMC are throttled across processes to about 2.5 per second.

## How grounding is verified

`tests/case-library.test.ts` runs these checks on every case:

- **Schema and plausibility**
  - Schema and required fields.
  - Vitals are physiologically plausible.
  - ICD-10-CM format.
  - Ages under 2 years carry `ageMonths`.
- **Source**
  - The citation, licence and URL are present.
  - The licence is CC BY or CC0.
  - Ids, PMCIDs and DOIs are unique.
- **Questions**
  - Each case has 2–4 questions, with at least two kinds.
  - Each question has 4 distinct options, a valid answer index and an explanation of 20–600 characters.
  - The correct option does not stand out by length.
  - Across the library, correct answers are spread over the four positions.
- **Spoilers:** the main diagnosis term does not appear in the title, chief complaint or HPI.
- **Grounding**
  - Every fact-bearing field is either quoted or flagged.
  - Core facts are quoted.
  - Each quote is under 30 words; table-cell `|` separators and `…` don't count.
  - Field paths resolve.
- **Numbers:** each quoted vital and numeric result appears in its quote.
- **Flags:** H/L/critical match the adult ranges in `shared/catalog.ts`, with a margin of 5% of the range width.
- **Cache cross-check:** when the cache is present, every quote must occur in the cached full text and the licence must match the article XML.
- **Layout:** each file is in the canonical layout.
- **Sheets:** the reviewer sheets and the licence table are up to date.

`fetch-europepmc.mjs verify` runs the cache checks with near-miss hints.

Each case was also clinically reviewed for:

- answer correctness;
- distractor plausibility;
- whether each guideline citation says what the explanation claims;
- terms not found in the source text, a heuristic that found only synonyms such as "Osler–Weber–Rendu" written as "HHT".

## Conventions for awkward sources

- **Unit misprints.** Examples: "HCO3 16 mmHg", "lactic acid 3.1 mg/dL" called lactic acidosis, and TSH in "IU/mL". Keep the value, use the intended unit, and add an `augmented` note such as `investigations[2]: source prints 'mmHg'; mmol/L intended`. If the intended unit is unclear, leave the value out.
- **Internal contradictions** (abstract vs. body, text vs. table): quote the more specific passage, usually the case section or table. Leave out values that cannot be reconciled.
- **Vitals that are "unmeasurable" or only described:** enter a consistent value, flag it, and keep the description in an exam line. Cases that arrive in cardiac arrest don't fit, because first vitals must be plausible; take a source whose patient has measurable vitals.
- **Tests with no field of their own** (EEG, CSF, point-of-care ultrasound): put them in `investigations` as text results or in `imaging`. Supplemental oxygen goes in an exam line, e.g. "SpO₂ 94% on 2 L/min".
- **Finding names containing commas** can't be addressed by name in a field path, because commas separate paths. Use the index, `investigations[3]`.
- **Flags** follow the catalog ranges even when the report calls a value normal or high, e.g. platelets 441. Pediatric flags use age-appropriate judgment.

## Sources reviewed and rejected

These PMCIDs were read and not used, so they need not be evaluated again. Licences were checked at fetch time.

- **No vitals, or vitals only described as "normal" or "stable":**
  - PMC12168767, PMC11880866, PMC12034336, PMC12977869, PMC12092147, PMC11570912, PMC12202981, PMC12964327, PMC12414524, PMC12202243, PMC13518029, PMC5030406, PMC8885211, PMC12564574, PMC13524374, PMC13571828, PMC6766088, PMC13222104, PMC10672895, PMC5965232, PMC13578926, PMC12001663, PMC5965238;
  - pediatric: PMC12191439, PMC11608100, PMC13172391, PMC11512491, PMC9106533, PMC6193310, PMC8510820, PMC8851756, PMC13243305, PMC12669083, PMC13032044, PMC10099679, PMC10266924.
- **Several patients pooled in one report:** PMC11793998, PMC10158409, PMC10205967, PMC9600074, PMC7220016, PMC11653981, PMC6230354, PMC12594530, PMC9534705, PMC9420295, PMC13525784.
- **Inconsistent or erroneous data:**
  - PMC10994864, PMC11088753, PMC8567639, PMC6977311, PMC12143186 (PLASMIC contradicts its creatinine), PMC12202715, PMC13192759, PMC13220665;
  - PMC13354112 and PMC13251807 (osmolality miscalculated);
  - PMC13388310 (paracetamol level possibly falsely raised by bilirubin).
- **Wrong final diagnosis or confounded picture:** PMC9436499, PMC12594229 (NMS), PMC12831430, PMC9107358, PMC12002001, PMC11128360, PMC13517985, PMC6027734, PMC8373188 (fistula unconfirmed), PMC10792826 (rupture unconfirmed), PMC8575337 (not ruptured).
- **Not an ED decision:**
  - inpatient or ICU course: PMC12229139, PMC13561166, PMC11743501, PMC12519824, PMC9083808, PMC7783511, PMC12812240;
  - outpatient without labs: PMC11793986, PMC12638710;
  - no outcome: PMC7219999, PMC12883270, PMC13296912;
  - no CSF results: PMC13080951;
  - no core temperature or arrest on arrival: PMC8256448, PMC2396176, PMC4504651.
- **Management conflicts with a guideline-based question:**
  - PMC10517704 (cooled below the endpoint);
  - PMC7149357 (antipyretics, no active cooling);
  - PMC11019565 (stable hypothermia, so an ECLS question would conflict);
  - PMC12509942 (no dialysis despite altered mental status).
- **Other reasons:**
  - PMC13332853: age given only as "in her 20s".
  - PMC10913407 and PMC12594221: age 17, with non-standard therapy.
  - PMC5965445: image report only.
  - PMC10171877 and PMC11110855: not a battery.
  - PMC10438935: non-aneurysmal SAH.
  - Adult reports considered for pediatric topics: PMC9236693, PMC8610483, PMC11166074, PMC11094668.

## Licences

Every library case is a structured paraphrase of an open-access article licensed CC BY or CC0. Each case also carries short verbatim quotes, under 30 words, as evidence.

- Under CC BY, adaptation and redistribution are allowed, including commercially, if the work is attributed, the licence is named and changes are indicated.
- Attribution is the citation and link in each case's `source` and on each reviewer sheet.
- The licence is recorded per case.
- Changes are indicated by the paraphrase, the `augmented` flags and the note that each case is adapted.
- No full texts, figures or tables are stored in the repository.
- When distributing the library, include this notice: *"Case vignettes adapted from the open-access case reports listed below, used under their Creative Commons licences; facts were paraphrased and some details were added for realism (marked as augmented)."*

The table below is generated from the case files by `npm run library`, and THIRD_PARTY_NOTICES.md is compiled from it.

<!-- library:licences:start (generated by `npm run library`; do not edit by hand) -->

51 cases: 1 × CC BY 3.0, 50 × CC BY 4.0.

| Case | Source | Licence | Link |
|---|---|---|---|
| `pmc-PMC10332752-immune-ttp-word-finding` | Sea JL, Gassner SF, Smart J. Case Report of Thrombotic Thrombocytopenic Purpura in a Previously Healthy Adult. J Educ Teach Emerg Med. 2021;6(1):V1-V4. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC10332752/ |
| `pmc-PMC10630999-co-poisoning-waterpipe` | Mohsen G, Kemmerer M, Eichhorn L. Carbon monoxide intoxication with a CO-Hb of 30% while smoking waterpipe: a case report. Int J Emerg Med. 2023;16(1):83. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC10630999/ |
| `pmc-PMC10966501-thyroid-storm-agranulocytosis` | Kunz MJ, Martini WA, Filler L. The Rare Sore Throat: A Case of Thyroid Storm and Agranulocytosis. Clin Pract Cases Emerg Med. 2024;8(1):34-37. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC10966501/ |
| `pmc-PMC11162566-digoxin-toxicity-brash` | Costantini I, Mantelli G, Carollo M, Losso L, Morando E, Bacchion M, et al. Not only Van Gogh: a case of BRASH syndrome with concomitant digoxin toxicity. J Med Case Rep. 2024;18(1):273. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC11162566/ |
| `pmc-PMC11259184-boerhaave-stemi-mimic` | Mangeshkar S, Borkowski P, Shokrekhuda A, Barillas-Lara MI, Menegus MA. Boerhaave syndrome: an unusual myocardial infarction mimic-a case report. Eur Heart J Case Rep. 2024;8(7):ytae310. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC11259184/ |
| `pmc-PMC11345038-wellens-pleuritic-chest-pain` | Ledo T, Espinosa J, Lucerna A. Wellens Syndrome in a 28-Year-Old With Pleuritic Chest Pain. Cureus. 2024;16(7):e65438. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC11345038/ |
| `pmc-PMC11460308-ankylosing-spondylitis-cspine-fracture` | Baldwin ML, Shufflebarger EF, Pacheco ZS. Chalk-Stick Fracture in Ankylosing Spondylitis: A Case Report of Cervical Spine Injury Following Minor Trauma. Cureus. 2024;16(9):e68931. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC11460308/ |
| `pmc-PMC11661250-wernicke-hyperemesis` | Kreutzer B, Buehrer B, Pelikan A, Rohde P. Wernicke Encephalopathy Associated with Hyperemesis Gravidarum: A Case Report. Clin Pract Cases Emerg Med. 2024;8(4):357-360. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC11661250/ |
| `pmc-PMC12315597-syncope-high-risk-pe` | Wery L. Syncope as the Initial Presentation of Severe Pulmonary Embolism Without Hypoxemia: A Clinical Case. Cureus. 2025;17(7):e87159. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC12315597/ |
| `pmc-PMC12333903-staphylococcal-tss-rhinoplasty` | Kitagawa N, Umemoto D, Nishioka H. Staphylococcal Toxic Shock Syndrome Associated With a Cosmetic Rhinoplasty Procedure. Cureus. 2025;17(7):e87549. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC12333903/ |
| `pmc-PMC12414438-salicylate-delayed-diagnosis` | Singh M, Bloom J, Howland MA, Biary R, Su M. Delayed Diagnosis Salicylate Toxicity With Confirmed Cerebrospinal Fluid Salicylate Concentration: A Case Report of Altered Mental Status Without Neuroglycopenia and With Coagulopathy. Cureus. 2025;17(8):e89613. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC12414438/ |
| `pmc-PMC12447112-sseh-stroke-mimic` | Poh YY, Seet YHC. Spontaneous Spinal Epidural Hematoma Presenting as an Acute Stroke Mimic: A Diagnostic Challenge. Cureus. 2025;17(8):e90544. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC12447112/ |
| `pmc-PMC12592887-adrenal-crisis-tuberculosis` | Mohamed H, Attia AM, John HT, Owies A, Varrier M. Think Addison's Disease: Disseminated Tuberculosis Presenting With Adrenal Crisis in a Young Male Patient. Cureus. 2025;17(10):e94091. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC12592887/ |
| `pmc-PMC12597104-button-battery-gastric-melena` | Burman AN. A Case of Unwitnessed Ingestion: Highlighting the Diagnostic Challenge in High-Risk Patients. Cureus. 2025;17(11):e96362. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC12597104/ |
| `pmc-PMC12661095-ruptured-aaa-appendicitis-mimic` | Chatzelas DA, Atmatzidis SK, Velikoudi MD, Papaziogas V. Ruptured Abdominal Aortic Aneurysm Masquerading as Acute Appendicitis. Cureus. 2025;17(10):e95582. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC12661095/ |
| `pmc-PMC12715975-anti-nmdar-encephalitis-psychiatric` | Bleier M, Corinaldi C, Nichita C, Banashkevich A, Leontieva L. Beyond the Psychiatric Lens: Difficulties in Diagnosing Anti-N-Methyl-D-Aspartate Receptor Encephalitis With Psychiatric Presentation. Cureus. 2025;17(11):e97226. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC12715975/ |
| `pmc-PMC12727365-sma-embolism-renal-infarct` | Lin PH, Liang CY, Huang PY. Superior mesenteric embolus accompanied by renal infarction associated with atrial fibrillation successfully treated by anticoagulants: A CARE-compliant case report. Medicine (Baltimore). 2025;104(51):e46740. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC12727365/ |
| `pmc-PMC12906715-epiglottitis-vaccinated-child` | Ferreira M, Condessa L, Roquette M, Antão R, Cardoso C, Chaves M. Haemophilus influenzae Epiglottitis: A Rare Disease Not to Be Forgotten. Cureus. 2026;18(1):e101680. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC12906715/ |
| `pmc-PMC12930116-cvst-anabolic-steroids` | Ahmed AE, Sahli AH, Alenezi ML, Jamor OA, Alsubaie MA. Anabolic Androgen Abuse-Associated Cerebral Venous Sinus Thrombosis in a Young Adult: A Case Report. Cureus. 2026;18(1):e102234. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC12930116/ |
| `pmc-PMC12945712-metoclopramide-pheochromocytoma-crisis` | Yamanishi Y, Iio K, Shimizu K, Kasahara W, Hamaguchi J. Metoclopramide-Induced Pheochromocytoma Crisis: A Case Report and Literature Review. Clin Case Rep. 2026;14(3):e72144. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC12945712/ |
| `pmc-PMC13006077-incomplete-kawasaki-infant` | Haddad ZH, Basma Y. Incomplete Kawasaki Disease Presenting With Coronary Artery Aneurysms in a 2.5-Month-Old Infant: A Case Report. Cureus. 2026;18(2):e103981. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC13006077/ |
| `pmc-PMC13062474-benzocaine-methemoglobinemia` | Panossian A, Sadra A, Namavar AA. Over-the-Counter Benzocaine Gel as a Cause of Methemoglobinemia: A Case Report. Cureus. 2026;18(3):e104949. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC13062474/ |
| `pmc-PMC13193562-posterior-omi-pocus` | Khalid WKK, Aziz ST, Ibrahim HAM, Zafar H. Atypical Posterior Myocardial Infarction With Minimal Symptoms: Diagnostic Impact of Point-of-Care Ultrasound. Cureus. 2026;18(4):e107446. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC13193562/ |
| `pmc-PMC13231831-sjs-ten-overlap-tmp-smx` | Shimizu Saito GK, Mendes da Costa Manteli G, Pinheiro Dos Santos B, Garrafoni Pessotti L, Laura Messias S, Cordeiro de Faria L, et al. Stevens-Johnson Syndrome and Toxic Epidermal Necrolysis Overlap Induced by Trimethoprim/Sulfamethoxazole: A Case Report. Cureus. 2026;18(5):e108225. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC13231831/ |
| `pmc-PMC13242071-bilateral-angle-closure-headache` | Karumannan V, Nauman K, Zachariah S. Atypical Cause of Headache: A Potential Diagnostic Pitfall in Acute Medicine. Cureus. 2026;18(5):e108412. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC13242071/ |
| `pmc-PMC13397960-epidural-abscess-paraplegia` | McKinley BJ, Seby RM, Chase RC, Gavrancic T, Collado J, Rueda Prada L. A Case of Spinal Epidural Abscess and Paraplegia After Group A Streptococcal Pharyngitis. Infect Dis Rep. 2026;18(4):68. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC13397960/ |
| `pmc-PMC13456131-midgut-volvulus-malrotation-child` | Mohanty A, Anwar AZ, Kumar S. Midgut Volvulus Secondary to Intestinal Malrotation in an 11-Year-Old Child With Preserved Bowel Viability: A Rare Delayed Presentation. Cureus. 2026;18(7):e112427. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC13456131/ |
| `pmc-PMC13517984-aortic-dissection-paraplegia` | Nagarajan S, Ganessane E, Kowsthubha BG, Somasundaram A, Balamurugan N. A Diagnostic Pitfall in the Emergency Department -Aortic Dissection Masquerading as Acute Paraplegia: A Case Report. Clin Pract Cases Emerg Med. 2026;10(3):380-384. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC13517984/ |
| `pmc-PMC13539018-tirzepatide-biphasic-anaphylaxis` | Al-Rashid AH, Ali F. Suspected Biphasic Anaphylaxis Following the First Known Dose of Tirzepatide: A Case Report and Brief Review of Reported Hypersensitivity Reactions. Cureus. 2026;18(8):e113910. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC13539018/ |
| `pmc-PMC13600141-left-sided-appendicitis-nonrotation` | Mulupuru S, Srinivasan S, Paul A, Yarlagadda LC. Appendicitis on the Wrong Side: A Case of Left-Sided Acute Appendicitis With Intestinal Nonrotation. Cureus. 2026;18(8):e115045. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC13600141/ |
| `pmc-PMC13700194-exertional-heat-stroke-body-bag` | Ikeda T, Watase T, Kondo T, Watase H, Funabiki T, Iwata M. Low-volume body bag cooling for severe exertional heat stroke in the emergency department: a case report. Int J Emerg Med. 2026;19(1):274. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC13700194/ |
| `pmc-PMC5965426-emphysematous-pyelonephritis` | McCafferty G, Shorette A, Singh S, Budhram G. Emphysematous Pyelonephritis: Bedside Ultrasound Diagnosis in the Emergency Department. Clin Pract Cases Emerg Med. 2017;1(2):92-94. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC5965426/ |
| `pmc-PMC5965436-severe-hypothermia-bypass-rewarming` | Hatam EM, Cameron A, Petsikas D, Messenger D, Ball IM. A Case of Severe Accidental Hypothermia Successfully Treated with Cardiopulmonary Bypass. Clin Pract Cases Emerg Med. 2017;1(1):33-36. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC5965436/ |
| `pmc-PMC5977411-tca-nortriptyline-wide-qrs` | Giwa A, Oey E. The return of an old nemesis: Survival after severe tricyclic antidepressant toxicity, a case report. Toxicol Rep. 2018;5:357-362. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC5977411/ |
| `pmc-PMC6075496-missed-aneurysmal-sah` | Montemayor ET, Long B, Pfaff JA, Moore GP. Patient with a Subarachnoid Headache. Clin Pract Cases Emerg Med. 2018;2(3):193-196. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC6075496/ |
| `pmc-PMC6230346-hhs-steroids-limb-ischemia` | Al Hazmi A, Manning S. Limb Ischemia in a Patient with Hyperosmolar Hyperglycemic State. Clin Pract Cases Emerg Med. 2018;2(4):348-352. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC6230346/ |
| `pmc-PMC6304635-lemierre-septic-emboli-ards` | Jafri FN, Shulman J, Gómez-Márquez JC, Lazarus M, Ginsburg DM. Sore Throat, Fever, Septic Emboli, and Acute Respiratory Distress Syndrome: A Case of Lemierre Syndrome. Case Rep Emerg Med. 2018;2018:7373914. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC6304635/ |
| `pmc-PMC6497193-meningococcal-meningitis-shock` | Offman R, Boggs E, Gwizdala A. Symptomatic Vaginal Infection by Neisseria meningitidis Resulting in Meningitis with Septic Shock. Clin Pract Cases Emerg Med. 2019;3(2):153-155. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC6497193/ |
| `pmc-PMC6682249-brash-hyperkalemia-tmp-smx` | Diribe N, Le J. Trimethoprim/Sulfamethoxazole-Induced Bradycardia, Renal Failure, AV-Node Blockers, Shock and Hyperkalemia Syndrome. Clin Pract Cases Emerg Med. 2019;3(3):282-285. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC6682249/ |
| `pmc-PMC7434240-euglycemic-dka-sglt2-pericarditis` | Mendelsohn RA, Taveras AN, Mazer BA, Clayton LM. Euglycemic Diabetic Ketoacidosis Precipitated by SGLT-2 Inhibitor Use, Pericarditis, and Fasting: A Case Report. Clin Pract Cases Emerg Med. 2020;4(3):389-392. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC7434240/ |
| `pmc-PMC7455435-intussusception-lethargy-infant` | Salloum S. Altered mental status in a 5-month-old boy. Clin Case Rep. 2020;8(8):1571-1573. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC7455435/ |
| `pmc-PMC7676810-abdominal-ectopic-iud` | Jones DD, Kummer T, Schoen JC. Ruptured Ectopic Pregnancy with an Intrauterine Device: Case Report and Sonographic Considerations. Clin Pract Cases Emerg Med. 2020;4(4):559-563. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC7676810/ |
| `pmc-PMC8311984-serotonin-toxicity-ssri-triptan` | Jin G, Stokes P. Drug interaction between a selective serotonin reuptake inhibitor and a triptan leading to serotonin toxicity: a case report and review of the literature. J Med Case Rep. 2021;15(1):371. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC8311984/ |
| `pmc-PMC8668031-aortoduodenal-fistula-herald-bleed` | Wiesmueller F, Neufert C, Siebler J, Croner R, Lang W, Grützmann R. Primary aortoduodenal fistula - overlooked because of guidelines? Innov Surg Sci. 2020;5(3-4):133-136. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC8668031/ |
| `pmc-PMC8885234-fournier-gangrene-pocus` | Ramm L, Guidry K, Cirilli A, Kurkowski E, Yu C. Critical Point-of-care Ultrasound Diagnosis of Fournier's Gangrene: A Case Report. Clin Pract Cases Emerg Med. 2022;6(1):57-60. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC8885234/ |
| `pmc-PMC9197740-vertebral-dissection-massage-gun` | Sulkowski K, Grant G, Brodie T. Case Report: Vertebral Artery Dissection After Use of Handheld Massage Gun. Clin Pract Cases Emerg Med. 2022;6(2):159-161. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC9197740/ |
| `pmc-PMC9197752-testicular-torsion-rlq-pain` | Stephenson GS, Langdorf MI. Testicular Torsion Appearance and Diagnosis on Computed Tomography of the Abdomen and Pelvis: Case Report. Clin Pract Cases Emerg Med. 2022;6(2):117-120. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC9197752/ |
| `pmc-PMC9205385-bilateral-tension-pneumothorax` | June C, Viscusi C, DeLange B. Simultaneous Spontaneous Bilateral Tension Pneumothorax Post COVID-19 Infection: A Case Study. Cureus. 2022;14(5):e25107. | CC BY 3.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC9205385/ |
| `pmc-PMC9221573-abusive-head-trauma-neonate` | Yoon S, Lee J, Jun YH, Jeon GW. Neonatal Abusive Head Trauma without External Injuries: Suspicion Improves Diagnosis. Children (Basel). 2022;9(6):808. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC9221573/ |
| `pmc-PMC9670044-splenic-rupture-angina-mimic` | Munasinghe BM, Fernando UPM, Kumar T, Huruggamuwa C, Kuruppu KARL, Hewawasam GGC. An unusual case of a traumatic splenic rupture masquerading as myocardial ischemia: a case report. Int J Emerg Med. 2022;15(1):63. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC9670044/ |
| `pmc-PMC9744716-paracetamol-late-staggered` | Lamichhane P, Pokhrel KM, Bhandari B, Agrawal A, Ghimire B, Shilpakar O. Successful management of delayed presentation of massive paracetamol overdose in a resource-limited setting: A case report from Nepal. Clin Case Rep. 2022;10(12):e6733. | CC BY 4.0 | https://pmc.ncbi.nlm.nih.gov/articles/PMC9744716/ |

<!-- library:licences:end -->
