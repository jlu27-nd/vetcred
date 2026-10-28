import { z } from 'zod';
import type { SourceSegment } from './types';

export const sourceIdsSchema = z.array(z.string().uuid()).min(1).max(30);
export const proposedClaimSchema = z.strictObject({
  category: z.enum(['service', 'education', 'credential', 'capability']),
  original: z.string().min(1).max(6000),
  proposed: z.string().min(1).max(6000),
  sourceIds: sourceIdsSchema,
  fields: z.strictObject({ title: z.string().max(300), organization: z.string().max(300), dates: z.string().max(300), location: z.string().max(300) }),
});
export const claimsResponseSchema = z.strictObject({ claims: z.array(proposedClaimSchema).max(50) });
export const narrativeSchema = z.strictObject({
  title: z.string().min(1).max(160),
  narrative: z.string().min(1).max(6000),
  accomplishment: z.string().min(1).max(1200),
  tags: z.array(z.string().min(1).max(80)).max(8),
  sourceIds: sourceIdsSchema,
  followUp: z.string().min(1).max(600).nullable(),
});
export type NarrativeProposal = z.infer<typeof narrativeSchema>;

/** IDs must have been loaded through the current case's authorization boundary. */
export function assertAuthorizedReferences(ids: string[], sources: SourceSegment[]): void {
  const allowed = new Set(sources.map(source => source.id));
  if (!ids.length || ids.some(id => !allowed.has(id))) {
    throw new Error('The AI returned an unknown source reference. Nothing was applied; please retry.');
  }
}

export function validateClaimsResponse(value: unknown, sources: SourceSegment[]) {
  const parsed = claimsResponseSchema.parse(value);
  for (const claim of parsed.claims) {
    assertAuthorizedReferences(claim.sourceIds, sources);
    // Original wording must be a verbatim excerpt of at least one cited source.
    const cited = sources.filter(source => claim.sourceIds.includes(source.id));
    const normalize = (text:string) => text.replace(/\s+/g, ' ').trim();
    if (!cited.some(source => normalize(source.text).includes(normalize(claim.original)))) {
      throw new Error('The AI changed the original source wording. Nothing was applied; please retry.');
    }
  }
  return parsed;
}

export function validateNarrativeResponse(value: unknown, sources: SourceSegment[]) {
  const parsed = narrativeSchema.parse(value);
  assertAuthorizedReferences(parsed.sourceIds, sources);
  return parsed;
}
