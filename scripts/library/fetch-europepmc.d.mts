/** Types for the parts of fetch-europepmc.mjs that tests and scripts import. */
export const LIBRARY_DIR: string;
/** cache of Europe PMC full texts (outside the repo): AGENTCLINIC_LIBRARY_CACHE or ~/.cache/GTAgentClinic/library */
export const CACHE_DIR: string;
export function cachePath(pmcid: string, ext: 'xml' | 'txt' | 'meta.json'): string;
export function jatsToText(xml: string): string;
/** normalisation used to match evidence quotes against source text */
export function normalizeForMatch(s: string): string;
/** does the quote occur in the text ("…" marks an elision; fragments must occur in order)? */
export function quoteFound(text: string, quote: string): boolean;
export function licenseOf(xml: string, epmcLicense?: string): string;
export function licenseAccepted(license: string): boolean;
export function formatCaseJson(v: unknown, indent?: string, used?: number): string;
