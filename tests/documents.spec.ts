import { test, expect } from '@playwright/test';
import type { Workspace } from '../src/lib/types';
import { DOCX_MIME } from '../src/lib/processing';
import { makePdf, makeDocx } from './fixtures/documents';
import { createIsolatedVeteran } from './fixtures/accounts';
import { previewHeaders } from './preview-access';

test.skip(process.env.VETCRED_RUN_LIVE_E2E !== '1', 'Requires isolated preview configuration and explicit live-test opt-in; creates a new test account and uses real providers.');

const fixtures = [
      { name: 'synthetic-two-page-resume.pdf', mime: 'application/pdf', bytes: makePdf(['Coordinated medical supplies.', 'Education completed in 2023.']), expected: [
        { locator: 'PDF page 1', text: 'Coordinated medical supplies.' },
        { locator: 'PDF page 2', text: 'Education completed in 2023.' },
      ] },
      { name: 'synthetic-two-paragraph-resume.docx', mime: DOCX_MIME, bytes: makeDocx(['Medical supply coordination.', 'Training in 2021; end date uncertain.']), expected: [
        { locator: 'DOCX paragraph 1', text: 'Medical supply coordination.' },
        { locator: 'DOCX paragraph 2', text: 'Training in 2021; end date uncertain.' },
      ] },
];

for (const fixture of fixtures) {
  test(`deployed ${fixture.name} extracts real text with resolvable source locators`, async ({ playwright, baseURL }) => {
    const account = await createIsolatedVeteran();
    const api = await playwright.request.newContext({ baseURL, extraHTTPHeaders: previewHeaders() });
    try {
      const login = await api.post('/api/auth', { data: { action: 'login', email: account.email, password: account.password } });
      expect(login.status(), 'Isolated document account signs in').toBe(200);
      const authorization = await api.post('/api/uploads', { data: { caseId: account.caseId, kind: 'resume', name: fixture.name, mime: fixture.mime, size: fixture.bytes.length } });
      expect(authorization.status(), `${fixture.name} upload authorized`).toBe(200);
      const { uploadUrl, assetId } = await authorization.json() as { uploadUrl: string; assetId: string };
      // A separate fetch carries neither app cookies nor Vercel access headers.
      const storage = await fetch(uploadUrl, { method: 'PUT', headers: { 'content-type': fixture.mime }, body: new Uint8Array(fixture.bytes) });
      expect(storage.ok, `${fixture.name} bytes stored privately`).toBe(true);
      const complete = await api.post('/api/uploads/complete', { data: { caseId: account.caseId, assetId }, timeout: 60_000 });
      const finalized = await complete.json();
      expect(complete.status(), `${fixture.name} finalization: ${finalized.error ?? 'ready'}`).toBe(200);
      const before = finalized.workspace as Workspace;
      const extracted = await api.post('/api/command', {
        data: { caseId: account.caseId, revision: before.case.revision, action: 'extractResume', payload: { id: assetId } }, timeout: 180_000,
      });
      const result = await extracted.json();
      expect(extracted.status(), `${fixture.name} extraction: ${result.error ?? 'complete'}`).toBe(200);
      const workspace = result.workspace as Workspace;
      const sources = workspace.sources.filter(source => source.assetId === assetId);
      expect(sources.map(({ locator, text }) => ({ locator, text })).sort((a, b) => a.locator.localeCompare(b.locator))).toEqual(fixture.expected);
      const sourceIds = new Set(sources.map(source => source.id));
      const claims = workspace.claims.filter(claim => claim.sourceIds.some(id => sourceIds.has(id)));
      expect(claims.length, `${fixture.name} yields real, source-linked AI suggestions`).toBeGreaterThan(0);
      expect(claims.every(claim => claim.sourceIds.every(id => sourceIds.has(id)))).toBe(true);
      expect(workspace.case.profile).toEqual(before.case.profile);
    } finally {
      await api.dispose();
    }
  });
}
