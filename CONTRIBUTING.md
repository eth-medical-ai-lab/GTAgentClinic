# Contributing to GTAgentClinic

GTAgentClinic is an open-source project. You clone it, run it on your own computer, and add what you'd like to see: a case, a feature, a fix. Many contributors work with their own [Claude Code](https://claude.com/claude-code), and the game's characters can run on that same login.

**Where to start:** [docs/ROADMAP.md](docs/ROADMAP.md) lists the open tracks: new cases, patient flow (admissions), deeper evaluation checkpoints, standardized human-vs-agent experiments, and how agents steer the doctor. Each comes with the files to read and a prompt to paste into Claude Code.

## Set up

You need Node.js 22.12 or newer and git; Claude Code is optional.

```bash
git clone https://github.com/eth-medical-ai-lab/GTAgentClinic.git gtagentclinic
cd gtagentclinic
npm ci
npm start
```

- The first `npm start` in a terminal asks once whether the characters may run on your Claude Code login (Claude Haiku, counted toward your own plan, shown in the game's ◆ chip). The answer goes into the git-ignored `agentclinic.local.json`. See [docs/SETUP.md](docs/SETUP.md#4-start-the-game).
- `npm start -- --dev` serves the client through Vite with hot reload; `npm run dev` also restarts the server when you change it.
- Neural voices are a separate install: `npm run voices:install` (about 440 MB). Without them NPCs speak with the browser's voices.
- `npm ci` also points git at `.githooks/`, whose pre-commit hook scans what you commit for secrets.
- [DEVELOPING.md](DEVELOPING.md) covers the flags, the project layout, the agent API and [running other people's branches safely](DEVELOPING.md#running-other-peoples-code-safely).

## With your own Claude Code

Start `claude` in the game folder. It reads [CLAUDE.md](CLAUDE.md): the code map, how to run the checks, and the rules below.

- Your login is yours: each contributor uses their own, on their own computer. Never host the game for other people on your login, never share a login, and never commit `agentclinic.local.json` (it's git-ignored).
- Tests and e2e scripts use offline NPCs (`--llm offline`), so they cost nothing and stay deterministic.
- To check the Claude Code brain itself, on purpose: `npx tsx tests/claude-code-e2e.ts`. It talks to one patient for six turns on your login (about 25k Claude Haiku tokens, $0.002 at API list prices) and checks the replies, the ◆ chip, the usage records and that no `claude` process is left behind.

## Checks

Before a pull request:

```bash
npm run typecheck
npx vitest run                     # same as npm test: simulation, scoring, determinism, NPC brains, first run…
npm run build                      # the client bundle, then a scan of it for secrets
node scripts/notices.mjs --check   # THIRD_PARTY_NOTICES.md is current
```

If you touched `content/`: `npm run cases:check` and `npm run library:check`.

The browser checks run the real game in headless Chromium on your GPU. Each starts its own server on a random port (never 5317, where your own game may be running) and stops it at the end. Run the ones near your change:

```bash
npx tsx tests/movement-e2e.ts      # walking, running, jumping, the camera
npx tsx tests/tablet-e2e.ts        # the patient and staff tablet
npx tsx tests/fullscreen-e2e.ts    # full screen, Esc, menus and tablet at common screen sizes
ls tests/*-e2e.ts                  # the others
```

Most use [tests/harness.ts](tests/harness.ts). Screenshots go to `shots/` (git-ignored); attach the relevant ones to your pull request.

### Visual QA

Most of the bugs players find are visual: something floating, a hand through a table, a cup from nowhere. Every new feature or scripted scene ships with a storyboard scene in `tests/storyboard.ts` (`npm run storyboard -- --scene=<id>`): contact sheets from fixed cameras and the player's eyes, with an audit of what rests on what, what clips into what, and whose hands are where. Read the sheets from at least two angles before you call it done, and attach them to the pull request. The checklist and the rules: [docs/VISUAL_QA.md](docs/VISUAL_QA.md).

## Project rules

- **No brand names or logos**: generic equipment and signage, invented hospital and company names, drugs by their generic names.
- **Assets must be CC0, public domain, OFL or MIT-compatible**, credited in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and in a `CREDITS.txt` next to the files. Run `node scripts/notices.mjs` after adding assets, library cases or dependencies; `--check` must pass.
- **Keep runs reproducible.** The same map, seed and actions must give the same shift, for humans and AI doctors alike: randomness only through the session's seeded generator, and LLM replies change the simulation only through validated, structured actions. The determinism tests in `npx vitest run` (`sim`, `aiDoctor`, `escalation`, `hygiene`) must pass, and the scripted demo agent should keep its baseline (`npm run agent:demo`: about 96% on Night Shift, seed 2024).
- **Keep the information firewall.** `content/` holds each case's hidden truth; the browser only ever gets what `server/sim/views.ts` builds from observed state. Never import `content/` from `client/`.
- **Never commit secrets.** Keys live in the server's environment only, never in `client/` code or a `VITE_` variable ([SECURITY.md](SECURITY.md)). The pre-commit hook and `npm run check:secrets` scan for them. The game never reads, copies or stores Claude credentials; keep it that way.
- **Stop any server you start**, and any browser or `claude` process. Stop them by their process id, never with `pkill` or `killall`, and leave port 5317 alone.
- **No personal data in external requests**: no names, emails or account details in User-Agent strings, API parameters or logs. Use a generic User-Agent.
- **Clinical content** follows [docs/CONTENT_GUIDE.md](docs/CONTENT_GUIDE.md), and case-library cases [docs/CASE_LIBRARY.md](docs/CASE_LIBRARY.md).
- **Docs and in-game text** are clear and short. Add user-visible changes to [CHANGELOG.md](CHANGELOG.md).

## Licence of your contribution

By opening a pull request, you release your contribution under the project's licences ([NOTICE](NOTICE)):

- **Code, documentation and assets you made:** the [Apache License 2.0](LICENSE). Its section 5 covers contributions.
- **Clinical cases and case sheets** (`content/cases/`, `content/library/`, `docs/cases/`, `docs/library/`): [CC BY 4.0](LICENSE-CASES).

Submit only work you have the right to share. Third-party material keeps its own licence and is credited as the project rules above say; case-library sources must be CC BY or CC0.

## Pull requests

Keep them small and focused. Say what changed and why, which checks you ran, and add screenshots for anything visual. `main` is the nightly: everything merged there reaches players on their next `git pull`.
