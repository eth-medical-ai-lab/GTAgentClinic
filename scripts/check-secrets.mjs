#!/usr/bin/env node
/**
 * check-secrets: dependency-free secret scanner for this repo (see SECURITY.md).
 *
 *   node scripts/check-secrets.mjs               files git would commit (git ls-files -co --exclude-standard)
 *   node scripts/check-secrets.mjs --staged      staged blobs only (the pre-commit hook)
 *   node scripts/check-secrets.mjs --dist[=DIR]  the built client bundle (default dist/client; runs after `npm run build`)
 *   node scripts/check-secrets.mjs PATH...       specific files or directories
 *     --allowlist FILE   allowlist to use (default: .secrets-allowlist at the repo root)
 *
 * Exit status: 0 clean, 1 possible secret found, 2 usage or runtime error.
 * Findings print as file:line:col, the rule and a redacted preview, never the value itself.
 * False positive? Put `check-secrets:allow` (or `gitleaks:allow`) on that line, or add the printed
 * fp:… (or a path:/rule: entry) to .secrets-allowlist.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BYTES = 20 * 1024 * 1024;
const INLINE_ALLOW = /check-secrets:allow|gitleaks:allow/;

// ───────────────────────────── rules ─────────────────────────────

/** words that make an assignment look like a credential (generic rules) */
const KEYWORD = String.raw`(?:api[_.-]?key|apikey|secret|token|passw(?:or)?d|passwd|pwd|auth[_.-]?key|access[_.-]?key|private[_.-]?key|client[_.-]?secret|credentials?)`;

/**
 * id, title, re (global), group (capture holding the secret; default whole match),
 * entropy (min Shannon bits/char of the value), generic (stricter placeholder filtering),
 * show (the match is an indicator, not a secret, so it may be printed).
 */
const RULES = [
  { id: 'anthropic-key', title: 'Anthropic API key or OAuth token', re: /(?<![A-Za-z0-9])sk-ant-[A-Za-z0-9_-]{24,}/g, entropy: 3 },
  { id: 'openai-key', title: 'OpenAI API key', re: /(?<![A-Za-z0-9])sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}|(?<![A-Za-z0-9])sk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}/g, entropy: 3 },
  { id: 'sk-key', title: 'sk-… API key (OpenAI-compatible provider)', re: /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9]{32,}(?![A-Za-z0-9])/g, entropy: 3.5 },
  { id: 'aws-access-key-id', title: 'AWS access key ID', re: /(?<![A-Z0-9])(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}(?![A-Z0-9])/g, entropy: 2.5 },
  { id: 'aws-secret-key', title: 'AWS secret access key', re: /aws_?secret_?access_?key["']?\s{0,3}[:=]\s{0,3}["']?([A-Za-z0-9/+=]{40})(?![A-Za-z0-9/+=])/gi, group: 1, entropy: 4 },
  { id: 'github-token', title: 'GitHub token', re: /(?<![A-Za-z0-9_])(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{60,255})(?![A-Za-z0-9_])/g, entropy: 3 },
  { id: 'gitlab-token', title: 'GitLab token', re: /(?<![A-Za-z0-9_-])glpat-[A-Za-z0-9_-]{20,}/g, entropy: 3 },
  { id: 'google-api-key', title: 'Google API key', re: /(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{35}(?![A-Za-z0-9_-])/g, entropy: 3 },
  { id: 'google-oauth', title: 'Google OAuth token or client secret', re: /(?<![A-Za-z0-9_-])(?:ya29\.[0-9A-Za-z_-]{20,}|GOCSPX-[0-9A-Za-z_-]{28}|1\/\/0[0-9A-Za-z_-]{40,})/g, entropy: 3 },
  { id: 'slack-token', title: 'Slack token or webhook', re: /(?<![A-Za-z0-9-])xox[abposr]-[0-9A-Za-z-]{10,}|(?<![A-Za-z0-9-])xapp-\d-[A-Z0-9]+-\d+-[a-z0-9]+|https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]{20,}/g, entropy: 3 },
  { id: 'stripe-key', title: 'Stripe secret, restricted or webhook key', re: /(?<![A-Za-z0-9_])(?:(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{16,}|whsec_[0-9A-Za-z]{32,})/g, entropy: 3 },
  { id: 'huggingface-token', title: 'Hugging Face token', re: /(?<![A-Za-z0-9_])hf_[A-Za-z0-9]{30,}(?![A-Za-z0-9])/g, entropy: 3 },
  { id: 'npm-token', title: 'npm token', re: /(?<![A-Za-z0-9_])npm_[A-Za-z0-9]{36}(?![A-Za-z0-9])|_authToken\s*=\s*([^\s$"'][^\s"']{8,})/g, entropy: 3 },
  { id: 'private-key', title: 'Private key (PEM, OpenSSH or PGP)', re: /-----BEGIN[A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?-----/g, show: true },
  { id: 'jwt', title: 'JSON Web Token (often a bearer/OAuth token)', re: /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{16,}/g, entropy: 3 },
  { id: 'url-password', title: 'Password embedded in a URL', re: /\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s:@/"'`]{1,64}:([^\s:@/"'`]{6,128})@[^\s"'`]/gi, group: 1, entropy: 2.5, generic: true },
  { id: 'vite-secret-var', title: 'Secret-looking VITE_ variable (Vite inlines VITE_* into the browser bundle)', re: /\bVITE_[A-Z0-9_]*(?:API_?KEY|SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|CREDENTIAL)[A-Z0-9_]*\b/g, show: true },
  { id: 'browser-api-key', title: 'Anthropic SDK browser mode (an API key in browser code)', re: /\bdangerouslyAllowBrowser\s{0,3}:\s{0,3}true\b/g, show: true },
  {
    id: 'generic-secret',
    title: 'Hard-coded credential (quoted)',
    re: new RegExp(String.raw`${KEYWORD}[A-Za-z0-9_.-]{0,30}["']?\s{0,3}(?:=|:=|=>|:)\s{0,3}(["'\x60])([^"'\x60\s\\]{12,200})\1`, 'gi'),
    group: 2,
    entropy: 3.5,
    generic: true,
  },
  {
    id: 'generic-secret',
    title: 'Hard-coded credential (env/YAML style)',
    re: new RegExp(String.raw`^[ \t]*(?:export[ \t]+)?[A-Za-z0-9_.-]{0,40}${KEYWORD}[A-Za-z0-9_.-]{0,40}[ \t]*[=:][ \t]*([^\s"'\x60#;,]{16,300})[ \t]*(?:#.*)?$`, 'gim'),
    group: 1,
    entropy: 3.5,
    generic: true,
  },
];

/** files that should never be committed (or shipped), whatever their content */
const SENSITIVE_FILES = [
  { re: /(^|\/)\.env(\.(?!example$|sample$|template$)[^/]+)?$/i, what: '.env file' },
  { re: /\.(pem|key|p12|pfx|jks|keystore|ppk)$/i, what: 'key or certificate store' },
  { re: /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/, what: 'SSH private key' },
  { re: /(^|\/)(credentials[^/]*|client_secret[^/]*|service[-_]account[^/]*)\.json$/i, what: 'credentials file' },
  { re: /(^|\/)\.(netrc|pgpass)$/, what: 'password file' },
];

const PLACEHOLDER = /example|sample|placeholder|changeme|change[-_]me|your[-_]?(?:api|key|token|secret|pass)|xxxx|\*\*\*\*|\.\.\.|<|>|\$\{|\{\{|%s|dummy|fake|redacted|todo|insert|replace|test/i;

function entropy(s) {
  const counts = new Map();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) h -= (n / s.length) * Math.log2(n / s.length);
  return h;
}

/** true if the value looks like a real secret rather than a placeholder, an expression or a word */
function plausible(rule, value) {
  if (rule.show) return true;
  if (/(.)\1{7,}/.test(value) || /example/i.test(value)) return false;
  if (rule.entropy && entropy(value) < rule.entropy) return false;
  if (!rule.generic) return true;
  if (PLACEHOLDER.test(value) || value.includes('://')) return false;
  if (/^(?:\.{0,2}\/|~\/|[a-z]:\\)/i.test(value)) return false; // a path
  if (!/[0-9]/.test(value) || !/[A-Za-z]/.test(value)) return false; // random secrets mix letters and digits
  if (/^(?:process\.env|import\.meta|env\.|secrets\.|vars\.)/.test(value)) return false;
  return true;
}

const fingerprint = (value) => createHash('sha256').update(value).digest('hex').slice(0, 16);

function preview(rule, value) {
  if (rule.show) return value;
  return `${value.slice(0, Math.min(6, Math.floor(value.length / 5)))}… (${value.length} chars, redacted)`;
}

// ───────────────────────────── allowlist ─────────────────────────────

function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      re += '.*';
      i += glob[i + 2] === '/' ? 2 : 1;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/**
 * .secrets-allowlist, one entry per line (# comments):
 *   fp:<16 hex>            ignore one exact value (the scanner prints it with each finding)
 *   path:<glob>            skip matching files entirely
 *   rule:<rule-id>:<glob>  turn one rule off for matching files
 */
function loadAllowlist(file) {
  const list = { fps: new Set(), paths: [], rules: [] };
  if (!file || !existsSync(file)) return list;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*$/, '').trim();
    if (!line) continue;
    const i = line.indexOf(':');
    const kind = line.slice(0, i);
    const arg = line.slice(i + 1).trim();
    if (kind === 'fp' && /^[0-9a-f]{16}$/i.test(arg)) list.fps.add(arg.toLowerCase());
    else if (kind === 'path' && arg) list.paths.push(globToRegExp(arg));
    else if (kind === 'rule' && arg) {
      const j = arg.indexOf(':');
      list.rules.push({ id: j < 0 ? arg : arg.slice(0, j), re: j < 0 ? /^/ : globToRegExp(arg.slice(j + 1)) });
    } else console.error(`check-secrets: ignoring unrecognized allowlist line in ${file}: ${raw}`);
  }
  return list;
}

// ───────────────────────────── scanning ─────────────────────────────

function lineCol(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, col: offset - starts[lo] + 1 };
}

/** scan one file; `name` is the display path (repo-relative when possible); `read` is only called for files up to MAX_BYTES */
function scanFile(name, size, read, allow, opts) {
  const findings = [];
  if (allow.paths.some((re) => re.test(name))) return findings;
  const ruleOff = (id) => allow.rules.some((r) => r.id === id && r.re.test(name));
  for (const f of SENSITIVE_FILES) {
    if (f.re.test(name) && !ruleOff('sensitive-file')) findings.push({ name, line: 0, col: 0, rule: { id: 'sensitive-file', title: `${f.what} (should never be committed or shipped)`, show: true }, value: path.basename(name) });
  }
  if (size > MAX_BYTES) {
    console.error(`check-secrets: skipped the content of ${name} (larger than ${MAX_BYTES >> 20} MB)`);
    return findings;
  }
  const buf = read();
  if (buf.subarray(0, 8000).includes(0)) return findings; // binary
  const text = buf.toString('utf8');
  let starts = null;
  const spans = []; // one finding per secret: later (more generic) rules skip spans already reported
  for (const rule of RULES) {
    if (ruleOff(rule.id)) continue;
    rule.re.lastIndex = 0;
    for (let m; (m = rule.re.exec(text)); ) {
      if (!m[0]) {
        rule.re.lastIndex++;
        continue;
      }
      const value = rule.group ? m[rule.group] : m[0];
      if (!value || !plausible(rule, value)) continue;
      const offset = m.index + (rule.group ? m[0].indexOf(value) : 0);
      if (spans.some(([a, b]) => offset < b && a < offset + value.length)) continue;
      starts ??= [0, ...[...text.matchAll(/\n/g)].map((n) => n.index + 1)];
      const { line, col } = lineCol(starts, offset);
      if (opts.inline) {
        const lineText = text.slice(starts[line - 1], line < starts.length ? starts[line] : text.length);
        if (INLINE_ALLOW.test(lineText)) continue;
      }
      const fp = fingerprint(value);
      if (allow.fps.has(fp)) continue;
      spans.push([offset, offset + value.length]);
      findings.push({ name, line, col, rule, value, fp });
    }
  }
  return findings;
}

function git(args, cwd, input) {
  const r = spawnSync('git', args, { cwd, input, maxBuffer: 1 << 30 });
  if (r.error || r.status !== 0) return null;
  return r.stdout;
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

/** staged blobs, read in one `git cat-file --batch` (works before the first commit too) */
function stagedFiles(root) {
  // diff the index against HEAD, or against the empty tree before the first commit
  const base = git(['rev-parse', '--verify', '-q', 'HEAD'], root) ? 'HEAD' : git(['hash-object', '-t', 'tree', '--stdin'], root, '')?.toString().trim();
  const changed = base ? git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR', base], root) : null;
  if (!changed) throw new Error('could not list staged files (is this a git repository?)');
  const names = new Set(changed.toString('utf8').split('\0').filter(Boolean));
  const entries = (git(['ls-files', '-s', '-z'], root) ?? Buffer.alloc(0))
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t');
      const [mode, sha, stage] = line.slice(0, tab).split(' ');
      return { mode, sha, stage, name: line.slice(tab + 1) };
    })
    .filter((e) => names.has(e.name) && e.stage === '0' && e.mode !== '160000');
  if (!entries.length) return [];
  // sizes first, so large binary assets are never loaded into memory
  const sizes = git(['cat-file', '--batch-check'], root, entries.map((e) => e.sha).join('\n') + '\n')?.toString().trim().split('\n');
  if (!sizes || sizes.length !== entries.length) throw new Error('git cat-file --batch-check failed');
  entries.forEach((e, i) => (e.size = Number(sizes[i].split(' ')[2])));
  const small = entries.filter((e) => e.size <= MAX_BYTES);
  const out = small.length ? git(['cat-file', '--batch'], root, small.map((e) => e.sha).join('\n') + '\n') : Buffer.alloc(0);
  if (!out) throw new Error('git cat-file --batch failed');
  const blobs = new Map();
  let pos = 0;
  for (const e of small) {
    const nl = out.indexOf(10, pos);
    const header = out.subarray(pos, nl).toString();
    const size = Number(header.split(' ')[2]);
    if (!header.includes(' blob ') || !Number.isFinite(size)) throw new Error(`unexpected git cat-file output: ${header}`);
    blobs.set(e, out.subarray(nl + 1, nl + 1 + size));
    pos = nl + 1 + size + 1;
  }
  return entries.map((e) => ({ name: e.name, size: e.size, read: () => blobs.get(e) ?? Buffer.alloc(0) }));
}

/** a working-tree file entry: size from stat, content read lazily */
function diskFile(name, abs) {
  return { name, size: statSync(abs).size, read: () => readFileSync(abs) };
}

// ───────────────────────────── CLI ─────────────────────────────

function main(argv) {
  const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const gitTop = git(['rev-parse', '--show-toplevel'], process.cwd())?.toString().trim();
  const root = gitTop || scriptRoot;
  let mode = 'tree';
  let distDir = path.join(root, 'dist', 'client');
  let allowFile = path.join(root, '.secrets-allowlist');
  const paths = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--staged') mode = 'staged';
    else if (a === '--dist' || a.startsWith('--dist=')) {
      mode = 'dist';
      if (a.includes('=')) distDir = path.resolve(a.slice(7));
    } else if (a === '--allowlist') allowFile = path.resolve(argv[++i] ?? '');
    else if (a.startsWith('--allowlist=')) allowFile = path.resolve(a.slice(12));
    else if (a === '-h' || a === '--help') {
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*\n?/, '').replace(/^ \* ?/gm, ''));
      return 0;
    } else if (a.startsWith('-')) {
      console.error(`check-secrets: unknown option ${a} (try --help)`);
      return 2;
    } else {
      paths.push(a);
      mode = 'paths';
    }
  }
  const allow = loadAllowlist(allowFile);
  const display = (abs) => {
    const rel = path.relative(root, abs);
    const shown = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : abs;
    return shown.split(path.sep).join('/'); // sensitive-file rules and allowlist globs match on "/", also outside the repo on Windows
  };

  /** one factory per file, returning { name, size, read } (a file may vanish between listing and scanning) */
  let files = [];
  let what;
  if (mode === 'staged') {
    files = stagedFiles(root).map((f) => () => f);
    what = 'staged changes';
  } else if (mode === 'dist') {
    if (!existsSync(distDir)) {
      console.error(`check-secrets: ${display(distDir)} does not exist; build the client first (npm run build)`);
      return 2;
    }
    files = walk(distDir).map((p) => () => diskFile(display(p), p));
    what = `client bundle ${display(distDir)}`;
  } else if (mode === 'paths') {
    for (const p of paths) {
      const abs = path.resolve(p);
      if (!existsSync(abs)) {
        console.error(`check-secrets: no such file or directory: ${p}`);
        return 2;
      }
      for (const f of statSync(abs).isDirectory() ? walk(abs) : [abs]) files.push(() => diskFile(display(f), f));
    }
    what = paths.length === 1 ? display(path.resolve(paths[0])) : `${paths.length} paths`;
  } else {
    const listed = gitTop ? git(['ls-files', '-co', '--exclude-standard', '-z'], root) : null;
    if (listed) {
      files = listed
        .toString('utf8')
        .split('\0')
        .filter(Boolean)
        .map((name) => () => diskFile(name, path.join(root, name)));
      what = 'working tree';
    } else {
      // not a git checkout (e.g. an unpacked tarball): scan the directory minus build output and run logs
      files = walk(root)
        .filter((p) => !/^(dist|data)(\/|$)/.test(display(p)))
        .map((p) => () => diskFile(display(p), p));
      what = `${root} (not a git repository)`;
    }
  }

  const findings = [];
  let scanned = 0;
  for (const make of files) {
    let found;
    try {
      const f = make();
      found = scanFile(f.name, f.size, f.read, allow, { inline: mode !== 'dist' });
    } catch {
      continue; // deleted or unreadable since listing
    }
    scanned++;
    findings.push(...found);
  }

  const n = (k, word) => `${k} ${word}${k === 1 ? '' : 's'}`;
  if (!findings.length) {
    console.log(`check-secrets: no secrets found (${what}, ${n(scanned, 'file')})`);
    return 0;
  }
  findings.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.line - b.line || a.col - b.col));
  console.log(`\ncheck-secrets: ${n(findings.length, 'possible secret')} in ${n(new Set(findings.map((f) => f.name)).size, 'file')} (${what}, ${n(scanned, 'file')} scanned)\n`);
  for (const f of findings) {
    console.log(`  ${f.name}${f.line ? `:${f.line}:${f.col}` : ''}  [${f.rule.id}] ${f.rule.title}`);
    console.log(`      ${preview(f.rule, f.value)}${f.fp ? `   fp:${f.fp}` : ''}`);
  }
  console.log(`
  Real secret? Remove it and ROTATE it: assume it leaked (bundles, logs and git history keep copies).
  Keys belong in the server's environment only (see .env.example and SECURITY.md).
  False positive? Add "check-secrets:allow" to that line, or its fp:... line to .secrets-allowlist.
`);
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(`check-secrets: ${e.message}`);
    process.exitCode = 2;
  }
}
