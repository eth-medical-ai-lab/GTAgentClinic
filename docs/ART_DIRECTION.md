# Art direction

**Current decision (v2, Nov 2026): realistic, physically based rendering in the browser.** That means photo-scanned materials, a light behind every fixture, ambient occlusion, bloom and temporal anti-aliasing on WebGPU, plus realistic rigged and motion-captured people. Clinical artifacts stay at high *functional* fidelity: EHR screens, lab values and units, ECGs, monitor traces, dialogue.

v1 deliberately used a stylized low-poly look, for the reasons in the evidence section below. After playing it, the project owner asked for a realistic, console-like look. Of three routes (upgrade the browser engine, an Unreal Engine 5 client, a Godot desktop app), they chose the browser upgrade. It keeps "`npm start` → play in the browser" and the AI-agent API unchanged, and it can be built and verified without proprietary toolchains. The renderer sits behind `WorldApi` (`client/src/world/index.ts`), so a native UE5 client remains possible later.

## Pipeline (what the code does)

| Layer | Implementation | Where |
|---|---|---|
| Renderer | three.js `WebGPURenderer`. It falls back to WebGL 2 automatically. | `client/src/world/render/renderer.ts` |
| Lights | A real light behind every emissive fixture: about 80 LED troffers, exam lights over beds, canopy downlights. Forward+ clustered culling (`ClusteredLighting`) keeps the per-pixel cost bounded. | `render/lighting.ts` |
| Shadows | Soft shadows from the exam lights over the beds (high and ultra). | `render/lighting.ts` |
| Ambient + reflections | Image-based lighting (PMREM of an interior light environment) and a small hemisphere fill. | `render/lighting.ts` |
| Post-processing | GTAO ambient occlusion, then temporal AA (TRAA), bloom on emissives (fixtures, screens, signs), a subtle vignette, and ACES filmic tone mapping. | `render/renderer.ts` |
| Materials | `MeshStandardMaterial` / `MeshPhysicalMaterial` from CC0 photo-scanned sets (ambientCG): terrazzo sheet vinyl, painted plaster, fabrics, vinyl upholstery, brushed steel, wood, asphalt, concrete. UVs are box-projected in world space at merge time, so tiles keep their physical size. | `materials.ts`, `builder.ts` |
| Architecture | Acoustic ceiling tiles on a T-bar grid with recessed troffers, rubber cove base, corridor handrails, steel-framed doors with kick plates and vision panels, and pleated privacy curtains with mesh tops. | `builder.ts` |
| Outside | Built from the layout at runtime, so it follows the building's size and doors. One ground plane in a node material: CC0 asphalt and broom-finished concrete mixed by a mask, with a painted-markings canvas (worn stall lines, AMBULANCE ONLY, hatching, crack sealant, crosswalks) and a data canvas (puddles, oil stains, baked contact shadows under vehicles). Wetness darkens the ground and turns puddles into mirrors. Raised planting islands with curbs, lawn and mulch; leaf-card trees and shrubs from a CC0 leaf atlas; bollards, benches, bins, a bike rack, drains and manholes, a monument sign, wayfinding posts; a street with cobra-head lights and street trees. | `exterior.ts` |
| Surroundings | The town around the hospital, laid out from the lot's size. The campus edge has brick piers, a low brick wall with steel pickets and a clipped hedge. North: the main hospital tower (a rooftop "AgentClinic General" sign, a helipad with edge lights, a penthouse, obstruction lights), a lower wing and a service road. East: a five-level parking garage with a lit stair tower, plus an office tower and apartments. West: a medical office building and apartment blocks. South, past the street: a riverside park and promenade with lanterns, a quay wall with a railing, the river (animated ripples that streak the reflections), the far bank's buildings in two rows with obstruction lights on the tall ones, and a tied-arch road bridge strung with lights. Past the camera's far plane, a city skyline is painted into the sky at the horizon: window lights and blinking aviation lights at night, hazed by day. All buildings are one merged mesh with one procedural façade shader (one draw call). The style (offices, a glass tower, apartments, brick, the garage, the hospital) is a vertex attribute, so no textures are needed. Each building has whole window bays, shopfronts on the ground floor and a parapet. At night, window groups are lit or dark by hash, warm or cool. Plain parts share two vertex-coloured materials. Nothing far casts shadows; the façades and the river receive none and see only the sun and the probe. | `surroundings.ts` |
| Façade | Metal-composite panels in two tones with real 2 cm reveals and faint rain streaks, a brick base, and recessed bronze-framed windows. The window glass is "interior-mapped": a lit room with ceiling troffers, walls, blinds or a dark office is traced behind each pane, with parallax. Storefront frames at the doors, parapet coping, rooftop units over the parapet. | `exterior.ts` |
| Ambulance canopy | Two steel columns with safety-yellow guards, a fascia carrying the EMERGENCY sign, a linear metal soffit with recessed LED downlights, and a red glow from the sign. | `exterior.ts` |
| Vehicles | A Type III ambulance at real size (E-450-class cutaway cab, 14 ft module, dual rear wheels): clear-coated paint, chrome bumper and wheel simulators, compartment doors with seams, latches and hinges, a cab interior and patient compartment seen through the glass, LED warning modules (red/white, flashed by the world on EMS arrival), west-coast mirrors (flat over convex glass, out past the module's side on stainless arms), and a canvas livery (reflective stripe, Star of Life, "AgentClinic EMS", MEDIC 12, mirrored AMBULANCE, rear chevrons). Parked sedans, SUVs, hatchbacks and pickups are extruded profiles with tumblehome and see-through glass; lamps, plates, shut lines and trim are fitted to the tapered body, and the windshields have a black frit border, a cowl, wipers and a rear-view mirror. | `vehicles.ts` |
| Sky and outdoor light | Poly Haven skies (an overcast city night, a partly cloudy day) as the background, with distance fog. The outdoor materials reflect a box-projected reflection probe of the lot (re-captured on day/night changes), so puddles mirror the sign, the canopy and the lamps. LED area lights (4000 K, cut-off), canopy downlights and wall packs at night. On high and ultra, a sun with soft shadows by day: only the exterior's shadow twins (layer 1), characters outdoors and blocker proxies inside the roof and walls cast, so the sun never reaches the interior. Nothing else on layer 1 moves, so the sun's shadow map is re-rendered only on demand: after a day/night change, after late texture loads, and every other frame while characters are outdoors. | `exterior.ts`, `render/lighting.ts` |
| Set dressing | Bay headwall rails with suction, a diagnostic set, BP cuff and red emergency-power outlets; glove dispensers and sanitizer; "Your care team" boards; patient-facing posters. | `builder.ts` |
| Props | Bevelled geometry, e.g. split side rails, casters, monitor arms, a gas-outlet headwall, crash cart with defibrillator, IV pole with infusion pump, bag and line. | `props.ts` |
| Equipment and clutter | Wheelchair, linen and isolation carts, workstations on wheels, an oxygen cart, a wet-floor sign, AED and extinguisher cabinets, live analog wall clocks synced to game time, EXIT signs, bedside tables, paper-towel dispensers, smoke detectors, sprinklers, supply diffusers. | `details.ts` |
| Objects | About 50 small objects at real-world size on counters, desks, carts, bedside tables and waiting-room chairs, plus patients' belongings from the server. All can be picked up (E; right hand, then left, a tray in both), inspected close up (F) and put down (E on a surface, or G); equipment can be inspected in place. In third person a held thing sits in the avatar's palm and the arm takes a two-bone IK pose to match: a cup carried level in front at waist height, a clipboard at the side, a tray in both hands. | `items.ts`, `itemSystem.ts`, `hands.ts` |
| Things to use | Coffee from the cafeteria's self-serve machine and the workroom's: the hand takes the top paper cup off the stack beside the machine by its rim (the stack one cup shorter; a mug off the workroom's rack), sets it on the drip tray under the spout and presses the button; ~15 s of grinding and pouring with a stream, the cup filling and steam; then a lid off the lid stack pressed on and the cup taken (the same world pose drives the avatar's arm IK and the first-person hands). Carried, then drunk at a café table: the cup on the table, a sip every 10–40 s (lift, sip, set down; IK in third person, the cup to your mouth in first), the level falling sip by sip by the cup's frustum volume, the steam fading as it cools (Newton cooling; slower with a lid). The cafeteria's coffee is paid by tapping your phone (out of your pocket, in the free hand) on the till's card terminal, or on the cashier's handheld when he comes after you; the vending machine's reader takes a tap before a can drops into the flap. Bins and hand-rub dispensers work too. Steam puffs write their own depth so the AO never darkens a square behind them. Sounds are synthesized (`audio/amenities.ts`). Never scored. | `amenities.ts`, `cupStacks.ts`, `payment.ts`, `handPoses.ts` |
| People | 44 Microsoft Rocketbox avatars (MIT) with mocap clips. Everyone looks different: a cast is a body (the outfit) plus a head (face, hair, lashes) that may come from another avatar, so nurses share the scrubs bodies but not faces. The player (the watcher in observe mode) and the AI resident wear models nobody else wears; each staff member's face is theirs alone on a map; anyone else shares a face only with someone never in the same room at the same time, and then with a strongly different skin, hair and garment color (`tests/casting.test.ts` checks every character of every map). Skin recolors shift a face's lips, cheeks and sheen with it, so darker tones have no pale patches, and scale a model's head and body textures by the same factors (from its measured native tone), so a neckline shows no two-tone seam. A worn head is fitted to the outfit it is worn with: skin that would poke through a collar is tucked behind it, a neck that ends above a lower collar is drawn down into it, skin below the jaw moves as the outfit's own skin did, and where the head leaves an open neckline bare the outfit's own skin fills in, in the face's tone. A worn head's outfit is drawn double-sided, so a collar shows its inside, not the room behind. `/src/dev/lineup.html` shows the whole cast side by side (`?view=bust`/`nape` for necklines, `?paint=head` for which mesh shows where), and `npx tsx tests/heads-e2e.ts` checks every head and neckline of the cast and of every model's head on scrubs for see-through holes. Clips cover idle, nervous, cough, walk (normal, slow and fast, stride matched to ground speed), sit (chair, desk, nervous), talk (neutral, nervous, sad), listen, and lying in bed under a blanket. Seated characters get an upper-body talk layer. Characters also turn their head toward the player and nod in time with their voice. Feet rest on the floor when seated (the hips flex a few degrees where the mocap chair was taller than ours). Each avatar's glTF primitives are joined by material at load, so it draws in 3 calls per pass instead of 7–8. | `avatars.ts`, `casting.ts` |
| Waiting room | A seeded crowd of walk-ins and companions (8–12 at night, more by day) with visible complaints: an ice pack, a bandaged hand, a mask on whoever coughs, a walker, a dog in a carrier, earbuds and a phone with a lit screen. They text, phone home, doze, cough, go to the vending machine, ask the desk how much longer, and talk quietly in pairs. One or two read an old-school broadsheet held open in both hands (a page turns over every 18–40 s, the right hand following its edge), folded on the lap when they talk; one types on a laptop on her lap. Their arms follow the paper and the keyboard with the same two-bone IK as the player's hands (`reading.ts`). The triage nurse calls names; new patients register at the desk. Once in a while someone faints at the walk-in door. Upper-body mocap layers (texting, calling, filming, drinking, laughing, carrying, pushing a wheelchair or walker) run over sitting, standing and walking. Props are procedural, one draw call each, hung off bones. Crowd avatars cast no shadows; `?crowd=0` hides them. | `server/sim/ambient.ts`, `content/ambient.ts`, `crowd.ts`, `accessories.ts` |
| Your hands in first person | Poses come from a rig of hinged capsules at real hand size (`fpHands.ts`): it is what the choreography measures by (a fingertip on a tap, the palm under a nozzle, the water's run over the hands), but it is not drawn. What you see is a short-sleeved scrubs avatar of the player's sex, in the player's skin tone, cut to its forearms and hands (`fpArms.ts`). Its upper arm starts at the pose's shoulder, a two-bone IK takes the wrist to the pose, and each finger joint turns as the rig's hinge does. Lather, wet skin and gloves are the avatar's own skin layers, as in third person. Only the forearm is cut from the body, from the elbow's crease down (the upper arm's skin weights bulge at a sharply bent elbow), and only its own arm bones move it. The forearm turns about its own axis with the hand, as the radius rolls round the ulna, measured from palm-in (the elbow's hinge says which way is in) and never past what an arm can do, 110° either way. A hand turned on toward palm-out is between grips, so its forearm stays at the end it has reached. The forearm's one bone takes 70% of the turn and the wrist the rest, at most 30°: turned at the wrist alone, linear skinning pinched it into a thin, twisted neck, and a twist bone along the forearm thinned its middle instead. Every pose starts from the arm as modeled, and the forearm never turns faster than 720°/s, so it never flips. The shoulders sit 30 cm below the eyes and behind them: 5 cm for a level look, up to 15 cm looking steeply down, as a bowed head puts them (`fpShoulders`). With the eyes over the shoulders, a look down into a sink looked straight along both upper arms. The elbows hang below the line from shoulder to wrist and only a little out, so the forearms come up into view from below; pushed further out, they came in flat from the sides. The sleeve is a tube in the scrub color along the upper arm. It ends 20 cm past the shoulder, out of view; run on further, it passed the eyes when an arm pointed back toward them. A short bunched cuff round the top of the forearm hides the cut at any elbow angle. It is fuller in its middle, over the forearm's muscle, which stands 6.4 cm from the bone 2–3 cm below the elbow; a straight cuff let a triangle of skin through. The sleeve's far end is a rounded cap, not an open tube. A hand out of reach pulls its shoulder forward or sideways, as a lean would, and at most 6 cm down; a hand parked out of sight is hidden, not hung below the view (the shoulder once dropped half a metre after it). The rub's grips use the body's axes, up is up, so a palm over the other hand's back is seen from above rather than edge-on; between grips the hands come apart and round each other. Until the avatar has loaded, the rig is drawn instead. | `fpHands.ts`, `fpArms.ts` |
| Your sleeves in third person | The player's coat has long sleeves, painted on the same skinned mesh as the body. Before a hand rub or wash, each hand in turn pushes the other sleeve up to mid-forearm; afterwards each pulls the other back down to the wrist. When a sleeve is up, the body is drawn without its triangles below the hem (a second index over the same vertices). A bare forearm in the skin colour of the hand fills the gap; it is weighted to the wrist like the arm it replaces. A roll of the coat's own fabric sits at the hem. The hands' wet, lather and glove layers leave out the cuff's fabric (it is held by the hand bone too). A short-sleeved body has nothing to push. | `sleeves.ts`, `hygiene.ts` |
| Fallback | The procedural low-poly humans remain as a fallback (`?avatars=0`, or when an avatar fails to load). | `characters.ts` |

**Quality presets.** Choose them with the 🖥 HUD button; the choice is saved, and `?quality=` overrides it for one load.

| Preset | What it renders | When it's chosen automatically |
|---|---|---|
| Low | Direct render with MSAA and no post-processing. Each room's troffers merge into ≤2 lights. | CPU rasterizers (SwiftShader, llvmpipe) |
| Medium | AO at half resolution, bloom and TRAA, 1.25× pixel ratio. | Hardware WebGL 2 |
| High | Adds exam-light shadows, finer AO and 1.5× pixel ratio. | Fast WebGPU adapters |
| Ultra | Adds native pixel ratio. | Never; choose it manually |

**Measured (Apple M1 Max, Chrome, 1600×900, high, Night Shift with 16 characters):** 48–58 fps.

**Art-direction iteration without rebuilds.** URL knobs set the main parameters:
- `?tm=aces|agx|neutral` — tone mapping
- `?exp=` — exposure
- `?li=` / `?ld=` — light intensity / falloff distance
- `?hemi=` — hemisphere fill
- `?env=` — environment light
- `?ao=` / `?aor=` — AO strength / radius
- `?bloom=` — bloom
- `?vig=` — vignette
- `?view=ao` — shows the AO buffer
- `?gi=1` — experimental light-probe GI
- `?skyd=` / `?skyn=` — sky brightness by day / night; `?sun=` — sun intensity; `?dayamb=` — daylight fill without a sun (medium, low)
- `?lamp=` / `?extl=` — LED area-light intensity / multiplier for the other outdoor lights
- `?xhide=site,flat,skin,ground,cars,amb,edge,far` — hides parts of the outside (profiling; `edge` = the campus fence and hedge, `far` = the town past the lot)
- `?surround=0` — builds the lot without the town around it and without the skyline (profiling)
- with `?debug=1`: `__acOutdoor.camera([x,y,z], [tx,ty,tz])` places the camera anywhere (null: back to the player), `vehicles()` lists the ambulance and the parked cars, `showroom([{kind, color, metallic, x, z, rot}])` parks vehicles anywhere for close-ups

`npx tsx tests/visual.ts <outDir> --views=hub,bay4,station --tune=exp=0.7,ao=1.6` renders fixed viewpoints on the real GPU and reports fps.

## Assets and licenses

| Asset | Source | License | Size | Regenerate |
|---|---|---|---|---|
| Characters + animations | [Microsoft Rocketbox](https://github.com/microsoft/Microsoft-Rocketbox) | MIT. Converted to glTF with WebP textures, facial blendshapes stored as sparse accessors (only the face's moving vertices: ~0.8 MB per avatar instead of ~2 MB) and error-bounded keyframe reduction (72 clips in 7.7 MB; upper-body layers keep only arm, spine and head tracks). | ≈42 MB | `node scripts/assets/fetch-rocketbox.mjs && node scripts/assets/convert-rocketbox.mjs` (three.js FBXLoader → GLTFExporter in headless Chromium; no Blender needed) |
| PBR textures | [ambientCG](https://ambientcg.com) | CC0 | ≈7.5 MB, WebP (interior sets + parking-lot asphalt, sidewalk concrete, lawn, bark, a leaf atlas, brick, tread plate) | `node scripts/assets/fetch-textures.mjs` (needs `cwebp`) |
| Sky backgrounds: `kloppenheim_07_puresky` (night), `kloofendal_48d_partly_cloudy_puresky` (day) | [Poly Haven](https://polyhaven.com) | CC0 | ≈0.3 MB, 4096×2048 WebP from the tonemapped JPG | same script |
| Station radio music: four pieces of *The Open Goldberg Variations* (J. S. Bach, BWV 988; Kimiko Ishizaka, 2012) | [Internet Archive](https://archive.org/details/The_Open_Goldberg_Variations-11823), [opengoldbergvariations.org](https://opengoldbergvariations.org) | CC0 1.0 (public domain dedication by the performer; checked in the item's metadata) | ≈3.2 MB, mono 22 kHz 32 kb/s MP3 | `node scripts/assets/fetch-audio.mjs` (SHA-1 checked against the archive; needs `ffmpeg`) |

| Waiting-room crowd: a small dog yapping in its carrier, coughs | Dog: [Scottish Terrier Puppies Playing and Barking](https://archive.org/details/ScottishTerrierPuppiesPlayingAndBarking) (RegicideAudio, cut from the 1952 Prelinger film *Mother Mack Trains Her Seven Puppies*). Coughs: Wikimedia Commons [Man coughing](https://commons.wikimedia.org/wiki/File:Man_coughing.ogg), [Cough 1](https://commons.wikimedia.org/wiki/File:Cough_1.ogg) (both PDSounds) and [Woman coughing three times](https://commons.wikimedia.org/wiki/File:Woman_coughing_three_times.wav) | Public domain (Public Domain Mark; PDSounds) and CC0 1.0, checked in each archive's metadata at fetch time | ≈54 KB, 8 mono 22 kHz MP3 cuts | `node scripts/assets/fetch-crowd-audio.mjs` (SHA-1 checked; needs `ffmpeg`) |

All other sounds (monitor and alarm tones, phones, room tone, footsteps, doors, sirens…) are synthesized in the browser (`client/src/audio/synth.ts`); the only recordings are the radio music and the crowd's dog and coughs.

Credits and license texts ship next to the files:
- `client/public/res/chars/LICENSE-Rocketbox.txt`
- `client/public/res/tex/CREDITS.txt`
- `client/public/res/audio/radio/CREDITS.txt`
- `client/public/res/audio/CREDITS.txt` (waiting-room crowd)

Scrub colors and greyed hair are applied at load time by recoloring textures, so one base model can play several roles.

## Known limitations (honest list)

- **Lip-sync follows the words, with guessed timing.** Faces blink, show the NPC's emotion, and look at you with their eyes (`Face` and `Eyes` in `avatars.ts`). While someone speaks, the letters of the line are read as mouth shapes and stretched over the time its audio takes (`ui/visemes.ts`); the voice level sets how far the mouth opens. The voices give no phoneme timing, so a shape can be early or late within a sentence.
  - The converter keeps 8 of the models' viseme shapes and 12 expression shapes.
  - A murmur in the waiting room has no words: there a vowel shape changes with the syllables.
- **Character fidelity is "good mid-2010s game", not MetaHuman.**
  - The library has few elderly people; elderly characters use greyed hair on middle-aged models.
  - Patients wear street clothes rather than gowns.
  - Some characters share a base model (with different scrub colors).
- **No real-time global illumination by default.**
  - A light-probe-grid bake exists behind `?gi=1`. It produced no visible gain in these white, evenly lit rooms but costs frame time while baking.
  - Lightmaps (three.js `LightMapper`) are the next option if bounce light becomes important.
- **The outside is procedural.**
  - Parked cars are good at lot distance but not hero quality up close.
  - Trees are leaf cards. The area lights cast no shadows, so contact shadows under vehicles are baked into the ground.
  - The reflection probe is static: characters and the flashing light bar don't show in puddles.
  - Photogrammetry vehicle and tree models (not CC0 in useful quality) would be the next step.
  - The neighbouring buildings are boxes with a procedural window grid: convincing from the lot, plain up close (no entrances, balconies or roof clutter, except on the hospital tower).
- **The HUD costs frame time outdoors.** Its frosted-glass panels (CSS `backdrop-filter` over the WebGPU canvas) cost 6–9 fps in the exterior views on the M1 Max. The lot by day runs at 50 fps with the HUD and 60 without; the ambulance view at night runs at 48 and 57. `tests/visual.ts` measures with the HUD shown. The town around the lot costs at most about 0.4 ms (the ambulance view; `?surround=0` to compare).
- **Some exterior views are bound by the characters, not the outside.** Views that look at the ED doors run like the interior hub (on the M1 Max under load: about 28–34 fps, versus 60 with `?avatars=0`). The Rocketbox avatars are never frustum-culled and render into all seven exam-light shadow maps every frame. Hiding all of the outside (`?xhide=…`) changes nothing there.
- **Repo size.** About 45 MB of binary assets live in `client/public/res`. Consider Git LFS before the asset set grows.

## Still-relevant evidence from the v1 decision

The research below argued for stylization. It still shapes the details:
- **Uncanny valley:** motion and face artifacts are punished hardest on realistic humans. So faces stay neutral, all body motion is real mocap, and procedural layers (head turn, nod) are kept small.
- **Learning:** fidelity is largely independent of learning; clinical *functional* fidelity remains the priority.
- **AI agents:** they never depend on pixels.


**Appeal and the uncanny valley**
- Mori M, MacDorman KF, Kageki N. The uncanny valley [from the field]. *IEEE Robot Autom Mag* 2012. doi:10.1109/MRA.2012.2192811. Affinity drops for nearly-human figures.
- McDonnell R, Breidt M, Bülthoff HH. Render me real? *ACM TOG* (SIGGRAPH) 2012. doi:10.1145/2185520.2185587. Across 11 render styles, the most realistic character was often as appealing as the cartoon ones. Appeal dipped for unfamiliar or mid-scale styles, and motion artifacts were judged worse on human-looking styles.
- Zell E, et al. To stylize or not to stylize? *ACM TOG* (SIGGRAPH Asia) 2015. doi:10.1145/2816795.2818126. Shape drives perceived realism and material drives appeal. "Realism alone is a bad predictor" of appeal, and shape/material mismatch looks eerie.
- Kätsyri J, et al. *Front Psychol* 2015. doi:10.3389/fpsyg.2015.00390. Little support for a simple human-likeness dip. Good support for *perceptual mismatch*.
- Diel A, Weigelt S, MacDorman KF. *ACM THRI* 2021. doi:10.1145/3470742. Meta-analysis of 72 studies: large effect (g = 1.01), strongest for distorted faces.
- Schwind V, Wolf K, Henze N. *ACM Interactions* 2018. doi:10.1145/3236673. Consistently unrealistic characters are readily accepted.
- *Counterpoints:* Zibrek K, Martin S, McDonnell R. *ACM TAP* 2019 (doi:10.1145/3349609) found photoreal characters preferred in VR. Volonte M, et al. *IEEE TVCG* 2016 (doi:10.1109/TVCG.2016.2518158) found a realistic deteriorating virtual patient produced less negative affect than cartoon or sketch styles. **Takeaway:** if emotional realism of patients becomes a core goal (e.g. breaking bad news), A/B-test a higher-fidelity face rather than assume.

**Fidelity and learning**
- Norman G, Dore K, Grierson L. *Med Educ* 2012. doi:10.1111/j.1365-2923.2012.04243.x. Across 24 studies, nearly all showed no significant advantage of high- over low-fidelity simulation.
- Hamstra SJ, et al. Reconsidering fidelity in simulation-based training. *Acad Med* 2014. doi:10.1097/ACM.0000000000000130. Fidelity appears independent of effectiveness. The authors propose *physical resemblance* vs *functional task alignment* instead.
- Cook DA, et al. *JAMA* 2011. doi:10.1001/jama.2011.1234. Across 609 studies, simulation strongly beats no intervention.
- Kononowicz AA, et al. *JMIR* 2019. doi:10.2196/14676. Virtual patients give knowledge gains similar to traditional teaching and better skills.
- Gentry SV, et al. *JMIR* 2019. doi:10.2196/12994. Serious games were at least as effective as controls, but the evidence was low quality.
- Clark DB, Tanner-Smith EE, Killingsworth SS. *Rev Educ Res* 2016. doi:10.3102/0034654315582065. In K–16 education, schematic visuals beat realistic ones for learning gains.

**Market (2018–2026)**
- Two Point Hospital (cartoon isometric): over 5M players.
- PowerWash Simulator (clean first-person): about 17M players.
- Supermarket Simulator (low-poly first-person): about 51k peak concurrent players.
- Schedule I (crude cartoon, 2025): about 456k peak concurrent players.
- CURE – A Hospital Simulator (Unreal, tagged "Realistic", Nov 2025): about 500 peak concurrent players.
- No rigorous art-style-vs-sales analysis exists, so treat these as a directional signal.

**Sim-to-real for agents**
- Tobin J, et al. Domain randomization. *IROS* 2017. doi:10.1109/IROS.2017.8202133. Training on non-realistic random textures transferred to the real world.
- LLM clinical environments all act through text or APIs:
  - AgentClinic: text plus tools. *npj Digit Med* 2026, doi:10.1038/s41746-026-02674-7.
  - MedAgentBench: FHIR. *NEJM AI* 2025, doi:10.1056/AIdbp2500144.
  - SDBench/MAI-DxO: text gatekeeper with test costs. *Science* 2026, doi:10.1126/science.aeh7930.
  - CRAFT-MD. *Nat Med* 2025, doi:10.1038/s41591-024-03328-5.
- Where any of these have visuals, the visuals are a 2D layer separate from the agent's I/O: Agent Hospital (arXiv:2405.02957) and MedAgentSim (MICCAI 2025).

**Reach**
- Steam Hardware Survey (Oct 2026): about 10% integrated GPUs, even among gamers.
- JPR (2026): discrete GPUs will reach about 12% of PCs.
- WebGL 2 reaches about 97% of users and WebGPU about 87% (caniuse). three.js falls back from WebGPU to WebGL 2.

*Evidence compiled 2026-11-06; v2 pipeline measured 2026-11-07.*
