# Visual QA: storyboards and the support audit

Most bugs the owner finds by playing are visual: things floating, limbs held up by nothing, hands through objects, objects appearing from nowhere, an arm reaching behind the back, a coffee cup on the floor beside the table. Unit tests and e2e checks of state miss them. This page is the checklist and the workflow that catches them before a player does.

## The tool

`tests/storyboard.ts` films every scripted scene on the real GPU from fixed third-person camera rigs and from the player's eyes, at moments across the scene's whole length. It writes one contact sheet per scene, and runs a numeric audit on each moment.

```bash
npm run storyboard                                  # every scene, into shots/storyboards/
npm run storyboard -- --scene=faint,crowd           # some scenes
npx tsx tests/storyboard.ts --scene=sit /tmp/sb     # another output folder
npx tsx tests/storyboard.ts --list                  # the scenes
```

It boots a private server and stops it at the end (never port 5317). For each scene it writes:

- `<scene>.png`: the contact sheet. One row per moment, one column per camera, the moment's game time, and the audit's findings under the row.
- `<scene>/`: the frames, `sheet.html`, `audit.json` (every measurement) and `findings.md` (the table).
- `index.md`: every scene's findings.

The audit lives in `client/src/world/visualAudit.ts`, behind the `?debug=1` hook: `__acWorld.audit({ x, z, r })` and `__acWorld.bones(id)`. It measures CPU-skinned bodies and the loose items within `r` of `(x, z)`:

| Check | Rule |
|---|---|
| Items | Every loose item rests within 1 cm of a surface below it (a vertical ray), unless it is in a hand. |
| Bodies | The underside of each body segment (its skin within 2 cm of its lowest point) rests within 3 cm of the floor, a seat, a bed, a prop, or another person's hand within 5 cm. Which segments must rest depends on the posture: a foot standing; seated, the hip joint 5–16 cm over the seat under it (skin can't say: a coat's skirt hangs past the seat) and the feet on the floor or footrests (one may rest across the other leg, never both off the floor; a bed's edge lets the legs hang); lying, the pelvis, back, head and each leg (a leg is borne if its calf or its foot rests or is held). More than 10 cm in both samples, 0.5 s apart, is *unsupported*. |
| Clipping | Skinned vertices inside closed static geometry (walls, furniture, the floor) deeper than 2 cm. A body's weight may press 5 cm into a seat cushion or a mattress. |
| Contact | Whoever pushes a wheelchair has both hands within 6 cm of its handles; a rollator's user, both palms within 4 cm of its grips and its front wheels 0.5–0.8 m ahead of the hips while walking. Texting, a call or filming has a phone in that hand. A nurse calling a name holds her clipboard (within 4 cm of her left hand) up in front of her chest, its face to her eyes (*clipboard*). |
| Skin | With `skin: true`: the face's skin texels against the fingers' (face textures carry baked shading, so 0.5–1.25 of the fingers' brightness, hue within 25°), and under a quarter of the upper face grey (a grey beard is fine). |
| Paper | Reading an open newspaper: no head or hair vertex inside it. |

Scenes add their own checks: the faint checks that he sits in the wheelchair while he is pushed, hips over the seat and soles on the footrests.

## The checklist

Each class below comes from a real bug in this project. Look for all of them on every sheet.

1. **Floating or unsupported.** An item in the air; legs held up by nothing; a magazine 4 cm above a chair seat; feet hovering under a chair.
2. **Clipping and interpenetration.** Feet through the floor as knees buckle; a hand in a counter; thighs through a seat.
3. **Hands that miss what they touch.** A pusher's hands at their sides, 50 cm from the handles; a friend "holding" ankles she can't reach; a hand short of a button.
4. **Things from or into thin air.** Everything comes from a real place: a stack, a dispenser, a pocket, the corridor's parked wheelchair. A patient doesn't appear in a bed.
5. **The wrong hand, or an arm behind the back.** The reaching arm is on the target's side and in front of the shoulders.
6. **Turning and facing.** People face what they talk to, sit facing out of the seat, and turn before they reach.
7. **Z-fighting and flicker.** Coplanar surfaces, a decal on a wall, a page turning on a page.
8. **Wrong scale.** A cup the size of a bucket, a sign too small to read, a chair too low for its sitter.
9. **Text overflowing signs.** Labels inside their panel at every font size.
10. **Unreal timing.** Someone speaking before they arrive; a nurse who "runs" at walking pace round chairs; a wheelchair push that starts before the patient is in it.
11. **Colours with clinical meaning.** A grey face (ashen means shock), pallor that never fades, cyanosis by accident, the wrong colour on a monitor or a triage level.
12. **A pose without its furniture.** A mocap clip made for a table, a chair or a held thing that isn't there: a nurse leaning over papers on no table, head down and hands low (it looked like petting an invisible dog); a nurse sitting on air at a desk with no chair. Check what a clip was recorded with before you use it.

## The workflow rule

- **Every new feature or scripted plot ships with a storyboard scene** in `tests/storyboard.ts` and a clean support audit: no persistent *unsupported*, *clipping*, *hands-off*, *floating-item*, *no-phone* or *clipboard* findings, or each one explained in the pull request.
- **The author reviews the sheets before saying "done":** read `<scene>.png` and the frames of at least two angles (with Claude Code, the Read tool on the PNGs), and go through the checklist above.
- **The lead reviews the sheets before merging**, the same way, and attaches them to the pull request.

When a scene is someone else's work in progress, film it anyway and send them the findings with the frame paths.
