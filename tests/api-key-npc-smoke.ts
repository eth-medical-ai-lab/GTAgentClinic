/** Explicit live check of one real patient NPC turn on a paid API key. Never runs under npm test.
 *  npx tsx tests/api-key-npc-smoke.ts --live openai <model>     (OPENAI_API_KEY)
 *  npx tsx tests/api-key-npc-smoke.ts --live anthropic [model]  (ANTHROPIC_API_KEY)
 */
import { appendicitis } from '../content/cases/appendicitis';
import { patientSpec } from '../server/npc/prompts';
import type { LlmProvider } from '../server/llm/provider';

const [flag, which, model] = process.argv.slice(2);
if (flag !== '--live') throw new Error('Pass --live: this spends money on your API key.');

let provider: LlmProvider;
if (which === 'openai') {
  if (!model) throw new Error('Name the OpenAI model.');
  const { openaiProvider } = await import('../server/llm/vllm');
  provider = await openaiProvider(model);
} else if (which === 'anthropic') {
  const { AnthropicApiProvider } = await import('../server/llm/anthropicApi');
  provider = new AnthropicApiProvider(model);
} else throw new Error('openai or anthropic');

const spec = patientSpec('smoke:patient', 'p1', appendicitis);
const turns = ['Hello, I am the doctor. What brings you in today?', 'Where exactly is the pain, and when did it start?'];
const history: { role: 'user' | 'assistant'; content: string }[] = [];
try {
  for (const message of turns) {
    const r = await provider.chat({ key: spec.key, system: spec.system, schema: spec.schema, history, message });
    if (!r.json || typeof r.json.say !== 'string') throw new Error(`No valid structured reply. Raw text: ${r.text.slice(0, 300)}`);
    console.log(`DOCTOR: ${message}\nPATIENT: ${r.json.say}\n  json keys: ${Object.keys(r.json).join(', ')} | ${r.usage?.inputTokens} in / ${r.usage?.outputTokens} out | ${r.latencyMs} ms\n`);
    history.push({ role: 'user', content: message }, { role: 'assistant', content: r.text });
  }
  console.log(`✓ ${provider.status.label} · ${provider.status.model}: 2 structured patient replies.`);
} finally { provider.dispose(); }
