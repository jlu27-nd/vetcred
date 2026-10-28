# Verification evidence

This record separates simulated provider tests from actual services and deployment checks. Implementation used the isolated Supabase preview project and synthetic source material. Credentials, tokens, raw provider bodies and account passwords are excluded from this document.

The deployed checks below passed against **commit `a0b523b74e90f5a3660743cb8132213281c7911a`** at [the tested VetCred preview](https://vetcred-oncsgqvps-jon-lu-llc.vercel.app), deployment `dpl_3c37uESjdpn3QBP34V96nv6PdBeB`. They do not establish the behavior of later commits or deployments. A narrow mobile keyboard-navigation fix is being prepared after this tested revision; its final deployment still needs verification.

| Evidence | Result | What it establishes |
|---|---|---|
| Unit checks | 17 passed: 9 processing, 8 AI | Real PDF/DOCX/TXT parsing, stable locators, upload rejection, bounded decompression and EXIF removal. AI responses are mocked here; checks cover schema rejection, foreign/fabricated source IDs, injected instructions, preserved wording, transcript segments and safe provider errors. |
| Database integration | 13 passed against real preview Postgres | Tenant and case isolation, assigned versus unassigned counselors, forged metadata rejection, write/evidence guards, composite references, approval enforcement, snapshot immutability, anonymous denial and private Storage configuration. Test data is transactionally rolled back. |
| Supabase security advisor | No findings at implementation check | Advisor inspection of the migrated preview schema. This is not a penetration-test certification. |
| Migration and seed | Applied and rerun successfully | Versioned migrations, checksums, isolated-project guard and idempotent seeded accounts. Passwords exist only in ignored local files. |
| Live fresh-account journey | Passed locally and on the tested preview; preview 42.6 seconds | Real Auth, direct private Storage uploads, resume extraction/correction, two photos and persisted ordering/captions, transcription and separate corrections, live generation, preserved user edits, counselor feedback, approval and publication. A separate browser session without a VetCred login checks share privacy, unchanged snapshots after draft edits, and revocation of the page and media. Upload and extraction failures and cross-case access denial are also exercised. |
| Microphone-denied journey | Passed locally and on the tested preview; preview 3.9 seconds | A simulated denied permission leaves the typed-story alternative usable. The denial itself is injected by the test. |
| Browser recording journey | Passed locally and on the tested preview; preview 34.8 seconds | Actual MediaRecorder recording, visible timer, playback, direct private upload and live transcription. The browser's microphone is fed a known synthetic WAV; this does not claim a test of physical microphone hardware. Re-record and deletion controls are exercised. All three preview journey tests passed in 1.5 minutes. |
| Real AI provider | Passed in local and deployed journeys and OIDC smoke | Gateway structured generation with `openai/gpt-5.4-nano` and transcription with `openai/gpt-transcribe`. Responses in these live checks are not fixtures or mocks. Model names remain server-configurable. |
| Sample UI | Both deployed browser tests passed: 26.9 and 28.7 seconds | Isolated sample session, resume review, photo ordering/captions, transcript revision, autosave and reset. Sample AI is explicitly fixture-based. Zero page runtime errors, console errors or failed responses were recorded. Desktop and 390-pixel mobile layouts were inspected with no horizontal overflow; screenshots were taken after the navigation closing transition. |
| Authentication callback | Missing and invalid callback requests returned safe 302 redirects on the tested preview | Missing/invalid code handling was exercised. The seeded password-authenticated journey passed; a valid third-party OAuth flow is outside this MVP's configured scope. |
| Production build | Passed with `pnpm build` | Next.js production compilation using `next build --webpack`. This does not establish deployed service behavior. |
| GitHub Actions | [Passed](https://github.com/jlu27-nd/vetcred/actions/runs/40608603434) | Repository automation completed lint, type checking, unit tests and the production build. |

The repository includes lint and TypeScript checks plus a secrets-free GitHub Actions workflow for lint, type checking, unit tests and production build. Real database/provider checks require explicit trusted preview configuration and do not run with secrets in untrusted pull requests.

## Preview access and remaining verification

The recorded run against `a0b523b` took place with Vercel Deployment Protection enabled. Automated browser and application API requests used short-lived, same-project OIDC access scoped to the exact preview origin. Direct Supabase uploads received no Vercel access header. The separate share-viewing browser had authorized Vercel deployment access but no VetCred session. That run establishes application-level sharing isolation, not unrestricted public access.

The user subsequently approved public preview access, and Vercel confirmed Deployment Protection is disabled for the project. A complete run against the final public preview, with `VETCRED_USE_PREVIEW_OIDC=0` and a fully anonymous share-viewing browser, is pending. This configuration change alone is not recorded as a successful public workflow test.

The final mobile keyboard-navigation patch and any deployment created after the tested commit above remain unverified by this record. Record the final commit and URL, rerun the affected browser checks and check deployed application health before attaching this evidence to that newer revision. Do not infer those results from the earlier preview or its successful build.

Delivery is on `feat/vetcred-mvp` in `jlu27-nd/vetcred`, targeting Vercel team `jon-lu-llc`, project `vetcred`, repository root. The repository began empty; no baseline commit or production promotion to `main` is part of this preview delivery.
