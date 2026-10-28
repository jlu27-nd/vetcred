# A three-minute VetCred walkthrough

Use a seeded veteran account for the real-provider demonstration. Open the assigned counselor account in a separate browser profile and keep a signed-out browser ready for the share page. Use synthetic files only. Check provider access before presenting; processing time varies and can extend the walkthrough.

The owner approved public preview access, and Vercel Deployment Protection is disabled. Open a published share link in a fresh browser session without a VetCred login or Vercel access header. Private workspace access still requires the seeded account; the sample creates an isolated session for each visitor.

For automated verification of the current public preview, leave `VETCRED_USE_PREVIEW_OIDC` unset or set it to `0`. If your team later enables Deployment Protection, each demonstration browser will also need authorized deployment access. The optional `VETCRED_USE_PREVIEW_OIDC=1` test helper can use a current authorized Vercel OIDC token for that protected environment. It sends deployment access headers only to the exact configured preview origin; direct Supabase uploads receive no such header. Do not paste tokens into URLs or distribute them to demo attendees.

For a predictable fixture walkthrough, choose “Explore a sample.” Say explicitly: **this fictional sample uses labeled sample transcription and writing results; it is not a live AI demonstration.** All sample data is isolated from real veteran cases.

Prepare supported files for the live walkthrough from the repository's synthetic assets. From the repository root, this command writes a TXT resume and two WebP illustrations to ignored `work/demo/`; the audio is already at `public/sample/story.wav`:

```sh
node --import tsx --input-type=module -e "import {mkdir,writeFile} from 'node:fs/promises'; import sharp from 'sharp'; import {SAMPLE_RESUME} from './src/lib/processing.ts'; await mkdir('work/demo',{recursive:true}); await writeFile('work/demo/resume.txt',SAMPLE_RESUME); for (const n of [1,2]) await sharp('public/sample/photo-'+n+'.svg').webp().toFile('work/demo/photo-'+n+'.webp');"
```

| Time | Action | What to show |
|---|---|---|
| 0:00–0:25 | Profile and direction | Alex Morgan, fictional military medic exploring healthcare operations. “Your service. Your story. Your next chapter.” Explain that occupation guides questions rather than proving qualifications. |
| 0:25–1:00 | Upload your resume | Upload `work/demo/resume.txt`, extract, open a source excerpt and its locator. Correct one proposed service field; select and apply it. The profile name and unrelated edits stay intact. |
| 1:00–1:40 | Add photos | Upload two supported photos. Explain what happened, your role, actions and why it mattered. Generate a proposed caption, edit it, select one image for sharing, choose a cover and reorder with the arrow controls. Reload to demonstrate persistence. |
| 1:40–2:20 | Tell your story | Record a short example or upload the provided narration. Transcribe, correct a sentence, then generate. Show original transcript versus correction, revise the narrative and answer the follow-up. Missing results stay missing. Select the accepted story. |
| 2:20–2:40 | Review | In the assigned counselor session, leave feedback. Return to the veteran, mark the draft ready for review, then approve that revision for sharing. The counselor cannot approve on the veteran's behalf. |
| 2:40–3:00 | Publish and share | Publish and open the random link in the signed-out browser. Only selected photos/stories and approved contact fields appear. Edit the draft and refresh the shared page to show its immutable version. Revoke the link and confirm the public page and its photo stop serving. |

Suggested spoken example: “During training, our supplies were spread across several kits. I made a checklist, organized the kits and explained the layout to my teammates. They told me supplies were easier to find. I did not measure a time saving.”

If microphone permission is denied, use the visible typed-story alternative. If a document is scanned, show the manual text-entry alternative. Do not describe a fixture response or a blocked provider request as a successful live integration.
