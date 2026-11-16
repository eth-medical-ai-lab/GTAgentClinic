# Choose model sources

The title screen's **Default connection** applies to new shifts. The **NPC connection for this shift** selector can override it. Running shifts keep their original connection.

Both controls list Claude Code login, Anthropic API, Codex login, OpenAI API and Custom API (OpenAI-compatible) separately. **No default** leaves NPCs scripted until a shift selects a connection. **Offline** prevents LLM use in new runs. Existing runs keep their connection.

Select **Change…** beside **AI dialogue** to open **AI connections**. Select **Use** to open one connection's settings. Choose its model, then select **Apply and go online** (or **Apply** when already Online). Only Custom API needs a URL. The active connection has an **Edit** button. Closing a form preserves its draft without applying it. The **Offline** button on the title screen disables LLM use for new runs.

The menu also has independent NPC and physician choices:

- **NPC connection for this shift:** patients, families, and staff.
- **Watch an AI doctor:** the physician that uses hospital tools.

The **Clinical actions** mode supports Claude, Codex, vLLM, and the scripted physician. The **Embodied** mode supports Claude and retains its camera, screenshot, and observation controls. NPC selection applies to both modes.

You can play the physician yourself and select only the NPC source. You can also combine sources, such as a Codex physician with vLLM NPCs.

Choices apply to a new shift. They do not change other shifts. The browser saves per-shift choices on this computer. The default connection settings last until the game server restarts. The app does not change `agentclinic.local.json`.

## Codex SDK

No Claude subscription is required. The project installs `@openai/codex-sdk` and its matching Codex CLI.

1. Run `npm install` in the project folder. Skip this if `npm start` already installed the packages.
2. Run `npx codex login` there. Sign in with your ChatGPT account.
3. Run `npm start`. Stop an existing game server with Ctrl+C before restarting it.
4. Select **Codex login** under **NPC connection for this shift**, or **Codex SDK** under **AI doctor**.
5. Start the shift.

The NPC default is `gpt-6-luna`. The physician default is `gpt-6-luna` (for ChatGPT-account compatibility; `gpt-6.1-sol` is also available for accounts that support it). You can enter another model available to your account. The menu also suggests Sol and Astra. Model availability depends on your account.

These requests use saved Codex authentication. With a ChatGPT login, usage counts toward your plan. An API key login uses API billing instead. The game records tokens and shows estimated API-equivalent costs for models in its Codex price table. These estimates are not subscription charges.

Codex works on macOS, Linux and Windows.

The launcher starts unmodified Codex with personal configuration and session persistence disabled. NPC requests use the game's conversation history and no tools. The physician uses Codex's agent loop with only the hospital MCP connection. The game does not read or copy Codex credentials.

The launcher (`scripts/codex-game.mjs`) exists because the SDK cannot pass the two Codex flags that give this isolation (`--ignore-user-config` and `--ephemeral`). On Windows the SDK cannot start a script, so the game starts Node with the launcher as a preload (`NODE_OPTIONS=--import`), which is a workaround. When the SDK can pass these flags itself, use that and remove the launcher and the preload.

## Custom API (OpenAI-compatible)

Use any server that supports the OpenAI-compatible chat API, such as vLLM. It can run on this computer or at a remote HTTP or HTTPS address. Include the port and API path when needed. The game does not install a model server or download model weights.

To set the default, select **Use** beside **Custom API (OpenAI-compatible)** in the **AI connections** dialog. Enter the server URL and model ID. Then select **Apply and go online**, or **Apply** when already Online. Use **Edit** to change the active connection.

This checks the model list without sending a chat request. A failed check keeps the current default. Running shifts keep their existing connection.

The menu choice lasts until the game server restarts. For startup defaults, set `LOCAL_API_URL` and `LOCAL_API_MODEL` in the server environment. The old URL and model variables are no longer read. If the server serves one model, you can leave the model field empty.

To select a different connection for one shift:

1. Select **Custom API (OpenAI-compatible)** for NPCs. The physician control retains its **Local (vLLM)** label.
2. Enter the server URL, including `/v1`. For example: `http://127.0.0.1:8000/v1`.
3. Enter the served model ID. You can leave it empty if the server serves exactly one model.
4. Start the shift.

NPC models must support chat and JSON-schema output. Physician models must support tool calling. Configure vLLM with the tool parser and chat template required by your model. See the official [structured-output guide](https://docs.vllm.ai/en/latest/features/structured_outputs/) and [tool-calling guide](https://docs.vllm.ai/en/latest/features/tool_calling/).

The physician loop sends hospital tool definitions to vLLM, executes each returned call through MCP, and returns the result. It stops at the turn limit or when the shift ends. Stop the physician from the menu or spectator controls.

The NPC and physician can use different URLs and models. If your server requires a key, set `LOCAL_API_KEY` in the game server's environment. Never put keys in URLs or browser fields. This key applies only to custom API connections. It does not fall back to an Anthropic or OpenAI key. The old custom-key variable is no longer read; rename it to `LOCAL_API_KEY` and restart the game.

## OpenAI API key

Set `OPENAI_API_KEY` in the game server's environment, then restart the game. Select **OpenAI API** under **AI dialogue → Change…** or in the NPC selector. The endpoint is fixed at `https://api.openai.com/v1`. Enter a model available to your API account; the initial model is `gpt-6-luna`.

API requests are billed separately from a ChatGPT subscription. The game shows **Estimated API cost** using reported tokens and the same Standard API price table as Codex. It counts uncached input, cache reads, cache writes and output separately, with long-context rates where applicable. Requests use Standard processing. Unknown models or unsupported returned pricing tiers show cost unavailable. Your OpenAI billing account shows actual charges.

Codex login costs remain **Estimated API-equivalent cost**, not subscription charges. Both estimates use the same model rates. Earlier unpriced usage is not recalculated; cumulative totals can be partial.

The OpenAI key is sent only through the OpenAI API connection. Custom connections use `LOCAL_API_KEY`, even if you give one an OpenAI URL.

## Claude and scripted modes

Existing startup settings continue to work. **Use server default** keeps the existing NPC selection. **Scripted** uses no model.

For Claude NPCs, select your Claude Code login or the server's Anthropic API key. Selecting the login and starting a shift authorizes it for that shift. For a Claude physician, the existing opt-in still works. A checkbox also lets you authorize that physician without changing the NPC source.

The scripted physician uses offline NPCs when the menu retains **Use server default**. An explicit NPC choice applies to the scripted physician only on an online server.

## Connection checks and limits

The AI connections dialog checks login availability and the custom server automatically. API entries say **Key configured** or **Key missing**; this does not prove that a key works. **Check again** repeats the checks. Restart the game after changing environment variables.

**Check NPC connection** does not generate a reply. Codex checks its saved login. OpenAI and custom APIs check `/models`. Anthropic checks key presence only. The first reply checks generation and structured-output support.

Invalid setup prevents a shift from starting. A later NPC request failure uses the existing scripted fallback. An AI physician failure stops its run and appears in its status and log.

Use `--max-tokens` to limit NPC usage across the server. Dollar budgets include Codex estimates for supported models; use a token budget for unpriced models and vLLM. Hardware and hosting costs are not included. Codex and vLLM physicians have their own action/turn limit and a two-hour timeout.

## Server and API settings

`--llm codex` selects Codex NPCs at server startup. `--llm vllm` selects vLLM NPCs. Existing `auto`, `api`, `claude-code`, and `offline` values retain their behavior.

| Environment variable | Use |
|---|---|
| `AGENTCLINIC_CODEX_NPC_MODEL` | Default model for `--llm codex` |
| `AGENTCLINIC_CODEX_DOCTOR_MODEL` | Default for a Codex physician API request without a model |
| `AGENTCLINIC_CODEX_BIN` | Optional Codex executable override (on Windows an `.exe`, or a `.js`/`.mjs` file that Node runs) |
| `LOCAL_API_URL` | Default custom API URL, including its port and API path |
| `LOCAL_API_MODEL` | Default custom API model ID |
| `ANTHROPIC_API_KEY` | Anthropic API connection |
| `OPENAI_API_KEY` | OpenAI API connection |
| `LOCAL_API_KEY` | Optional custom API key |

`POST /api/sessions` and the WebSocket `start` message accept an optional `npc` object:

```json
{"source":"vllm","baseUrl":"http://127.0.0.1:8000/v1","model":"my-model"}
```

Sources are `default`, `offline`, `claude`, `codex`, `openai-api`, and `vllm`. Claude accepts `claudeMode: "claude-code"` or `"api"`. Other models use `model`. Omitted `npc` preserves the old behavior.

`POST /api/observe` accepts `agent: "claude" | "codex" | "vllm" | "demo"`, `model`, an independent `npc`, and `baseUrl` for a vLLM physician. `claudeConsent: true` authorizes a Claude physician for that request. Existing `mapId`, `seed`, `pace`, and `maxTurns` fields retain their meanings. Codex bounds hospital tool calls; vLLM bounds model turns.

Only local clients can select explicit model connections or launch physicians. The existing Host and Origin checks still apply.

## Development checks

```bash
npx vitest run tests/llm-sources.test.ts
npx tsx tests/llm-sources-e2e.ts
npm run storyboard -- --scene=llm-sources
```

These checks use offline fixtures. They do not consume model allowance. The browser check exercises real HTTP, SDK process messages, hospital MCP tools, and both menu layouts.

`npx tsx tests/codex-sdk-smoke.ts --live` also tests a real Luna NPC reply and a complete Sol physician shift. This uses your saved Codex login and consumes model allowance. Add `--doctor-only` to skip the NPC request.

### Codex cost estimates

Codex returns token counts, not a bill. Supported models use the separate price table in `server/llm/codexPricing.ts`, verified against OpenAI Standard API prices on 2026-11-15. The usage display labels these amounts **estimated API-equivalent costs**. They do not measure subscription charges or remaining allowance.

The table covers GPT-6 Luna, GPT-6.1 Sol, GPT-6 Astra, GPT-5.6 Sol/Terra/Luna (including the documented `gpt-5.6` alias for Sol), and the published legacy GPT-5.3/5.2/5.1 Codex rates. A price entry does not establish account access or add a model to the menu. GPT-5.6 Sol's published promotional rates currently run through November 30, 2026; recheck prices when updating the table.

Estimates assume Standard processing and 30-minute cache writes, without regional or Fast-mode adjustments. The SDK reports totals per turn; context tiers applied to those totals can overestimate a turn containing several smaller requests. Unknown models or unsupported cache-write rates remain unpriced. Earlier usage is not recalculated. Totals can be partial, and existing NPC dollar budgets include the new estimates.
