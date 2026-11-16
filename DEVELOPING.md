# Developing GTAgentClinic

For people who build on the game: run it from source, script AI doctors, run experiments, or change the code. To just play, see the [README](README.md). To contribute, also read [CONTRIBUTING.md](CONTRIBUTING.md).

## Run from source

You need Node.js 22.12 or newer and git.

```bash
git clone https://github.com/eth-medical-ai-lab/GTAgentClinic.git && cd GTAgentClinic
npm ci                 # the exact versions in package-lock.json; also sets up the pre-commit secret scan
npm start -- --dev     # serves the client through Vite with hot reload
npm run dev            # also restarts the server when you change it
```

`npm start` flags:
- `--llm auto|api|claude-code|codex|vllm|offline` and `--tts kokoro|browser|off`.
- `--port <n>`, `--no-open`, `--dev`.
- `--host 0.0.0.0` to play across your network, with `--allow-host <name>` for each extra host name.
- `--exit-when-idle`: stop 2 minutes after the last game tab closes.
- `--max-tokens 200k` or `--max-usd 0.50`: a budget for NPC replies per run, then scripted replies.

Other ways to run it: `npm link` adds a global `agentclinic` command, and `npm run mac-launcher` adds a Mac app that runs the game in a Terminal window. Once the repository is public, `scripts/install.sh` installs and starts it in one line ([docs/SETUP.md](docs/SETUP.md#in-one-command-macos-and-linux)).

The **browser demo** is a static build with scripted conversations and no server:

```bash
npm run build:demo     # writes dist/demo/, with LICENSE.txt and NOTICE.txt
npm run preview:demo   # http://127.0.0.1:7318/
```

Upload `dist/demo/` to any static host. The website, [gtagentclinic.ai](https://gtagentclinic.ai/), serves it at `/demo/`.

## Running other people's code safely

Checking out a branch and running `npm ci` or `npm start` runs that branch's code, and any dependency it adds, with your user account's permissions. Before you run a pull request from someone you don't know:

- Read the diff, especially `package.json`, `package-lock.json`, `bin/`, `scripts/` and `.githooks/`.
- Prefer a container or a virtual machine that can't see your home folder, SSH keys or Claude login. There, use offline characters (`--llm offline`) or a separate API key.
- In CI, pull requests from forks run without the repository's secrets.

For players, [docs/SETUP.md](docs/SETUP.md#installing-safely) gives the short version.

## Project layout

```
shared/    types (protocol, views, actions), clinical catalog (labs/orders/meds/exam), units, ED floor plan
content/   cases (hidden truth: personas, physiology, labs, imaging, ECG, scoring) and scenarios (maps)
server/    simulation (session, physiology, scoring, views), NPC brains (prompts, dialogue, offline), LLM providers, NPC voices (tts/), HTTP/WS
client/    React UI + three.js world (client/src/world) + AgentChart EHR (client/src/ui/ehr) + ECG renderer
agents/    HTTP client, scripted demo agent, MCP server, Claude-as-doctor launcher
voices/    the optional neural-voice engine (npm run voices:install installs it into voices/node_modules)
docs/      setup, design, art direction, AI agents, content authoring, case sheets
tests/     vitest simulation tests (*.test.ts) and browser checks in headless Chromium (*-e2e.ts)
scripts/   install.sh, the Mac launcher, voices, asset pipelines, secret scanner, case sheets, third-party notices
site/      the README's pictures and the Mac app's icon
```

[CLAUDE.md](CLAUDE.md) has a file-by-file code map. Two rules shape the code:
- **One action space.** A new player capability is an `Action` variant in `shared/types.ts`, handled in `server/sim/session.ts`, so the 3D UI, REST and MCP all get it.
- **The information firewall.** `content/` holds each case's hidden truth. The browser only gets what `server/sim/views.ts` builds from observed state, and `client/` never imports `content/`.

The checks to run before a pull request are in [CONTRIBUTING.md](CONTRIBUTING.md#checks). `npm test` runs the unit tests, including physiology, scoring and seed determinism.

## AI doctors and the agent API

**Let your own Claude Code play the resident (MCP).** Keep Claude Code running next to the game and let it work the shift while you watch in 3D. This is ordinary Claude Code use, with any login: the game adds an MCP server with the same actions a human has. NPC replies use the game server's selected connection ([model sources](docs/LLM_SOURCES.md)). In the game folder, with the game running:

```bash
claude mcp add agentclinic -e AGENTCLINIC_PACE=1.5 -- node "$PWD/node_modules/tsx/dist/cli.mjs" "$PWD/agents/mcp-server.ts"
claude --allowedTools "mcp__agentclinic__*" "Start a Night Shift in AgentClinic and play it to the end. Think aloud."
```

Claude replies with a spectate link (`/?spectate=<sessionId>`). The tools are `list_shifts`, `start_shift`, `observe`, `catalog`, `move`, `talk`, `examine`, `inspect`, `order`, `cancel_order`, `read_chart`, `sign_ecg`, `call`, `escalate`, `set_diagnoses`, `disposition`, `wait` and `end_shift`. If no game server is running (or it runs on another port: add `-e AGENTCLINIC_URL=http://127.0.0.1:<port>`), the MCP server embeds the simulation itself.

**Watch an AI doctor** in the menu offers two control modes:
- **Embodied:** the doctor plays from its own game screen. It navigates with WASD, talks at the bedside and uses the tablet or workstation with mouse and keyboard. Install its browser once with `npx playwright install chromium`. Embodied mode supports Claude only. **Live view** streams in 1080p; **What the AI saw** holds the latest screenshot the doctor requested. See the [embodied mode guide](docs/AI_AGENTS.md#embodied-mode).
- **Clinical actions:** the AI resident's avatar walks to bedsides, the station and the phone while a feed shows its reasoning, actions and results as a teaching transcript. Choose the scripted demo, Claude (Haiku, Sonnet or Opus, which needs [your choice of Claude Code login](docs/SETUP.md#claude-code)), Codex SDK or local vLLM ([model sources](docs/LLM_SOURCES.md)). At the end you see its debrief and its own reflection.

**REST.** Every action is an HTTP call, from any language:

```bash
curl -s -X POST http://127.0.0.1:5317/api/sessions -H 'content-type: application/json' -d '{"mapId":"night_shift","seed":2024}'
curl -s -X POST http://127.0.0.1:5317/api/sessions/<sessionId>/act -H 'content-type: application/json' -d '{"action":{"type":"move","to":"bed_4"}}'
```

```bash
npm run agent:demo                                  # scripted baseline agent over HTTP (~96% on Night Shift, seed 2024); --pace 1.5 to watch it
npm run agent:claude -- --model sonnet --pace 1.5   # your Claude Code plays the resident via MCP (running it is your choice); prints a spectate link
npm run mcp                                         # the MCP server on stdio, for other MCP clients
```

See [docs/AI_AGENTS.md](docs/AI_AGENTS.md) for the REST API, the observation and action spec, MCP tools, determinism and trajectory logs.

## Research use

- **Seeds and determinism.** The same map and `seed` give the same arrivals, lab values, turnaround times and staff behaviour. NPC *wording* varies with an LLM; use offline NPCs (`"llm": "offline"` when creating a session, or `--llm offline`) for fully deterministic rollouts. "Challenge a friend" shares the seed.
- **Step mode.** REST sessions run in step mode by default: game time moves only with the agent's actions (each has a cost in game minutes; `wait` advances the clock), so thinking time is free. `mode: "realtime"` runs the clock like a human's shift.
- **Run logs.** Every finished shift writes `data/runs/<sessionId>.json`: version, map, seed, player, mode, NPC provider, every action with its result, the event log, the debrief and token usage, plus the AI doctor's narration for agent runs. `GET /api/runs/<sessionId>` serves it; `GET /api/runs/<sessionId>/agent-log` serves an observe-mode agent's console output.
- **Token usage.** Totals per day and all-time are kept in `data/usage.json`, and `GET /api/usage` returns them with per-NPC and AI-doctor costs. Claude plan and Codex dollar figures are API-equivalent estimates, not subscription charges. OpenAI API costs are estimates. Unknown prices remain unavailable; totals can be partial.
- **Baselines.** The scripted demo agent (~96% on Night Shift, seed 2024) and Claude via MCP.

## Security

Keys stay in the server environment: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and optional `LOCAL_API_KEY` (see [.env.example](.env.example)). Claude Code and Codex handle their own login credentials. The game does not read or copy them. Keys never enter the browser or repository.

- `npm ci` enables a pre-commit secret scan, and CI runs the same scan plus gitleaks. `npm run build` scans the client bundle, and `npm run check:secrets` scans the tree on demand.
- The server listens on 127.0.0.1 only and answers only its own page and local non-browser clients (agents, MCP, curl). Host and Origin checks stop other websites from driving it, including through DNS rebinding.
- Test hooks for the browser checks exist only with `?debug=1`.

See [SECURITY.md](SECURITY.md).

## Docs

- [Setup guide](docs/SETUP.md): step by step for players (Node.js, browsers, the first-run question, API key and costs, your Claude Code login, voices, the Mac app, ports, updating, uninstalling)
- [Model sources](docs/LLM_SOURCES.md): login, API and custom-server setup; supported NPC and AI-doctor modes
- [Design and architecture](docs/DESIGN.md): vision, information firewall, NPCs, simulation, scoring, voices, soundscape
- [Art direction](docs/ART_DIRECTION.md): rendering pipeline, assets, licences, quality presets
- [AI agents](docs/AI_AGENTS.md): REST, MCP, observation and action spec, embodied mode
- [Writing cases](docs/CONTENT_GUIDE.md), and [case sheets](docs/cases/README.md) for every playable case and map (`npm run cases`)
- [Case library](docs/CASE_LIBRARY.md): grounding rules, how to add cases, source licences, and [reviewer sheets](docs/library/README.md)
- [Roadmap](docs/ROADMAP.md): contributor tracks, each with the files to start from
- [Visual QA](docs/VISUAL_QA.md): storyboards and the support audit
