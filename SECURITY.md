# Security

GTAgentClinic runs on your computer. NPCs use scripts or the model connection you select. This page covers where credentials live, who may talk to the game server, how secrets are kept out of the repository and the browser bundle, and what is out of scope.

Please report vulnerabilities privately to the maintainers (for example as a private security advisory on the repository's GitHub page), not in a public issue.

## Where credentials live

| Credential | Where it lives | What the game does with it |
|---|---|---|
| **Claude Code login** (claude.ai subscription or Console login; used only after [your own choice](docs/SETUP.md#claude-code)) | Inside the `claude` binary's own credential store (the macOS Keychain on a Mac) | Runs `claude auth status` and keeps only `loggedIn`, `authMethod` and `subscriptionType` (the first-run question in `npm start`, `server/firstRun.ts`, uses the same check; `scripts/install.sh` reads only `loggedIn`). Spawns sandboxed `claude -p` processes for NPC turns (`server/llm/claudeCode.ts`). It never reads, copies, logs or forwards the token, and never stores anything but your answer (`agentclinic.local.json`). Signing in happens only in Claude Code itself. |
| **`ANTHROPIC_API_KEY`** | The server process's environment | `@anthropic-ai/sdk` reads it inside the server (`server/llm/anthropicApi.ts`). It is not in code, config files, the client bundle, REST/WebSocket responses, logs or run logs. |
| **Codex login** | Codex's own credential store | Starts the unmodified Codex CLI through the SDK. Codex handles authentication. The game does not read or copy login credentials. |
| **`OPENAI_API_KEY`** | The server process's environment | Used only by the OpenAI API connection. Never sent to the browser or a custom server. |
| **`LOCAL_API_KEY`** | The server process's environment | Sent to the custom API server you select. No fallback to an OpenAI or Anthropic key. |

Nothing credential-bearing is sent to the browser or to agents. They get a status label (provider, model and, for Claude Code, the plan tier) plus token and cost counts. Run logs (`data/runs/*.json`) also contain simulation actions and dialogue. The usage ledger (`data/usage.json`) records usage and costs. Neither stores credentials.

The `claude` child processes inherit the server's environment, minus Claude Code's nested-session variables. An `ANTHROPIC_API_KEY` exported in the shell that starts the server is therefore visible to your own `claude` binary too.

Rules for contributors:

- Read keys from `process.env` in `server/` only. Copy [.env.example](.env.example) if you want a file: `.env` is git-ignored and nothing loads it automatically (`node --env-file=.env bin/agentclinic.mjs`, Node 22.12+).
- Never put a key in `client/` code, in `vite.config.ts` `define`, or in a `VITE_`-prefixed variable. Vite inlines all of those into the JavaScript every browser downloads. The bundle scan below fails the build if a key ends up there.
- Never echo environment variables, provider errors with headers, or request bodies containing keys into API responses, WebSocket messages or logs.

## Threat model

AgentClinic is a **local, single-user** program. In scope:

- **Other websites you visit.** Without protection, any page could create sessions and make NPCs talk on your API key, Claude Code login or Codex login: through cross-site requests, through the WebSocket, or by DNS rebinding a domain to `127.0.0.1`. The [Host/Origin guard](#who-may-talk-to-the-server) handles this.
- **Secrets leaking into the repository or the browser bundle.** The [secret scanning](#secret-scanning) pipeline handles this.

Out of scope, by design:

- **Programs running as you on your machine.** They can call the local server like any agent (there is no login), and they could use your Claude login directly anyway.
- **People on your network in LAN mode.** With `--host 0.0.0.0`, anyone who can reach your machine can play and spend your NPC tokens. Use it only on trusted networks, and consider an NPC budget (`--max-usd 0.50` or `--max-tokens 200k`) or `--llm offline`. Starting or stopping an AI doctor (`POST`/`DELETE /api/observe`, which runs Claude Code on your login) is accepted only from this machine; others can still watch with the spectate link.
- **Hidden case truth.** The information firewall (`content/` never reaches the client) protects game integrity, not security.

**A public or hosted deployment is a different system.** Do not expose this server to the internet. A hosted version needs a relay that holds the **operator's API key**, never a player's subscription (see the policy note in [docs/DESIGN.md](docs/DESIGN.md#llm-providers): third-party products may not route their users' requests through Free/Pro/Max plan credentials without approval). It also needs per-user authentication, rate limits and spend caps per user, TLS, and `--allow-host` / `--allow-origin` set to the real domain.

## Who may talk to the server

The game server holds no secret itself, but it spends your NPC tokens. Browsers allow a lot by default:

- Any page can send a "simple" cross-origin POST (for example `text/plain`) without a CORS preflight, and the server parses the body as JSON regardless.
- WebSockets are not covered by CORS at all.
- With DNS rebinding, a page on `evil.example` can reach `127.0.0.1` under its own name, so it even counts as "same-origin".

CORS only stops a page from *reading* responses: the request, and the tokens it spends, would still happen. So `server/security.ts` rejects such requests on the server. It runs at the top of the HTTP request handler, before any route (new `/api` routes are covered automatically), and on every WebSocket upgrade (the game's `/ws` and, in `--dev`, Vite's HMR socket):

1. **Host** (every request) must be one of:
   - `localhost`, `127.0.0.1` or `[::1]`;
   - the `--host` address;
   - any IP address, when bound to all interfaces (`0.0.0.0` / `::`);
   - an `--allow-host` name.

   This defeats DNS rebinding, which needs a domain name the attacker controls; an IP address cannot be rebound (Vite's dev server uses the same rule).
2. **Origin** (`/api`, WebSockets and any non-GET request):
   - **Absent:** allowed. This is curl, the Node agents (`agents/client.ts`, `agents/mcp-server.ts`, `agents/claude-doctor.ts`) and MCP. The exception is a browser marking the request `Sec-Fetch-Site: cross-site` or `same-site` (an `<img>`, `<audio>` or link pointed at the API).
   - **Present:** it must be the server's own origin (the same host and port as `Host`) or an `--allow-origin` entry. `Origin: null` (sandboxed frames, `file:`) is refused.
3. **No wildcard CORS.** The game's own page needs none. `--allow-origin` pages get `Access-Control-Allow-Origin: <that origin>` and `Vary: Origin`.

Plain page loads are not origin-checked, so links from other sites ("challenge a friend", spectate links) still open the game. Refused requests get `403` with an explanation, and each distinct refusal is logged once:

```
[security] blocked POST /api/sessions: Forbidden: cross-origin request from https://evil.example. … (logged once)
```

| Setting | Use |
|---|---|
| `--host 127.0.0.1` (default) | Only this machine can connect. |
| `--host 0.0.0.0` | LAN play. Others join with `http://<your-ip>:5317`. IP addresses are accepted automatically. |
| `--allow-host NAME` or `AGENTCLINIC_ALLOWED_HOSTS` | Extra host names, e.g. `mymac.local`. `.example.com` matches the domain and its subdomains. The flag is repeatable or comma-separated, and in `--dev` it is passed on to Vite's `server.allowedHosts`. |
| `--allow-origin URL` or `AGENTCLINIC_ALLOWED_ORIGINS` | Another page that may call the API, e.g. a frontend served from `http://localhost:3000`. |

These work with `npm start -- …`, `agentclinic …` and `tsx server/index.ts …`. To check by hand, start the server and run:

```bash
curl -i -X POST -H 'Origin: https://evil.example' http://127.0.0.1:5317/api/sessions   # 403
curl -i -H 'Host: evil.example:5317' http://127.0.0.1:5317/api/health                  # 403
curl -i http://127.0.0.1:5317/api/health                                                # 200
```

## Secret scanning

There are four layers, and each one catches what the previous one missed:

1. **`.gitignore`** keeps `.env` and `.env.*` (except `.env.example`), `*.pem`, `*.key`, `*.p12`, `*.pfx`, `credentials*.json` and `.claude/settings.local.json` out of git.
2. **Pre-commit hook** (`.githooks/pre-commit`).
   - **Install:** `npm install` enables it through the `prepare` script (`scripts/install-hooks.mjs`), which runs `git config core.hooksPath .githooks`.
     - It does this only when this folder is the root of its own git work tree.
     - It never fails the install.
     - It leaves an existing custom `core.hooksPath` alone and tells you so.
     - `npm install --ignore-scripts` skips it; run `npm run prepare` afterwards.
   - **What it checks:** the hook scans exactly what the commit will contain (the staged blobs), then runs [gitleaks](https://github.com/gitleaks/gitleaks) too if it is installed (`brew install gitleaks`).
   - **Bypass:** `git commit --no-verify` skips the hook, but CI still checks.
3. **Bundle scan.** `npm run build` scans `dist/client` afterwards (`postbuild`). `npm start` / `agentclinic` scan the bundle after their own rebuild too, and refuse to serve a bundle with a finding.
4. **CI** (`.github/workflows/ci.yml`, on every push and pull request) runs:
   - the scanner over all tracked files;
   - typecheck, tests and build (including the bundle scan);
   - gitleaks over the full git history.

The scanner is `scripts/check-secrets.mjs` and has no dependencies:

```bash
npm run check:secrets                          # every file git would commit (tracked + untracked, minus ignored)
node scripts/check-secrets.mjs --staged        # the staged changes (what the hook runs)
node scripts/check-secrets.mjs --dist          # the built client bundle
node scripts/check-secrets.mjs path/ file.txt  # anything else
```

**What it detects:**

- **Provider keys and tokens:** Anthropic (API keys and OAuth tokens), OpenAI and other `sk-…` keys, AWS, GitHub, GitLab, Google (API keys, OAuth tokens, client secrets), Slack, Stripe, Hugging Face and npm.
- **Private keys and tokens:** PEM, OpenSSH and PGP private keys; JSON Web Tokens; passwords embedded in URLs.
- **Browser-bound secrets:** `VITE_` variables whose names look secret, and the Anthropic SDK's browser opt-in flag.
- **Hard-coded credentials:** generic high-entropy `api_key = "…"` / `token: "…"` / `SECRET=…` assignments.
- **Sensitive files:** `.env`, key stores, SSH keys and credentials files.

Placeholders such as `sk-ant-...`, `${TOKEN}` or `process.env.X` are ignored.

**Output:**

- Findings show `file:line:col`, the rule, a redacted preview and a fingerprint. The value itself is never printed, so CI logs are safe.
- Exit status: `0` clean, `1` findings, `2` usage error.

**False positives:**

- Add `check-secrets:allow` (or `gitleaks:allow`) to that line.
- Or add an entry to [.secrets-allowlist](.secrets-allowlist): `fp:<fingerprint>` for one value, `path:<glob>` for files, `rule:<id>:<glob>` for one rule. Inline markers do not apply to `--dist`.
- Test fixtures should build key-shaped strings at run time (see `tests/check-secrets.test.ts`) instead of committing them.

**If a real secret leaks, rotate it first.** For an API key, revoke it in the Anthropic Console and create a new one. For a Claude Code login, sign out (`/logout`) and back in. Then remove the secret. If it was committed, assume it is public even after rewriting history: forks, clones, CI logs and built bundles keep copies.
