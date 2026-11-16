# Setting up GTAgentClinic

For Codex login, OpenAI API or a custom OpenAI-compatible server, see [model source setup](LLM_SOURCES.md). The menu lets you select NPC and AI physician sources independently. Claude is optional.

This guide is for anyone, including people who have never used a terminal. It takes about 15 minutes. You will install one program (Node.js), download the game, and start it. The game then runs on your own computer: a small local server plus your web browser. Scripted NPCs work without an account. For a quick tour, the project site also offers a playable 3D browser demo.

**What you need:** a Mac, Windows or Linux computer from the last few years, about 400 MB of free disk space (about 1.2 GB with the optional neural voices), and Chrome or Edge. Optional: [Claude Code](https://claude.com/claude-code), installed and logged in, to run the characters on your own login.

Contents:
1. [Install Node.js](#1-install-nodejs)
2. [Check your browser](#2-check-your-browser)
3. [Get the game](#3-get-the-game) (or [in one command](#in-one-command-macos-and-linux))
4. [Start the game](#4-start-the-game): the first-run question, full screen, [a Mac app](#a-mac-app-optional)
5. [Choose who talks for the NPCs](#5-choose-who-talks-for-the-npcs): scripts, Claude Code, Codex, API keys, or a custom server
6. [Let Claude Code play the doctor](#6-let-claude-code-play-the-doctor) (optional)
7. [Voices](#7-voices), [ports and other computers](#8-ports-and-other-computers), [updating](#9-updating), [uninstalling](#10-uninstalling)
8. [Troubleshooting](#troubleshooting)

> **Terminal basics.** A terminal is a window where you type commands. macOS: open *Terminal* (Applications → Utilities). Windows: open *Windows Terminal* or *PowerShell* from the Start menu. Linux: open your distribution's terminal. Type or paste a command, then press Enter. Lines that start with `#` below are comments; you don't type them.

## 1. Install Node.js

Node.js runs the game's server. You need **version 22.12 or newer**; the current LTS ("long-term support") release is the right choice.

**macOS**
- Easiest: download the macOS installer marked *LTS* from [nodejs.org](https://nodejs.org) and run it.
- With [Homebrew](https://brew.sh): `brew install node`. (Avoid `brew install node@22`: Homebrew doesn't put versioned formulas on your PATH.)

**Windows**
- Easiest: download the Windows installer (`.msi`) marked *LTS* from [nodejs.org](https://nodejs.org) and run it with the default options. You don't need the optional "tools for native modules".
- Or, in PowerShell: `winget install OpenJS.NodeJS.LTS`

**Linux**
- Distribution packages are often too old (Ubuntu 24.04 ships Node 18). Use [nvm](https://github.com/nvm-sh/nvm): run the install command from its README, open a new terminal, then `nvm install --lts`.

**Check it.** Open a **new** terminal (so it sees the new install) and type:

```bash
node --version
```

You should see `v22.12.0` or a higher number, for example `v26.13.0`. If the game ever finds an older version, it stops and tells you how to update.

## 2. Check your browser

The game draws a realistic 3D hospital with WebGPU, a modern graphics interface in browsers.

| Browser | Status |
|---|---|
| **Chrome or Edge 113+** on Windows, macOS or ChromeOS | Best: WebGPU, High quality by default |
| **Safari 26+** (macOS 26, iOS 26) | WebGPU, works |
| **Firefox** | WebGPU is not switched on by default on every platform yet. The game then uses its WebGL 2 fallback |
| **Chrome on Linux** | WebGPU depends on your GPU driver. Without it, the game uses WebGL 2 |

**The WebGL 2 fallback** is automatic. It renders at *Medium* quality: ambient occlusion, bloom and anti-aliasing, but no soft shadows under the exam lights. If the browser has no graphics acceleration at all (a software renderer), the game picks *Low*. You can switch between Low, Medium, High and Ultra with the 🖥 button in the game.

If the hospital looks blank or very slow, make sure hardware acceleration is on (Chrome: Settings → System → "Use graphics acceleration when available").

## 3. Get the game

**With git** (if you have it; macOS asks to install the developer tools the first time you type `git`):

```bash
git clone https://github.com/eth-medical-ai-lab/GTAgentClinic.git
cd GTAgentClinic
```

**Without git:** on the project's GitHub page, click **Code → Download ZIP**, unzip it, then open a terminal *in that folder*:
- macOS: in Terminal, type `cd ` (with a space), drag the unzipped folder onto the Terminal window, press Enter.
- Windows: open the folder in File Explorer, click the address bar, type `powershell`, press Enter.
- Linux: right-click inside the folder → *Open in Terminal*.

Then install the game's building blocks (about 200 MB in a `node_modules` folder inside the game folder; this takes a minute or two):

```bash
npm ci
```

Warnings such as `npm warn deprecated …` are normal. It should end with `added … packages`.

### In one command (macOS and Linux)

`scripts/install.sh` does steps 3 and 4 for you. It checks git and Node.js 22.12+ (and says how to get them), says whether Claude Code is installed and logged in, clones the game into `./gtagentclinic` (or updates it with `git pull` if that folder exists), runs `npm install` and starts the game:

```bash
curl -fsSL https://raw.githubusercontent.com/eth-medical-ai-lab/GTAgentClinic/main/scripts/install.sh | sh
# another folder, or install without starting:  … | sh -s -- my-folder --no-start
```

Read it first if you like: it is short, installs nothing system-wide and starts nothing in the background.

**With Claude Code** you can also paste this into it, in the folder where the game should go:

> Clone https://github.com/eth-medical-ai-lab/GTAgentClinic.git into gtagentclinic, run npm install there, then start it in the background with `npm start -- --llm claude-code --exit-when-idle` and give me the address it prints.

(`--llm claude-code` is your choice of who talks for the characters, [see below](#claude-code); `--exit-when-idle` stops the game 2 minutes after you close its last browser tab.)

**On Windows,** install [Git](https://git-scm.com/download/win) and Node.js 22 LTS (`winget install Git.Git OpenJS.NodeJS.LTS`), open a new PowerShell, then: `git clone https://github.com/eth-medical-ai-lab/GTAgentClinic.git gtagentclinic`, `cd gtagentclinic`, `npm install`, `npm start`.

### Installing safely

GTAgentClinic runs on your computer like any Node.js project. `npm` downloads about 200 MB of open-source packages, and the game runs them with your user account's permissions. Packages on npm have occasionally been hijacked to steal passwords and tokens, so:

- **Get the game from this repository** and update it with `git pull`. Run copies from forks or pull requests only if you trust their authors.
- **Install the versions the project tested.** `npm ci` installs the exact lockfile versions. `npm start` runs `npm install` to check and install dependencies before launch.
- **Install only what you use.** The neural voices (`npm run voices:install`) add about 440 MB of packages; browser voices need none.
- **Want more isolation?** Run the game in a container or a virtual machine, so it can't see your files. Your Claude Code login isn't available there by design: use offline characters or an API key.

## 4. Start the game

```bash
npm start
```

The first start builds the 3D client (a few seconds). If Claude Code is installed and logged in, it then asks once who talks for the characters:

```
  Claude Code is installed and logged in (Max plan).
  Run the game's characters on your Claude Code login? They use Claude Haiku;
  each line is a small request that counts toward your own plan's usage, shown in game (◆ chip).
  [Y]es / [n]o (offline scripted characters) / [k] I have an API key
  › y
  ● Saved in agentclinic.local.json: the characters run on your Claude Code login (Claude Haiku).
```

*Yes* runs them on your login ([what that means](#claude-code)), *no* keeps the free scripted characters, and *k* explains how to give the game [your own API key](#your-own-api-key) (the key never goes into that file). The answer is saved in `agentclinic.local.json` in the game folder (git-ignored). To change it, start once with `npm start -- --llm claude-code|api|offline`, edit the file, or delete it to be asked again. The question only comes in a terminal, and only while nothing is chosen: no `--llm`, no `AGENTCLINIC_LLM`, no `ANTHROPIC_API_KEY` and no choice in the file. If Claude Code is installed but not logged in, the game says so and starts offline; run `claude` once, log in, then `npm start` again.

Then your browser opens the hospital at **http://127.0.0.1:5317**. The terminal shows what the game is using:

```
  ✚ GTAgentClinic  — a 3D embodied hospital environment for AI and human agents

  ● Default NPC source: Claude Code — your claude.ai login (Max plan) · Claude Haiku (latest)
  ◌ NPC voices: browser voices · Neural voices are optional and not installed: npm run voices:install (about 440 MB), then restart the game.
  ● Hospital open at http://127.0.0.1:5317
```

- **The game runs only while this terminal stays open.** Press <kbd>Ctrl</kbd>+<kbd>C</kbd> in the terminal to close the ED. `npm start -- --exit-when-idle` also closes it 2 minutes after the last game tab.
- If the browser doesn't open by itself, copy the address into Chrome or Edge.
- Pick a shift (start with *Orientation Day*), choose a camera, and press **Start shift**. Press <kbd>H</kbd> in the game for help; the [README](../README.md#controls) lists all controls.
- **Start shift goes full screen and captures the mouse.** A short <kbd>Esc</kbd> closes what's open, or opens the settings when nothing is; holding <kbd>Esc</kbd> leaves full screen. Browsers without keyboard lock leave full screen on the first <kbd>Esc</kbd>. Right-click frees the cursor for panels at the screen edges. Untick *Full screen when the shift starts* in the menu to play in the window.

### A Mac app (optional)

```bash
npm run mac-launcher
```

This makes `~/Applications/GTAgentClinic.app` on your Mac, for this game folder (built locally with `osacompile`, which comes with macOS; nothing is downloaded). Open it from Finder (your home folder → Applications), Spotlight or Launchpad, or drag it to the Dock. It opens a Terminal window that runs `npm start` here, so you see the server: <kbd>Ctrl</kbd>+<kbd>C</kbd> or closing the window stops the game, and it stops by itself 2 minutes after you close the last game tab. Nothing runs in the background. If you move the game folder, run `npm run mac-launcher` again. To remove the app, drag it to the Trash.

## 5. Choose who talks for the NPCs

Patients, families, nurses and consultants are NPCs (non-player characters). Something has to write their replies:

| Connection | What you do | Cost |
|---|---|---|
| **Offline** | Select Offline | Free scripted replies; limited free-form conversation. |
| **Claude Code login** | Install Claude Code, sign in, and approve its use | Your login's billing or plan allowance. |
| **Anthropic API** | Set `ANTHROPIC_API_KEY` before starting the server | Billed to your API account. |
| **Codex login** | Run `npx codex login` after installing the game packages | ChatGPT plan allowance or API billing, depending on login. |
| **OpenAI API** | Set `OPENAI_API_KEY` before starting the server | Billed to your API account. |
| **Custom API (OpenAI-compatible)** | Enter the URL and model; set `LOCAL_API_KEY` if required | Depends on your server. |

**Offline** uses scripts for new shifts and permits only the scripted AI doctor. Running shifts keep their connection. **Online** allows model connections.

**Connections on the title screen.** Select **Change…** beside **AI dialogue** to open **AI connections**. Select **Use** beside a connection, then enter its model. Only **Custom API** also needs a URL. Select **Apply and go online**, or **Apply** when already online. Use **Edit** to change the active default. Closing the dialog does not apply unfinished settings. **Check again** refreshes connection availability.

Claude Code and Codex ask for consent before using your login. Each asks once per server run. A standing choice in `agentclinic.local.json` (`"claudeCode": true` or `"codex": true`) or the matching startup flag also counts as consent. A ChatGPT login uses your plan allowance. An API key login is billed to that key. Setup checks do not generate a reply or prove model access.

**No default** allows per-shift connections while NPCs otherwise remain scripted. **Offline** disables LLM use for new shifts and AI doctor runs. Running shifts keep their original connection and model. Only the computer running the game can change the default. Every open menu receives the update. Menu settings last until the game server restarts. Startup still follows your flags, environment and existing local configuration. Look for `npc=` and `model=` on a shift's `[session]` line to see its connection.


**API keys stay separate.** Anthropic uses `ANTHROPIC_API_KEY`; OpenAI uses `OPENAI_API_KEY`; a custom API uses optional `LOCAL_API_KEY`. Set them in the server environment and restart the game. The old custom-key variable is no longer read. A detected key means **Key configured**, not verified model access. Select **OpenAI API** and enter its model; no custom URL is needed. The lower NPC selector overrides the default for one new shift. See [connection setup](LLM_SOURCES.md).

### Your own API key

1. Create an account in the [Claude Console](https://platform.claude.com) and add credit under *Billing*. API usage is pay-as-you-go and separate from a claude.ai subscription.
2. Create a key on the [API keys page](https://platform.claude.com/settings/keys). It starts with `sk-ant-`. Copy it once; the Console won't show it again.
3. Set it in the terminal you start the game from, then start:

   ```bash
   # macOS / Linux
   export ANTHROPIC_API_KEY="sk-ant-..."
   npm start
   ```
   ```powershell
   # Windows PowerShell
   $env:ANTHROPIC_API_KEY = "sk-ant-..."
   npm start
   ```

   The terminal should now say `Default NPC source: Anthropic API (API key) · claude-haiku-5-5`. The variable lasts until you close that terminal.

**OpenAI or custom API:** set the matching key in the same terminal before starting the game. Replace `YOUR_KEY` below. Set only the keys you need.

```bash
# macOS / Linux
export OPENAI_API_KEY="YOUR_KEY"
# For a custom server that requires authentication:
export LOCAL_API_KEY="YOUR_KEY"
npm start
```

```powershell
# Windows PowerShell
$env:OPENAI_API_KEY = "YOUR_KEY"
# For a custom server that requires authentication:
$env:LOCAL_API_KEY = "YOUR_KEY"
npm start
```

Then open **AI dialogue → Change…** and select **OpenAI API** or **Custom API (OpenAI-compatible)**. Choose a model. For Custom API, also enter the server URL, including its port and API path. See [model sources](LLM_SOURCES.md) for requirements.

**To keep the key in a file instead**, copy `.env.example` to `.env` in the game folder, set the required variables in it, and start with `node --env-file=.env bin/agentclinic.mjs`. The `.env` file is git-ignored.

**Keeping the key safe**
- The key stays in the game server's memory. The game never sends it to the browser, to AI agents, or into logs and run files ([SECURITY.md](../SECURITY.md)).
- Never commit it, paste it into a chat, or put it in the game's client code. If you work on the code: `npm ci` installs a pre-commit hook that blocks commits containing keys, `npm run check:secrets` scans the folder, and the build refuses to serve a browser bundle with a key in it.
- If a key ever leaks, delete it on the API keys page and create a new one.

**What it costs.** Open the ◆ usage chip for tokens and costs by NPC. API calls are billed to the provider account. Codex shows estimated API-equivalent costs, not subscription charges or remaining allowance. OpenAI API shows estimated API costs. Unknown prices remain unavailable; daily and all-time dollar totals can be partial.

Use `npm start -- --max-tokens 200k` for a token budget. `--max-usd 0.50` limits recorded dollar usage, including estimates. It cannot limit sources without prices. When the budget is used, NPCs switch to scripted replies. Totals are stored in `data/usage.json`.

<a id="claude-code"></a>
### Your Claude Code login

GTAgentClinic is an open-source project: everyone who plays or works on it runs their own copy on their own computer. If you use [Claude Code](https://claude.com/claude-code), your copy can run the characters, and the AI doctor in "Watch an AI doctor", through your own local `claude` program on your own login. It's your explicit choice; until you make it, the game never uses your login. Any one of these is that choice:

- answering *yes* to the question of the first `npm start` ([above](#4-start-the-game)), which saves it in `agentclinic.local.json`
- a flag for one run: `npm start -- --llm claude-code`
- an environment variable: `AGENTCLINIC_LLM=claude-code`
- the settings file `agentclinic.local.json` in the game folder (git-ignored, never committed): `{ "claudeCode": true, "llm": "claude-code" }`. With only `"claudeCode": true`, `auto` keeps its order (your API key if set, then your Claude Code login, then offline) and "Watch an AI doctor" may launch Claude, unless the server ends up offline: then nothing uses an LLM ([above](#5-choose-who-talks-for-the-npcs)).

**What it uses.** Claude Haiku by default, the smallest model; set `AGENTCLINIC_MODEL` (for example `AGENTCLINIC_MODEL=sonnet`) for another. Each character line is one small request: about 3,000–5,000 prompt tokens, mostly served from the prompt cache, plus 200–300 output tokens. In one measured conversation, six patient replies took 25k tokens, $0.0018 at API list prices.

**It counts toward your plan's usage,** like your own Claude Code use, and the game shows it. From the first second of a shift, the ◆ chip in the HUD reads *Claude Code · Haiku* with the shift's tokens and their API-equivalent cost (list price, not a bill). Click it for calls, tokens per character, today's total and your plan's usage window, when Claude Code reports it. The debrief repeats the shift's usage. At startup the terminal prints one line, for example:

```
  ! Your choice ("llm": "claude-code" in agentclinic.local.json): the characters and "Watch an AI doctor" may run on your own Claude Code login, on this machine. Don't host it for others or share a login (docs/SETUP.md#claude-code).
```

**The rules: your login, your computer, for you.** Never host the game for other people on your login, and never share a login. LAN mode (`--host 0.0.0.0`) would let others spend your plan, so don't combine the two. These rules follow Anthropic's terms. Under *Authentication and credential use* on [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance) (checked 2026-11-07):

> Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, Max, or Ultra plan credentials on behalf of their users.

The same section says this does not "prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription", and the page's *Acceptable use* section notes that "Advertised usage limits for Pro, Max, and Ultra plans assume ordinary, individual usage of Claude Code and the Agent SDK." The [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) says the same about products built on the SDK. So GTAgentClinic is not a hosted service and has no login of its own: your copy starts your unmodified `claude` program, only after you said yes, and nobody's login is ever shared, hosted or passed through it.

**Your credentials stay inside Claude Code.** The game never reads, copies or stores them. It runs `claude auth status` (and keeps only whether you're logged in, how, and the plan's name) and starts sandboxed `claude -p` processes: no tools, no MCP servers, no CLAUDE.md, hooks or plugins, no session history, in an empty folder ([SECURITY.md](../SECURITY.md)). Signing in always happens in Claude Code's own flow: run `claude`.

**The alternatives stay:** [your own API key](#your-own-api-key), billed per token with the cost in the HUD, or the free offline characters. If `ANTHROPIC_API_KEY` is set as well, Claude Code uses the key in this mode, so you are billed per token (Claude Code's [authentication precedence](https://code.claude.com/docs/en/authentication)).

## 6. Let Claude Code play the doctor

You can keep Claude Code running next to the game and let it work a shift as the resident while you watch in 3D. This is ordinary use of Claude Code: you add the game as an MCP server (a set of tools), and Claude uses the same actions a human player has. It works with any Claude Code login. NPC replies still come from the game server, using whatever you chose in step 5.

1. Start the game (`npm start`) and leave it running.
2. In a second terminal, in the game folder, add the game's tools to Claude Code once:

   ```bash
   claude mcp add agentclinic -e AGENTCLINIC_PACE=1.5 -- node "$PWD/node_modules/tsx/dist/cli.mjs" "$PWD/agents/mcp-server.ts"
   ```

   (`AGENTCLINIC_PACE=1.5` waits 1.5 s between actions so you can follow along. If the game started on another port, add `-e AGENTCLINIC_URL=http://127.0.0.1:<port>`.)
3. Start Claude Code in that folder and ask it to play:

   ```bash
   claude --allowedTools "mcp__agentclinic__*" "Start a Night Shift in AgentClinic and play it to the end. Think aloud."
   ```

   (`--allowedTools` lets Claude use the game's tools without asking you before every action; leave it out to approve them one by one.)

   Claude replies with a spectate link (`http://127.0.0.1:5317/?spectate=…`). Open it to walk the floor as a med student while the AI resident works; press <kbd>T</kbd> to tag along behind it.

In the game's own menu, **Watch an AI doctor** offers the free scripted demo to everyone. Its *Claude* option launches your Claude Code for you, so it needs [your choice](#claude-code) first. `npm run agent:claude` does the same from the terminal; by running it you opt in for that run. For the REST API, the observation format and determinism, see [AI_AGENTS.md](AI_AGENTS.md).

## 7. Voices

Click 🔊 in the game (or tick "Read NPC lines aloud" in the menu) and every character speaks. Out of the box that is your browser's own voices, matched to each character as well as the browser allows.

**Neural voices are optional.** Each character then gets their own voice, made on your computer by the Kokoro-82M model (Apache-2.0). The engine is about 440 MB of packages (mostly the ONNX runtime), so it's a separate install:

```bash
npm run voices:install      # into voices/node_modules; then restart the game
npm run voices:remove       # removes it again
```

`npm install` and `npm ci` in the game folder leave it alone. Without it, the startup line `NPC voices:` and the voice setting in the menu say how to add it.

- **The first neural use downloads the model, about 326 MB,** into `~/.cache/GTAgentClinic/models` (Windows: `%LOCALAPPDATA%\GTAgentClinic\cache\models`; Linux honours `XDG_CACHE_HOME`), outside the game folder. The terminal shows the progress. Until it is ready, NPCs use your browser's built-in voices.
- With voices on, the game server needs about 1 GB more memory. On a small machine, `AGENTCLINIC_TTS_DTYPE=q8` loads a 92 MB version that needs roughly half as much.
- `npm start -- --tts browser` uses browser voices even with the engine installed; `--tts off` keeps NPCs silent.

## 8. Ports and other computers

- The game listens on **127.0.0.1:5317**, which only your own computer can reach.
- If port 5317 is taken, `npm start` picks the next free port and says so. If AgentClinic itself is already running there, it opens that one instead. Choose a port with `npm start -- --port 6000`.
- Other websites you visit cannot control the game or spend your NPC tokens: the server checks every request's Host and Origin headers ([SECURITY.md](../SECURITY.md#who-may-talk-to-the-server)).
- **Playing with others on your network:** `npm start -- --host 0.0.0.0`, then they open `http://<your-ip>:5317`. Anyone who can reach your computer can then play and spend your NPC tokens, so use it only on networks you trust, consider `--max-usd 0.50`, and never combine it with your Claude Code login.

## 9. Updating

- With git: stop the game, then run `git pull` and `npm start`. Each start installs the required dependencies. The 3D client rebuilds itself when the code changed. `main` is the nightly: it gets every change as soon as it lands. Running `scripts/install.sh` again does the same pull and install.
- From a ZIP: download the new ZIP and unzip it, copy over the `data/` folder (your run logs and usage totals) and any `.env` or `agentclinic.local.json` you created, then run `npm start`.

## 10. Uninstalling

1. Stop the game (<kbd>Ctrl</kbd>+<kbd>C</kbd>) and delete the game folder. That removes `node_modules`, the neural voice engine (`voices/node_modules`), the build and your run logs. If you made the Mac app, drag `~/Applications/GTAgentClinic.app` to the Trash.
2. Delete the voice model: `rm -rf ~/.cache/GTAgentClinic` (Windows PowerShell: `Remove-Item -Recurse "$env:LOCALAPPDATA\GTAgentClinic"`).
3. If you added the MCP server: `claude mcp remove agentclinic`. If you ran `npm link`: `npm rm -g agentclinic-hospital`.
4. Uninstall Node.js if you don't need it for anything else (the installer's uninstaller, `brew uninstall node`, or `nvm uninstall <version>`).

## Troubleshooting

`npm start` runs `npm install` before each launch, including after a pull or branch change. Installation requires network access for packages that are not cached.


| Problem | What to do |
|---|---|
| `GTAgentClinic needs Node.js 22.12 or newer` | Install the current LTS ([step 1](#1-install-nodejs)), then open a **new** terminal. `node --version` must show v22.12 or higher. |
| `npm ci` fails | Check your internet connection (a company proxy can block npm), delete the `node_modules` folder and run `npm ci` again. |
| `npm start` says the 3D client did not build | Run `npm ci` again, then `npm start`. If it persists, open an issue with the terminal output. |
| The browser shows a blank page or runs very slowly | Use Chrome or Edge, turn on hardware acceleration, close other heavy tabs, and pick *Low* or *Medium* with the 🖥 button. Opening `http://127.0.0.1:5317/?quality=low` forces Low for one load. |
| NPCs are still "Offline" after you set a key | Set the key in the *same* terminal, *before* `npm start`, and check the `Default NPC source:` line. With a wrong or unfunded key, the terminal shows `[npc] … LLM error` and NPCs fall back to scripted replies. If you once answered *no* to the first-run question, `agentclinic.local.json` says `"llm": "offline"`: start with `npm start -- --llm api`, or delete the file. |
| The first-run question doesn't come | It only comes in a terminal, while nothing is chosen yet (no `--llm`, `AGENTCLINIC_LLM`, `ANTHROPIC_API_KEY`, or choice in `agentclinic.local.json`). Use **AI dialogue → Change…** to select a connection. |
| "Watch an AI doctor" says Claude needs your choice | That is the default. Watch the scripted demo, use [step 6](#6-let-claude-code-play-the-doctor), or [choose your Claude Code login](#claude-code). |
| Windows: Claude Code is installed but the game can't find it | Set `AGENTCLINIC_CLAUDE_BIN` to the full path of `claude.exe` (or of the `claude.cmd` that npm installed) before `npm start`. |
| NPC voices are silent | Check that the tab isn't muted and 🔊 is on. With neural voices, wait for the first download (see the terminal), or start with `--tts browser`. |
| Voices sound like the browser's, not neural | Neural voices are optional: `npm run voices:install`, then restart the game ([Voices](#7-voices)). |
| The game left full screen, or won't go full screen | Holding <kbd>Esc</kbd> leaves full screen on purpose; after a page reload the first click in the game returns to it. Untick *Full screen when the shift starts* in the menu to play in the window. |
| Port 5317 is busy | Nothing to do: the game picks another port and prints it. To pick one yourself: `npm start -- --port 6000`. |
