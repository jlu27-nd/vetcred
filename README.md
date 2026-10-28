# VetCred

**Your service. Your story. Your next chapter.**

Turn military experience into a civilian career portfolio, with your story and supporting evidence connected.

VetCred is a Next.js application for veterans and their assigned transition counselors. The live path uses Supabase Auth, Postgres and private Storage, with Vercel AI Gateway for structured writing suggestions and audio transcription. Veterans control edits, selected media, contact sharing and publication.

## Workflows

- **Add photos:** direct private uploads, validation, progress/retry, thumbnails, context, editable captions, cover selection, accessible ordering and story/timeline associations. Shared derivatives have metadata removed.
- **Upload your resume:** real PDF, DOCX and UTF-8 TXT extraction with page, paragraph or line references. Review original text beside proposed fields, correct selected suggestions, and apply them without replacing unrelated profile edits. Attach supporting documents to claims.
- **Tell your story:** browser recording and audio upload, original recording and machine transcript, separate transcript corrections, editable narrative/accomplishment, capability suggestions and follow-up questions. Typed stories remain available without microphone access.
- **Review and publish:** draft → ready for review → changes requested or veteran-approved for sharing. Assigned counselors leave feedback. Publication freezes an immutable version and creates a random, revocable link. Later edits create a draft; existing published content stays unchanged.

Occupation codes suggest questions, not proof of individual experience. Resume statements remain self-reported. Evidence status and editorial review status are separate; no credential verification, credit, licensure or hiring decision is made by the application.

## Local setup

Use Node.js 24 and pnpm 11.25.0. Commands run at the repository root.

```sh
npm install --global pnpm@11.25.0
pnpm install --frozen-lockfile
```

Create `.env.local` from `.env.example` only if it does not already exist, then configure an **isolated preview Supabase project**. The template explains every variable. Never commit credentials. On PowerShell:

```powershell
if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
```

Set `VETCRED_PREVIEW_PROJECT_REF` to the preview's project reference. Migration and seed scripts require it to match both the Supabase URL and the database host/username. They refuse a mismatched target. Do not point this configuration at a production database.

```sh
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open `http://127.0.0.1:3000`. The idempotent seed creates veteran, assigned counselor, outsider-organization veteran and unassigned counselor accounts. It preserves existing passwords and case edits. Credentials are written only to ignored `work/seed-accounts.json`; open that file locally in a trusted editor. The veteran's seeded case starts blank.

For a local production build:

```sh
pnpm build
pnpm start
```

The build script uses `next build --webpack`. This passed on the implementation machine; Turbopack's CSS worker failed on that Windows environment.

Use an HTTPS deployment or localhost for microphone access. The browser must support an accepted MediaRecorder MIME type; otherwise use audio upload or typed text.

## Configuration and AI

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are browser-safe connection settings. Database URLs and the Supabase secret/service-role key stay server-side. The public Supabase CA certificate in `supabase/certs/` enables database TLS chain and hostname verification.

Set server-only `AI_GENERATION_MODEL` and `AI_TRANSCRIPTION_MODEL` to current Gateway model IDs. The preview configuration uses `openai/gpt-5.4-nano` and `openai/gpt-transcribe`. Model selection is configurable; do not silently replace an unavailable model with sample output.

Gateway authentication uses `AI_GATEWAY_API_KEY` or Vercel OIDC. An explicitly set API key takes precedence over OIDC. Vercel supplies OIDC to deployments; linked local development can use `vercel env pull` to refresh the local token. Real OIDC generation was smoke-tested during implementation. Provider availability, account credits and configured model access still determine whether a later request succeeds.

Prompts are versioned in `src/lib/ai.ts`. Zod validates proposals, source IDs are checked against authorized case sources, and exact original resume excerpts are checked. Source text is untrusted data and is never given tools or workflow authority. Generation creates proposals and preserves accepted user wording.

## Sample mode

“Explore a sample” creates a new authenticated sample account, organization and case for each visitor. It uses the fictional veteran Alex Morgan, a synthetic resume, original synthetic illustrations and generated sample narration with a known transcript. `public/sample/` contains the two illustrations, narration and transcript; `SAMPLE_RESUME` in `src/lib/processing.ts` contains the resume. These fixtures were created for this prototype and depict no real veteran or identity. They are illustrative inputs, not documentary evidence.

Sample transcription and writing results are explicitly labeled fixtures. They do not prove live AI is working. Arbitrary uploads are not represented as successful live AI in sample mode. The real account path uses the provider.

Reset revokes the previous sample's sharing links and starts a new isolated session. Old sample records and objects are retained; reset is not a physical data-deletion service. Sample mode still requires live Supabase Auth, database and Storage configuration.

## Tests

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The 21 unit checks comprise eleven processing/runtime checks for real parsing, validation, image sanitization and safe runtime failures; eight AI checks using **mocked provider responses** for schemas, source integrity, prompt-injection boundaries and error handling; and two portfolio privacy checks. Mocked checks are not provider smoke tests. Production builds also verify PDF worker/native dependency packaging and reject conflicting symlink paths.

For the real database suite, use the isolated preview configuration and opt in explicitly:

```powershell
$env:VETCRED_RUN_DB_TESTS='1'
node --env-file=.env.local node_modules/vitest/vitest.mjs run tests/rls.integration.test.ts
```

The suite uses real Postgres roles/RLS and rolls back its fixtures. It covers tenant/case isolation, counselor assignments, direct Data API write guards, immutable evidence, approval and snapshot integrity, anonymous access and private bucket configuration. Thirteen checks passed against the isolated preview during implementation. Supabase's security advisor also returned no findings at that point.

For the full journey, start the application, run `pnpm db:seed`, and opt in. This creates a fresh preview account, uploads actual files, calls real AI providers and can incur provider usage:

```powershell
$env:VETCRED_RUN_LIVE_E2E='1'
$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:3000'
pnpm test:e2e
```

The Playwright configuration uses installed Microsoft Edge on Windows. On Linux/macOS install Chromium first with `pnpm exec playwright install chromium`. Three live journey checks passed locally: the complete fresh-account portfolio flow, microphone-denied fallback, and actual MediaRecorder capture/playback/upload/transcription using a synthetic test microphone. They used real Supabase and Gateway services, including `openai/gpt-5.4-nano` and `openai/gpt-transcribe`. See [verification evidence](docs/VERIFICATION.md) for scope and deployed-preview status. A production build alone does not validate a deployed application.

The current preview has public deployment access with the owner's explicit approval. Use `VETCRED_USE_PREVIEW_OIDC=0` or leave it unset to verify ordinary anonymous share-page access. If a team later enables Deployment Protection on an authorized `.vercel.app` preview, the journey suite can use `VETCRED_USE_PREVIEW_OIDC=1` with a valid local `VERCEL_OIDC_TOKEN`. The token header is limited to the selected preview origin, including in browser routing; it must never be sent to Storage or another origin. This optional deployment access does not replace application authentication.

CI runs lint, type checking, mocked/unit checks and production build without service credentials. Real database and provider suites are opt-in and must not receive secrets in untrusted pull requests.

## Database and access model

Migrations live in `supabase/migrations/`; `scripts/migrate.ts` applies each once, verifies checksums and serializes migrations with an advisory lock. Create new migration files with the Supabase CLI; never edit an applied migration.

All tenant data has an organization and case boundary. Membership and counselor assignment are database records, never browser-supplied roles. Requests verify Supabase identity, then use an authenticated Postgres transaction and RLS. Narrow server operations elevate only after case authorization. Composite foreign keys and source-link triggers reject cross-case references. Original source segments, feedback and published snapshots are immutable.

Upload authorization creates a fixed object identity, checks category/size and issues a direct-to-Storage capability. Finalization verifies actual bytes and creates clean photo derivatives. Both buckets are private. Processing jobs have durable status, idempotency keys, prompt/model versions, bounded attempts and leases; the request awaits completion. Failed or expired work can be retried without untracked background promises.

Public portfolio loaders return an explicit field allowlist. Raw documents, recordings, transcripts, internal feedback and private source links are excluded. Shared media is served only after checking the active token on each request. Revocation prevents subsequent retrieval; it cannot delete a copy somebody already saved.

## Vercel preview delivery

The intended mapping is GitHub `jlu27-nd/vetcred` → Vercel team `jon-lu-llc` → project `vetcred`, with **repository root** as project root and `feat/vetcred-mvp` as the implementation branch. The repository was empty when implementation began. Initial delivery belongs only on the feature branch; it does not create a baseline commit on `main`. `main` is the intended future production branch, and this work does not promote production.

1. Verify the team, project, GitHub repository and branch before linking or deploying.
2. Attach the separate preview Supabase resource to the **Preview** environment and this feature branch. Configure Auth URLs for the preview's origin and any callback route actually used. Current seeded sign-in uses email/password; no invitation or OAuth callback flow is implemented.
3. Configure the server variables listed in `.env.example` for Preview only. Keep the production database and credentials separate. Set Node.js 24, install command `pnpm install --frozen-lockfile`, build command `pnpm build`, and Next.js framework detection.
4. Run migrations and seed against the isolated preview, with the project-reference guard. Do not run migrations during `next build` or in untrusted PR checks.
5. Deploy the feature branch as a preview. Exercise real authentication, direct uploads, extraction, AI/transcription, review and sharing on the deployed URL; rerun Playwright with `PLAYWRIGHT_BASE_URL` set to that URL. Test public sharing in a separate browser without a VetCred session or deployment access header.
6. Record the exact branch, commit, URL, checks and live-provider results in the handoff. Production promotion is a separate action.

See [the three-minute demo](docs/DEMO.md), [verification evidence](docs/VERIFICATION.md) and [remaining limitations](docs/LIMITATIONS.md).

The owner explicitly approved public preview access, and Vercel Deployment Protection has been disabled for this project. Private VetCred workspaces still require Supabase authentication and case authorization. The sample entry point and valid published share links can be reached without a Vercel login. See the verification record for the exact tested commit and whether a run used protected or ordinary public access.

The repository started empty. GitHub selected the first pushed branch, `feat/vetcred-mvp`, as its default branch; no separate `main` commit was created. Deployment in this delivery uses the Vercel CLI with an explicitly checked Preview target. Automatic Git-triggered deployments are not connected, so a later push alone does not publish an application update.
