import type { LibrarySource } from '../../shared/caseLibrary';

export type CaseAuthor =
  | { kind: 'ai'; tool: string; model: string; reasoning?: string }
  | { kind: 'human'; contributorId: string }
  | { kind: 'unknown' };

interface Origin {
  author: CaseAuthor;
  /** Repository-relative authoring or record file, for reproducible review. */
  file: string;
  method: string;
  review: 'unreviewed' | 'not recorded' | { reviewerId: string; date: string; scope: string };
}

export type CaseProvenance =
  | (Origin & { kind: 'original' | 'legacy' })
  | (Origin & { kind: 'adapted'; dataset: string; recordId: string; source: LibrarySource });

export const codexAuthor: CaseAuthor = { kind: 'ai', tool: 'Codex', model: 'GPT-6' };

export function authorLabel({ author }: CaseProvenance): string {
  return author.kind === 'ai' ? [author.tool, author.model, author.reasoning].filter(Boolean).join(' · ')
    : author.kind === 'human' ? author.contributorId : 'Not recorded';
}

export function reviewLabel({ review }: CaseProvenance): string {
  return typeof review === 'string' ? review : `${review.reviewerId}, ${review.date} (${review.scope})`;
}

export function legacy(file: string): CaseProvenance {
  return { kind: 'legacy', author: { kind: 'unknown' }, file: `content/cases/${file}.ts`,
    method: 'Original project case distributed in Git revision 4baa82d. Individual authorship and source records were not recorded.',
    review: 'not recorded' };
}
