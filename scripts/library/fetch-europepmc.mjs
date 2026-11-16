#!/usr/bin/env node
/**
 * Europe PMC tooling for the case library (content/library/*.json, docs/CASE_LIBRARY.md).
 *
 *   node scripts/library/fetch-europepmc.mjs search "<topic>" [--n 25] [--journal "<abbrev>"] [--any-license] [--sort cited|date]
 *   node scripts/library/fetch-europepmc.mjs fetch PMC123 [PMC456 ...]   cache full text (XML + plain text + metadata)
 *   node scripts/library/fetch-europepmc.mjs show PMC123 [--grep word]  print the cached plain text (or matching lines)
 *   node scripts/library/fetch-europepmc.mjs cite PMC123                print a ready `source` block for a case file
 *   node scripts/library/fetch-europepmc.mjs verify [case.json ...]     check every evidence quote against the cached text
 *   node scripts/library/fetch-europepmc.mjs fmt [case.json ...]        rewrite case files in the canonical compact layout
 *   node scripts/library/fetch-europepmc.mjs retext                     rebuild every cached .txt from its .xml
 *
 * Only open-access articles under CC BY or CC0 are accepted (search filters on the licence; fetch refuses
 * anything else unless --any-license). The cache lives outside the repo (AGENTCLINIC_LIBRARY_CACHE or
 * ~/.cache/GTAgentClinic/library): full texts are never committed, only the paraphrased case and short quotes.
 * Requests are throttled across processes (at most ~2.5 per second) and retried with backoff on 429/5xx.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const LIBRARY_DIR = path.join(ROOT, 'content', 'library');
export const CACHE_DIR = process.env.AGENTCLINIC_LIBRARY_CACHE || path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'GTAgentClinic', 'library');
const API = 'https://www.ebi.ac.uk/europepmc/webservices/rest';
const MIN_GAP_MS = 400;
/** Europe PMC licence values we accept (exact match; "cc by-nc" etc. are rejected) */
const OK_LICENSES = new Set(['cc by', 'cc0']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ───────────────────────────── polite HTTP ─────────────────────────────

/** best-effort global throttle shared by concurrent processes through a timestamp file */
async function throttle() {
  mkdirSync(CACHE_DIR, { recursive: true });
  const stamp = path.join(CACHE_DIR, '.last-request');
  for (;;) {
    let last = 0;
    try { last = Number(readFileSync(stamp, 'utf8')) || 0; } catch { /* first request */ }
    const wait = last + MIN_GAP_MS - Date.now();
    if (wait <= 0) break;
    await sleep(wait + Math.floor(Math.random() * 50));
  }
  writeFileSync(stamp, String(Date.now()));
}

async function get(url, { json = false } = {}) {
  for (let attempt = 0; attempt < 5; attempt++) {
    await throttle();
    let res;
    try {
      res = await fetch(url, { headers: { 'User-Agent': 'AgentClinic-case-library/0.1 (research; polite)' } });
    } catch (e) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (res.status === 429 || res.status >= 500) { await sleep(1500 * 2 ** attempt); continue; }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    return json ? res.json() : res.text();
  }
  throw new Error(`giving up on ${url}`);
}

// ───────────────────────────── JATS XML → plain text ─────────────────────────────

const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '−': '⁻' };

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** every match of <tag ...>...</tag> (non-nested use only: abstract, body, floats-group) */
function blocks(xml, tag) {
  return [...xml.matchAll(new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, 'g'))].map((m) => m[0]);
}

function inner(xml) {
  let s = xml;
  s = s.replace(/<xref[^>]*ref-type="bibr"[^>]*>[\s\S]*?<\/xref>/g, ''); // citation markers
  s = s.replace(/<ref-list[\s\S]*?<\/ref-list>/g, '').replace(/<fn-group[\s\S]*?<\/fn-group>/g, '');
  s = s.replace(/<sup>([\s\S]*?)<\/sup>/g, (_, x) => {
    const t = x.replace(/<[^>]+>/g, '').trim();
    if (!t || /^[,\-–\s]*$/.test(t)) return '';
    return /^[0-9+\-−]+$/.test(t) ? [...t].map((ch) => SUP[ch] ?? ch).join('') : `^${t}`;
  });
  s = s.replace(/<\/(p|title|label|caption|list-item|tr|disp-quote|def-item|sec|table-wrap|fig)>/g, '\n');
  s = s.replace(/<(break|hr)\s*\/?>/g, '\n');
  s = s.replace(/<\/(td|th)>/g, ' | ');
  s = s.replace(/<sec[^>]*>\s*<title>/g, '\n## <title>');
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  s = s.replace(/\[\s*[,;–\-\s]*\]/g, '').replace(/\(\s*[,;–\-\s]*\)/g, '');
  return s;
}

/** readable plain text of a JATS article: title, abstract, body, floating tables and figure captions */
export function jatsToText(xml) {
  const title = (xml.match(/<article-title[^>]*>([\s\S]*?)<\/article-title>/) || [])[1] || '';
  const parts = [`# ${inner(title).trim()}`];
  for (const a of blocks(xml, 'abstract')) parts.push('## Abstract\n' + inner(a));
  for (const b of blocks(xml, 'body')) parts.push(inner(b));
  for (const f of blocks(xml, 'floats-group')) parts.push('## Tables and figures\n' + inner(f));
  return parts
    .join('\n')
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').replace(/ \| *$/, '').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim() + '\n';
}

/** normalisation used to match evidence quotes against source text (tests/case-library.test.ts mirrors it) */
export function normalizeForMatch(s) {
  return s
    .normalize('NFKC')
    .replace(/[­​-‍﻿]/g, '')
    .replace(/[‐-―−﹘﹣－]/g, '-')
    .replace(/[‘’‚‛′`]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

/** does the quote occur in the text? "…" or "..." in a quote marks an elision: fragments must occur in order */
export function quoteFound(text, quote) {
  const hay = normalizeForMatch(text);
  const frags = normalizeForMatch(quote).split(/\s*(?:…|\.\.\.)\s*/).filter(Boolean);
  let at = 0;
  for (const f of frags) {
    const i = hay.indexOf(f, at);
    if (i < 0) return false;
    at = i + f.length;
  }
  return frags.length > 0;
}

// ───────────────────────────── metadata, licence, citation ─────────────────────────────

const pmcidOf = (s) => {
  const m = String(s).toUpperCase().match(/^(?:PMC)?(\d+)$/);
  if (!m) throw new Error(`not a PMCID: ${s}`);
  return `PMC${m[1]}`;
};
export const cachePath = (pmcid, ext) => path.join(CACHE_DIR, `${pmcid}.${ext}`);

/** licence from the article XML (versioned, e.g. "CC BY 4.0"), falling back to Europe PMC's field */
export function licenseOf(xml, epmcLicense) {
  const block = [(xml.match(/<license[\s>][\s\S]*?<\/license>/) || [''])[0], ...(xml.match(/<ali:license_ref[^>]*>[^<]+</g) || [])].join(' ');
  const m = block.match(/creativecommons\.org\/(licenses|publicdomain)\/([a-z-]+)\/(\d\.\d)/i);
  if (m) return m[1] === 'publicdomain' ? `CC0 ${m[3]}` : `CC ${m[2].toUpperCase()} ${m[3]}`;
  const text = block.replace(/<[^>]+>/g, ' ');
  const t = text.match(/(?:CC[ -]?BY(?:[ -]N[CD])*(?:[ -]SA)?|CC0)(?:[ -]?\d\.\d)?/i);
  if (t) return t[0].toUpperCase().replace(/-/g, ' ').replace(/^CC ?BY/, 'CC BY').replace(/ (NC|ND|SA)/g, '-$1');
  // prose only: "distributed under the terms of the Creative Commons Attribution License …"
  const prose = text.match(/Creative Commons Attribution([\s-]+(Non-?Commercial|No-?Deriv\w*|Share-?Alike))*(\s+\d\.\d)?/i);
  if (prose) {
    const mods = [/non-?commercial/i.test(prose[0]) && 'NC', /no-?deriv/i.test(prose[0]) && 'ND', /share-?alike/i.test(prose[0]) && 'SA'].filter(Boolean);
    const ver = (prose[0].match(/\d\.\d/) || text.match(/(?:licen[cs]e|version)\s*(\d\.\d)/i) || [])[1] ?? (prose[0].match(/\d\.\d/) || [])[0];
    return `CC BY${mods.length ? '-' + mods.join('-') : ''}${ver ? ' ' + ver : ''}`;
  }
  return epmcLicense ? epmcLicense.toUpperCase() : 'unknown';
}

export const licenseAccepted = (license) => /^CC BY \d\.\d$|^CC0( \d\.\d)?$|^CC BY$/.test(license);

/** Vancouver-style citation: up to six authors, then "et al." */
export function citationOf(meta) {
  const authors = (meta.authorList?.author ?? []).map((a) => a.fullName || a.collectiveName).filter(Boolean);
  const who = authors.length > 6 ? `${authors.slice(0, 6).join(', ')}, et al` : authors.join(', ');
  const j = meta.journalInfo ?? {};
  const journal = j.journal?.isoabbreviation || j.journal?.medlineAbbreviation || j.journal?.title || meta.bookOrReportDetails?.publisher || '';
  const title = String(meta.title ?? '').replace(/<[^>]+>/g, '').trim().replace(/([^.?!])$/, '$1.');
  const vol = j.volume ? `;${j.volume}${j.issue ? `(${j.issue})` : ''}` : '';
  const pages = meta.pageInfo ? `:${meta.pageInfo}` : '';
  return `${who}. ${title} ${journal}. ${meta.pubYear ?? j.yearOfPublication ?? ''}${vol}${pages}.`.replace(/\s+/g, ' ').trim();
}

export function sourceBlock(pmcid) {
  const meta = JSON.parse(readFileSync(cachePath(pmcid, 'meta.json'), 'utf8'));
  const xml = readFileSync(cachePath(pmcid, 'xml'), 'utf8');
  const src = { pmcid, pmid: meta.pmid, doi: meta.doi, citation: citationOf(meta), license: licenseOf(xml, meta.license), url: `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/` };
  for (const k of Object.keys(src)) if (src[k] === undefined) delete src[k];
  return src;
}

// ───────────────────────────── commands ─────────────────────────────

async function search(topic, { n = 25, journal, anyLicense = false, sort } = {}) {
  let q = `(${topic}) AND (PUB_TYPE:"Case Reports" OR TITLE:"case report" OR TITLE:"case") AND OPEN_ACCESS:Y AND HAS_FT:Y`;
  if (!anyLicense) q += ' AND (LICENSE:"cc by" OR LICENSE:"cc0")';
  if (journal) q += ` AND JOURNAL:"${journal}"`;
  const params = new URLSearchParams({ query: q, format: 'json', resultType: 'core', pageSize: String(Math.min(100, n * 2)) });
  if (sort === 'cited') params.set('sort', 'CITED desc');
  if (sort === 'date') params.set('sort', 'P_PDATE_D desc');
  const j = await get(`${API}/search?${params}`, { json: true });
  const rows = (j.resultList?.result ?? []).filter((r) => r.pmcid && (anyLicense || OK_LICENSES.has(String(r.license).toLowerCase()))).slice(0, n);
  console.log(`${j.hitCount} hits for: ${q}\n`);
  for (const r of rows) {
    const jn = r.journalInfo?.journal?.isoabbreviation || r.journalInfo?.journal?.title || '?';
    const cached = existsSync(cachePath(r.pmcid, 'txt')) ? ' [cached]' : '';
    console.log(`${r.pmcid.padEnd(12)} ${String(r.pubYear).padEnd(5)} ${String(r.license ?? '-').padEnd(9)} cites:${String(r.citedByCount ?? 0).padEnd(4)} ${jn.slice(0, 32).padEnd(32)} ${String(r.title).replace(/<[^>]+>/g, '').slice(0, 120)}${cached}`);
  }
}

async function fetchOne(id, { anyLicense = false, force = false } = {}) {
  const pmcid = pmcidOf(id);
  mkdirSync(CACHE_DIR, { recursive: true });
  if (force || !existsSync(cachePath(pmcid, 'meta.json'))) {
    const j = await get(`${API}/search?${new URLSearchParams({ query: `PMCID:${pmcid}`, format: 'json', resultType: 'core' })}`, { json: true });
    const meta = j.resultList?.result?.[0];
    if (!meta) throw new Error(`${pmcid}: not found in Europe PMC`);
    writeFileSync(cachePath(pmcid, 'meta.json'), JSON.stringify(meta, null, 1));
  }
  if (force || !existsSync(cachePath(pmcid, 'xml'))) writeFileSync(cachePath(pmcid, 'xml'), await get(`${API}/${pmcid}/fullTextXML`));
  const xml = readFileSync(cachePath(pmcid, 'xml'), 'utf8');
  const text = jatsToText(xml);
  writeFileSync(cachePath(pmcid, 'txt'), text);
  const src = sourceBlock(pmcid);
  const ok = licenseAccepted(src.license);
  const words = text.split(/\s+/).length;
  console.log(`${pmcid}: ${ok ? 'OK' : 'REJECT (licence)'} ${src.license} · ${words} words · ${src.citation}`);
  if (!ok && !anyLicense) process.exitCode = 1;
  return src;
}

function cachedText(pmcid) {
  if (existsSync(cachePath(pmcid, 'txt'))) return readFileSync(cachePath(pmcid, 'txt'), 'utf8');
  if (existsSync(cachePath(pmcid, 'xml'))) return jatsToText(readFileSync(cachePath(pmcid, 'xml'), 'utf8'));
  return null;
}

function show(id, { grep } = {}) {
  const pmcid = pmcidOf(id);
  const text = cachedText(pmcid);
  if (text === null) throw new Error(`${pmcid} is not cached; run: fetch ${pmcid}`);
  if (!grep) return void process.stdout.write(text);
  const re = new RegExp(grep, 'i');
  text.split('\n').forEach((l, i) => re.test(l) && console.log(`${String(i + 1).padStart(4)}: ${l}`));
}

const words = (q) => q.split(/\s+/).filter((w) => w && !['…', '...', '|'].includes(w)).length;

/** longest leading run of the quote's words found in the text, for "did you mean" hints */
function nearMiss(text, quote) {
  const hay = normalizeForMatch(text);
  const ws = normalizeForMatch(quote).split(' ');
  let best = 0;
  for (let k = 1; k <= ws.length; k++) if (hay.includes(ws.slice(0, k).join(' '))) best = k; else break;
  if (!best) return '(no leading match)';
  const at = hay.indexOf(ws.slice(0, best).join(' '));
  return `matched ${best}/${ws.length} words; source reads: "${hay.slice(at, at + 220)}…"`;
}

function caseFiles(args) {
  if (args.length) return args.map((a) => path.resolve(a));
  return readdirSync(LIBRARY_DIR).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(LIBRARY_DIR, f));
}

function verify(args) {
  let bad = 0;
  let total = 0;
  for (const file of caseFiles(args)) {
    const c = JSON.parse(readFileSync(file, 'utf8'));
    const pmcid = c.source?.pmcid;
    const text = pmcid ? cachedText(pmcid) : null;
    if (text === null) { console.log(`?? ${path.basename(file)}: source ${pmcid ?? '(no pmcid)'} not cached; run fetch`); bad++; continue; }
    const misses = [];
    if (existsSync(cachePath(pmcid, 'xml'))) {
      const lic = licenseOf(readFileSync(cachePath(pmcid, 'xml'), 'utf8'));
      if (lic !== c.source.license) misses.push(`  source.license is "${c.source.license}" but the article says "${lic}"`);
    }
    for (const e of c.evidence ?? []) {
      total++;
      if (words(e.quote) >= 30) misses.push(`  [${e.field}] ${words(e.quote)} words (limit 29): "${e.quote}"`);
      else if (!quoteFound(text, e.quote)) misses.push(`  [${e.field}] NOT FOUND: "${e.quote}"\n      ${nearMiss(text, e.quote)}`);
    }
    if (misses.length) { bad += misses.length; console.log(`✗ ${path.basename(file)}\n${misses.join('\n')}`); }
    else console.log(`✓ ${path.basename(file)} (${(c.evidence ?? []).length} quotes)`);
  }
  console.log(`\n${total} quotes checked, ${bad} problem(s)`);
  if (bad) process.exitCode = 1;
}

// ── canonical compact JSON: containers stay on one line while they fit in WIDTH columns ──
const WIDTH = 160;
function inlineJson(v) {
  if (Array.isArray(v)) return `[${v.map(inlineJson).join(', ')}]`;
  if (v && typeof v === 'object') {
    const kv = Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inlineJson(x)}`);
    return kv.length ? `{ ${kv.join(', ')} }` : '{}';
  }
  return JSON.stringify(v);
}
export function formatCaseJson(v, indent = '', used = 0) {
  const one = inlineJson(v);
  if (v === null || typeof v !== 'object' || (indent && used + one.length <= WIDTH)) return one;
  const pad = indent + '  ';
  if (Array.isArray(v)) return v.length ? `[\n${v.map((x) => pad + formatCaseJson(x, pad, pad.length)).join(',\n')}\n${indent}]` : '[]';
  const rows = Object.entries(v).map(([k, x]) => {
    const head = `${pad}${JSON.stringify(k)}: `;
    return head + formatCaseJson(x, pad, head.length);
  });
  return `{\n${rows.join(',\n')}\n${indent}}`;
}

function fmt(args) {
  for (const file of caseFiles(args)) {
    const before = readFileSync(file, 'utf8');
    const after = formatCaseJson(JSON.parse(before)) + '\n';
    if (after !== before) { writeFileSync(file, after); console.log(`formatted ${path.relative(ROOT, file)} (${after.split('\n').length - 1} lines)`); }
  }
}

function retext() {
  const xs = readdirSync(CACHE_DIR).filter((f) => /^PMC\d+\.xml$/.test(f));
  for (const f of xs) writeFileSync(path.join(CACHE_DIR, f.replace(/\.xml$/, '.txt')), jatsToText(readFileSync(path.join(CACHE_DIR, f), 'utf8')));
  console.log(`rebuilt ${xs.length} text file(s) in ${CACHE_DIR}`);
}

function flag(args, name, fallback) {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}

async function main(argv) {
  const [cmd, ...args] = argv;
  const anyLicense = args.includes('--any-license');
  const force = args.includes('--force');
  const rest = () => args.filter((a) => a !== '--any-license' && a !== '--force');
  switch (cmd) {
    case 'search': {
      const n = Number(flag(args, '--n', 25));
      const journal = flag(args, '--journal');
      const sort = flag(args, '--sort');
      return search(rest().join(' '), { n, journal, anyLicense, sort });
    }
    case 'fetch': for (const id of rest()) await fetchOne(id, { anyLicense, force }); return;
    case 'show': { const grep = flag(args, '--grep'); return show(rest()[0], { grep }); }
    case 'cite': return void console.log(JSON.stringify(sourceBlock(pmcidOf(rest()[0])), null, 2));
    case 'verify': return verify(rest());
    case 'fmt': return fmt(rest());
    case 'retext': return retext();
    default:
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*?/, '').replace(/^ \* ?/gm, ''));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
}
