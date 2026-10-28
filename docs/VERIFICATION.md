# Verification evidence

This record separates simulated provider tests from actual services and deployment checks. Implementation used the isolated Supabase preview project and synthetic source material. Credentials, tokens, raw provider bodies and account passwords are excluded from this document.

| Evidence | Result | What it establishes |
|---|---|---|
| Unit checks | 17 passed: 9 processing, 8 AI | Real PDF/DOCX/TXT parsing, stable locators, upload rejection, bounded decompression and EXIF removal. AI responses are mocked here; checks cover schema rejection, foreign/fabricated source IDs, injected instructions, preserved wording, transcript segments and safe provider errors. |
| Database integration | 13 passed against real preview Postgres | Tenant and case isolation, assigned versus unassigned counselors, forged metadata rejection, write/evidence guards, composite references, approval enforcement, snapshot immutability, anonymous denial and private Storage configuration. Test data is transactionally rolled back. |
| Supabase security advisor | No findings at implementation check | Advisor inspection of the migrated preview schema. This is not a penetration-test certification. |
| Migration and seed | Applied and rerun successfully | Versioned migrations, checksums, isolated-project guard and idempotent seeded accounts. Passwords exist only in ignored local files. |
| Live fresh-account journey | Passed locally | Real Auth, direct private Storage uploads, resume extraction/correction, two photos and persisted ordering/captions, transcription and separate corrections, live generation, preserved user edits, counselor feedback, approval and publication. A separate browser session checks public privacy, unchanged snapshots after draft edits, and revocation. Upload and extraction failures are also exercised. |
| Microphone-denied journey | Passed locally | A simulated denied permission leaves the typed-story alternative usable. The denial itself is injected by the test. |
| Browser recording journey | Passed locally | Actual MediaRecorder recording, visible timer, playback, upload and live transcription. The browser's microphone is fed a known synthetic WAV; this does not claim a test of physical microphone hardware. Re-record and deletion controls are exercised. |
| Real AI provider | Passed in local journey and OIDC smoke | Gateway structured generation with `openai/gpt-5.4-nano` and transcription with `openai/gpt-transcribe`. Responses in these live checks are not fixtures or mocks. Model names remain server-configurable. |
| Sample UI | Persistent workflow evidence captured locally | Isolated sample session, resume review, photo ordering/captions, transcript revision, autosave and reset. Sample AI is explicitly fixture-based. Desktop/mobile screenshots were captured. The earlier browser record contains no page runtime errors and one resource-404 console entry; a final deployed browser check is still required. |
| Production build | Passed with `pnpm build` | Next.js production compilation using `next build --webpack`. This does not establish deployed service behavior. |

The repository includes lint and TypeScript checks plus a secrets-free GitHub Actions workflow for lint, type checking, unit tests and production build. Real database/provider checks require explicit trusted preview configuration and do not run with secrets in untrusted pull requests.

## Pending deployed-preview evidence

At this document revision, deployed-preview verification is still pending. Before declaring preview delivery complete, record the deployment URL and exact feature-branch commit, then exercise authentication, direct Storage uploads, extraction, both AI providers, review, publishing and revoked shared pages/media at that URL. Inspect desktop/mobile views and browser/application errors there. Do not infer these results from the local journey or a successful Vercel build.

Delivery is on `feat/vetcred-mvp` in `jlu27-nd/vetcred`, targeting Vercel team `jon-lu-llc`, project `vetcred`, repository root. The repository began empty; no baseline commit or production promotion to `main` is part of this preview delivery.
