import { test,expect,type APIRequestContext,type BrowserContext } from '@playwright/test';
import { randomBytes,randomUUID } from 'node:crypto';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { previewPool } from '../scripts/migrate';
import type { SeedAccounts } from '../scripts/seed';
import { emptyProfile,defaultSettings,type Workspace,type Claim } from '../src/lib/types';
import { SAMPLE_RESUME } from '../src/lib/processing';

const live=process.env.VETCRED_RUN_LIVE_E2E==='1';
type Credentials={id:string;email:string;password:string;caseId:string;otherCaseId:string;organizationId:string};

/** Optional protection access, explicitly enabled and restricted to Vercel previews. */
function previewHeaders():Record<string,string>{
  const target=process.env.PLAYWRIGHT_BASE_URL;
  return process.env.VETCRED_USE_PREVIEW_OIDC==='1'&&target&&new URL(target).hostname.endsWith('.vercel.app')&&process.env.VERCEL_OIDC_TOKEN
    ? {'x-vercel-trusted-oidc-idp-token':process.env.VERCEL_OIDC_TOKEN}:{};
}
async function scopePreviewHeaders(context:BrowserContext,baseURL?:string){
  const trusted=previewHeaders();if(!baseURL||!Object.keys(trusted).length)return;
  const origin=new URL(baseURL).origin;
  await context.route('**/*',async route=>{
    const headers={...route.request().headers()};
    delete headers['x-vercel-trusted-oidc-idp-token'];
    if(new URL(route.request().url()).origin===origin)Object.assign(headers,trusted);
    await route.continue({headers});
  });
}

async function freshAccount():Promise<{account:Credentials;seed:SeedAccounts}> {
  const seed=JSON.parse(await readFile(new URL('../work/seed-accounts.json',import.meta.url),'utf8')) as SeedAccounts;
  const pool=previewPool(); // refuses any database that is not the explicitly selected preview
  const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
  const email=`journey-${randomUUID()}@vetcred.example`,password=randomBytes(30).toString('base64url');
  const {data,error}=await admin.auth.admin.createUser({email,password,email_confirm:true});
  if(error||!data.user){await pool.end();throw new Error('Unable to create isolated journey account.');}
  const counselorEmail=`journey-counselor-${randomUUID()}@vetcred.example`,counselorPassword=randomBytes(30).toString('base64url');
  const counselorCreated=await admin.auth.admin.createUser({email:counselorEmail,password:counselorPassword,email_confirm:true});
  if(counselorCreated.error||!counselorCreated.data.user){await pool.end();throw new Error('Unable to create isolated journey counselor.');}
  // Tests must not add cases to the counselor handed to the human demo user.
  seed.counselor={id:counselorCreated.data.user.id,email:counselorEmail,password:counselorPassword};
  const account={id:data.user.id,email,password,caseId:randomUUID(),otherCaseId:randomUUID(),organizationId:randomUUID()};
  const db=await pool.connect();
  try{
    await db.query('begin');
    await db.query('insert into organizations(id,name) values($1,$2)',[account.organizationId,'VetCred isolated journey test']);
    await db.query("insert into memberships(organization_id,user_id,role) values($1,$2,'veteran'),($1,$3,'counselor'),($1,$4,'veteran')",[account.organizationId,account.id,seed.counselor.id,seed.outsider.id]);
    await db.query('insert into cases(id,organization_id,owner_id,profile,settings) values($1,$2,$3,$4,$5)',[account.caseId,account.organizationId,account.id,emptyProfile,defaultSettings]);
    await db.query('insert into cases(id,organization_id,owner_id,profile,settings) values($1,$2,$3,$4,$5)',[account.otherCaseId,account.organizationId,seed.outsider.id,emptyProfile,defaultSettings]);
    await db.query('insert into assignments(organization_id,case_id,counselor_id) values($1,$2,$3)',[account.organizationId,account.caseId,seed.counselor.id]);
    await db.query('commit');
  }catch(error){await db.query('rollback');throw error;}finally{db.release();await pool.end();}
  await mkdir(new URL('../work/',import.meta.url),{recursive:true});
  await writeFile(new URL('../work/journey-accounts.json',import.meta.url),JSON.stringify({account,counselor:seed.counselor},null,2),{mode:0o600});
  return {account,seed};
}

async function login(api:APIRequestContext,account:{email:string;password:string}) {
  const response=await api.post('/api/auth',{headers:previewHeaders(),data:{action:'login',email:account.email,password:account.password}});
  expect(response.status(),'Authenticated sign-in succeeds').toBe(200);
}
async function load(api:APIRequestContext,caseId:string):Promise<Workspace> {
  const response=await api.get(`/api/workspace?caseId=${caseId}`,{headers:previewHeaders()});
  expect(response.status(),'Authorized workspace loads').toBe(200);
  return response.json();
}
async function act(api:APIRequestContext,w:Workspace,action:string,payload:unknown):Promise<{workspace:Workspace;shareUrl?:string}> {
  const response=await api.post('/api/command',{headers:previewHeaders(),data:{caseId:w.case.id,revision:w.case.revision,action,payload},timeout:180_000});
  const result=await response.json();
  if(!response.ok())throw new Error(`${action} failed with HTTP ${response.status()}: ${result.error||'unknown error'}`);
  expect(result.workspace,`${action} returns refreshed persistent state`).toBeTruthy();
  return result;
}
async function upload(api:APIRequestContext,caseId:string,kind:'photo'|'resume'|'audio'|'support',name:string,mime:string,bytes:Buffer,claimId?:string) {
  const response=await api.post('/api/uploads',{data:{caseId,kind,name,mime,size:bytes.length,...(claimId?{claimId}:{})}});
  expect(response.status(),'Upload capability authorized for the current case').toBe(200);
  const authorization=await response.json();
  // No app cookies or OIDC headers are ever sent to the Storage origin.
  const storage=await fetch(authorization.uploadUrl,{method:'PUT',headers:{'content-type':mime},body:new Uint8Array(bytes)});
  expect(storage.ok,'File bytes reach private object storage directly').toBe(true);
  const complete=await api.post('/api/uploads/complete',{data:{caseId,assetId:authorization.assetId},timeout:60_000});
  if(!complete.ok()){const error=await complete.json();throw new Error(`Upload finalization failed: ${error.error||complete.status()}`);}
  const result=await complete.json();
  expect(result.workspace.assets.find((asset:{id:string;status:string})=>asset.id===authorization.assetId)?.status).toBe('ready');
  return {id:authorization.assetId as string,workspace:result.workspace as Workspace};
}

test.describe('real services: fresh veteran through published portfolio',()=>{
  test.skip(!live,'Set VETCRED_RUN_LIVE_E2E=1 with an isolated preview database and AI provider access. This test uploads real bytes and spends provider credits.');
  test('three inputs, correction, counselor review, immutable sharing and revocation',async({playwright,browser,baseURL})=>{
    const {account,seed}=await freshAccount();
    // These contexts make app-origin requests only. Storage uses a separate,
    // header-free fetch below so protection credentials never leave the app.
    const apiOptions={baseURL,extraHTTPHeaders:previewHeaders()};
    const veteran=await playwright.request.newContext(apiOptions),counselor=await playwright.request.newContext(apiOptions),outsider=await playwright.request.newContext(apiOptions),publicAPI=await playwright.request.newContext(apiOptions);
    try{
      await login(veteran,account);let w=await load(veteran,account.caseId);
      expect(w.assets).toHaveLength(0);expect(w.case.profile.name).toBe('');
      w=(await act(veteran,w,'saveProfile',{...w.case.profile,name:'Alex Morgan Journey',headline:'Healthcare operations through service and teamwork',introduction:'I bring practical experience organizing supplies and helping teams communicate clearly.',occupation:'68W',careerDirection:'Healthcare operations',contactEmail:'private-contact@vetcred.example',shareContact:false})).workspace;
      const originalName=w.case.profile.name;
      await expect((await veteran.post('/api/command',{data:{caseId:account.caseId,revision:w.case.revision,action:'publish',payload:{}}})).status()).toBe(409);

      const tooLarge=await veteran.post('/api/uploads',{data:{caseId:account.caseId,kind:'photo',name:'too-large.png',mime:'image/png',size:11*1024*1024}});
      expect(tooLarge.status(),'Oversized files are rejected before object upload').toBeGreaterThanOrEqual(400);
      const unsupported=await veteran.post('/api/uploads',{data:{caseId:account.caseId,kind:'photo',name:'unsafe.svg',mime:'image/svg+xml',size:100}});
      expect(unsupported.status(),'Unsupported types are rejected before upload').toBeGreaterThanOrEqual(400);
      const incomplete=await veteran.post('/api/uploads',{data:{caseId:account.caseId,kind:'resume',name:'interrupted.txt',mime:'text/plain',size:20}});const incompleteAuth=await incomplete.json();
      const notFinished=await veteran.post('/api/uploads/complete',{data:{caseId:account.caseId,assetId:incompleteAuth.assetId}});expect(notFinished.status()).toBeGreaterThanOrEqual(400);
      const recovered=await fetch(incompleteAuth.uploadUrl,{method:'PUT',headers:{'content-type':'text/plain'},body:'Recovered upload OK.'});expect(recovered.ok).toBe(true);
      // Size matches the authorization exactly; retrying completion recovers the stored failed upload.
      expect(Buffer.byteLength('Recovered upload OK.')).toBe(20);
      const retry=await veteran.post('/api/uploads/complete',{data:{caseId:account.caseId,assetId:incompleteAuth.assetId}});expect(retry.status()).toBe(200);

      const photo1=await sharp({create:{width:240,height:160,channels:3,background:'#247c78'}}).withExif({IFD0:{Copyright:'Private original metadata'}}).jpeg().toBuffer();
      const photo2=await sharp({create:{width:240,height:160,channels:3,background:'#d9b88d'}}).png().toBuffer();
      const first=await upload(veteran,account.caseId,'photo','kit-layout.jpg','image/jpeg',photo1);w=first.workspace;
      const second=await upload(veteran,account.caseId,'photo','team-planning.png','image/png',photo2);w=second.workspace;
      const context={happening:'A training exercise with our unit.',role:'I organized medical supply kits.',date:'2022 (approximate)',actions:'I made a checklist, grouped supplies, and explained the layout to colleagues.',matters:'It helped the team find supplies. I did not measure a time saving.'};
      w=(await act(veteran,w,'generatePhoto',{id:first.id,context})).workspace;
      w=(await act(veteran,w,'generatePhoto',{id:second.id,context:{...context,actions:'I explained our kit layout to a teammate.'}})).workspace;
      w=(await act(veteran,w,'savePhoto',{id:first.id,caption:'I organized supply kits so teammates could find what they needed.',selected:true,cover:true})).workspace;
      w=(await act(veteran,w,'savePhoto',{id:second.id,caption:'PRIVATE_UNSELECTED_PHOTO_CAPTION',selected:false})).workspace;
      w=(await act(veteran,w,'reorderPhotos',{ids:[second.id,first.id]})).workspace;
      w=await load(veteran,account.caseId);
      expect(w.assets.find(a=>a.id===second.id)?.data.position).toBe(0);expect(w.assets.find(a=>a.id===first.id)?.data.position).toBe(1);
      expect(w.assets.find(a=>a.id===first.id)?.data.caption).toBe('I organized supply kits so teammates could find what they needed.');

      const resume=await upload(veteran,account.caseId,'resume','PRIVATE_SOURCE_RESUME.txt','text/plain',Buffer.from(SAMPLE_RESUME));w=resume.workspace;
      w=(await act(veteran,w,'extractResume',{id:resume.id})).workspace;
      const service=w.claims.find(claim=>claim.category==='service');expect(service,'Resume proposes service fields for human review').toBeTruthy();
      const corrected:Claim={...service!,selected:true,accepted:'Supported medical supply organization during unit training.',fields:{...service!.fields,title:'Healthcare operations support — reviewed'}};
      w=(await act(veteran,w,'applyClaims',{claims:[corrected]})).workspace;
      expect(w.case.profile.name).toBe(originalName);expect(w.case.profile.service.some(entry=>entry.title==='Healthcare operations support — reviewed')).toBe(true);
      expect(w.claims.find(claim=>claim.id===service!.id)?.accepted).toBe(corrected.accepted);
      const source=w.sources.find(source=>source.id===service!.sourceIds[0]);expect(source?.assetId).toBe(resume.id);expect(source?.locator).toMatch(/Text line \d+/);expect(source?.text.length).toBeGreaterThan(0);
      w=(await act(veteran,w,'savePhoto',{id:first.id,association:w.case.profile.service[0].id})).workspace;
      const support=await upload(veteran,account.caseId,'support','training-excerpt.txt','text/plain',Buffer.from('Synthetic supporting note: Alex organized the supply kits during our training exercise.'),service!.id);w=support.workspace;
      expect(w.claims.find(claim=>claim.id===service!.id)?.evidenceStatus).toBe('supporting_document_attached');

      const unreadable=await upload(veteran,account.caseId,'resume','blank.txt','text/plain',Buffer.from('               \n             '));w=unreadable.workspace;
      const failedExtraction=await veteran.post('/api/command',{data:{caseId:account.caseId,revision:w.case.revision,action:'extractResume',payload:{id:unreadable.id}},timeout:60_000});expect(failedExtraction.status()).toBeGreaterThanOrEqual(400);
      w=await load(veteran,account.caseId);expect(w.jobs.some(job=>job.status==='failed')).toBe(true);

      const audio=await upload(veteran,account.caseId,'audio','spoken-story.wav','audio/wav',await readFile(new URL('../public/sample/story.wav',import.meta.url)));w=audio.workspace;
      w=(await act(veteran,w,'transcribe',{id:audio.id})).workspace;
      const machine=w.assets.find(asset=>asset.id===audio.id)!.data.machineTranscript;expect(machine?.length).toBeGreaterThan(30);
      const correction='During a unit training exercise, medical supplies were spread across several kits. I personally made an inventory checklist and organized the kits. I do not recall the outcome.';
      w=(await act(veteran,w,'saveTranscript',{id:audio.id,text:correction})).workspace;
      expect(w.assets.find(asset=>asset.id===audio.id)?.data.machineTranscript).toBe(machine);expect(w.assets.find(asset=>asset.id===audio.id)?.data.correctedTranscript).toBe(correction);
      w=(await act(veteran,w,'generateStory',{assetId:audio.id})).workspace;
      const voice=w.stories.find(story=>story.kind==='voice');expect(voice).toBeTruthy();expect(voice?.followUp,'Incomplete outcomes trigger a follow-up question').toBeTruthy();
      const editedNarrative='I made an inventory checklist and organized the medical kits during training.';
      w=(await act(veteran,w,'saveStory',{...voice!,narrative:editedNarrative,accepted:true,selected:true})).workspace;
      const answer='My teammates told me the labels made supplies easier to find. I did not measure the time saved.';
      w=(await act(veteran,w,'generateStory',{storyId:voice!.id,followUpAnswer:answer})).workspace;
      expect(w.stories.find(story=>story.id===voice!.id)?.narrative,'Regeneration preserves accepted user wording').toBe(editedNarrative);
      expect(w.sources.some(source=>source.text.includes(answer))).toBe(true);
      const currentVoice=w.stories.find(story=>story.id===voice!.id)!;
      w=(await act(veteran,w,'saveStory',{...currentVoice,accomplishment:'Organized supply kits and explained the layout to teammates.',accepted:true,selected:true})).workspace;

      await login(counselor,seed.counselor);let counselorWorkspace=await load(counselor,account.caseId);
      const counselorPublish=await counselor.post('/api/command',{data:{caseId:account.caseId,revision:counselorWorkspace.case.revision,action:'publish',payload:{}}});expect([403,404]).toContain(counselorPublish.status());
      counselorWorkspace=(await act(counselor,counselorWorkspace,'submitReview',{text:'PRIVATE_FEEDBACK_SENTINEL: Keep your specific actions and avoid claiming licensure.',requestChanges:false})).workspace;
      expect(counselorWorkspace.reviews.length).toBeGreaterThan(0);
      await login(outsider,seed.outsider);expect((await outsider.get(`/api/workspace?caseId=${account.caseId}`)).status()).toBe(404);
      for(const hostileCaseId of [account.otherCaseId,seed.outsiderCaseId]){
        const hostileComplete=await outsider.post('/api/uploads/complete',{data:{caseId:hostileCaseId,assetId:first.id}});
        expect(hostileComplete.status(),'Foreign-asset finalization is denied across case and tenant boundaries').toBe(404);
        expect((await load(veteran,account.caseId)).assets.find(asset=>asset.id===first.id)?.status,'Rejected finalization cannot mark another case asset as failed').toBe('ready');
      }
      expect((await outsider.post('/api/uploads',{data:{caseId:account.caseId,kind:'photo',name:'unauthorized.jpg',mime:'image/jpeg',size:100}})).status()).toBe(404);
      expect((await publicAPI.get(`/api/assets/${resume.id}`)).status()).toBe(401);

      w=await load(veteran,account.caseId);w=(await act(veteran,w,'setState',{state:'ready_for_review'})).workspace;
      w=(await act(veteran,w,'setState',{state:'approved_for_sharing'})).workspace;
      const publication=await act(veteran,w,'publish',{});w=publication.workspace;
      expect(publication.shareUrl).toMatch(/^\/share\/[\w-]{43}$/);const shareUrl=publication.shareUrl!;const token=shareUrl.split('/').at(-1)!;
      const publicContext=await browser.newContext();await scopePreviewHeaders(publicContext,baseURL);const publicPage=await publicContext.newPage();
      const response=await publicPage.goto(new URL(shareUrl,baseURL).toString());expect(response?.status()).toBe(200);
      await expect(publicPage.getByRole('heading',{name:originalName})).toBeVisible();
      const publishedText=await publicPage.locator('body').innerText();
      expect(publishedText).toContain('I organized supply kits');expect(publishedText).toContain(editedNarrative);
      for(const privateText of ['PRIVATE_FEEDBACK_SENTINEL','PRIVATE_SOURCE_RESUME','PRIVATE_UNSELECTED_PHOTO_CAPTION','private-contact@vetcred.example','object_key','machineTranscript','sourceIds'])expect(publishedText).not.toContain(privateText);
      const publicHtml=await publicPage.content();
      for(const privateValue of ['PRIVATE_FEEDBACK_SENTINEL','PRIVATE_SOURCE_RESUME','PRIVATE_UNSELECTED_PHOTO_CAPTION','private-contact@vetcred.example','object_key','machineTranscript','sourceIds',resume.id,audio.id])expect(publicHtml).not.toContain(privateValue);
      const sharePhoto=await publicAPI.get(`/api/share/${token}/media/${first.id}`);expect(sharePhoto.status()).toBe(200);expect(sharePhoto.headers()['cache-control']).toContain('no-store');expect((await sharp(await sharePhoto.body()).metadata()).exif).toBeUndefined();
      expect((await publicAPI.get(`/api/share/${token}/media/${second.id}`)).status()).toBe(404);
      w=(await act(veteran,w,'saveProfile',{...w.case.profile,name:'Changed draft — not published',introduction:'New private draft introduction.'})).workspace;
      w=(await act(veteran,w,'savePhoto',{id:first.id,caption:'Changed private draft photo caption.'})).workspace;
      expect(w.case.state).toBe('draft');await publicPage.reload();await expect(publicPage.getByRole('heading',{name:originalName})).toBeVisible();expect(await publicPage.locator('body').innerText()).not.toContain('Changed draft');expect(await publicPage.locator('body').innerText()).toContain('I organized supply kits so teammates could find what they needed.');
      const share=w.shares.find(share=>!share.revoked);expect(share).toBeTruthy();w=(await act(veteran,w,'revokeShare',{id:share!.id})).workspace;
      expect((await publicAPI.get(shareUrl)).status()).toBe(404);expect((await publicAPI.get(`/api/share/${token}/media/${first.id}`)).status()).toBe(404);
      await publicContext.close();
    }finally{await veteran.dispose();await counselor.dispose();await outsider.dispose();await publicAPI.dispose();}
  });

  test('microphone-denied browser state keeps the typed-story alternative available',async({page,baseURL})=>{
    const credentials=JSON.parse(await readFile(new URL('../work/journey-accounts.json',import.meta.url),'utf8')) as {account:Credentials};
    await login(page.request,credentials.account);
    await scopePreviewHeaders(page.context(),baseURL);
    await page.addInitScript(()=>{
      Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{throw new DOMException('Microphone denied for automated fallback test','NotAllowedError');}});
    });
    await page.goto('/');
    await page.getByRole('button',{name:'Tell your story',exact:true}).click();
    await page.getByRole('button',{name:/Start recording/i}).click();
    await expect(page.getByRole('alert').filter({hasText:'Microphone access was not available'})).toBeVisible();
    const typed=page.getByLabel('Tell your story in your own words');await expect(typed).toBeEnabled();
    await typed.fill('During training I organized medical supplies and explained the kit layout to colleagues.');
    await expect(page.getByRole('button',{name:'Create a story draft',exact:true})).toBeEnabled();
  });

  test('real MediaRecorder recording from a synthetic microphone reaches live transcription',async({playwright,baseURL})=>{
    const credentials=JSON.parse(await readFile(new URL('../work/journey-accounts.json',import.meta.url),'utf8')) as {account:Credentials};
    const audioPath=fileURLToPath(new URL('../public/sample/story.wav',import.meta.url));
    const recordingBrowser=await playwright.chromium.launch({
      ...(process.platform==='win32'?{channel:'msedge'}:{}),
      args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',`--use-file-for-fake-audio-capture=${audioPath}%noloop`],
    });
    const context=await recordingBrowser.newContext({baseURL,permissions:['microphone']});
    try{
      await login(context.request,credentials.account);
      await scopePreviewHeaders(context,baseURL);
      const before=await load(context.request,credentials.account.caseId);
      const page=await context.newPage();await page.goto('/');
      await page.getByRole('button',{name:'Tell your story',exact:true}).click();
      await page.getByRole('button',{name:'Start recording',exact:true}).click();
      await expect(page.getByRole('button',{name:'Stop recording',exact:true})).toBeVisible();
      await expect(page.getByRole('timer')).not.toHaveText('00:00');
      // This is actual MediaRecorder capture, using a known synthetic WAV as the
      // browser's test microphone. No transcription/generation response is mocked.
      await page.waitForTimeout(17_000);
      await page.getByRole('button',{name:'Stop recording',exact:true}).click();
      const playback=page.getByLabel('Preview your recording');await expect(playback).toBeVisible();
      await playback.evaluate(async element=>{await (element as HTMLAudioElement).play();});
      await expect.poll(()=>playback.evaluate(element=>(element as HTMLAudioElement).currentTime)).toBeGreaterThan(0);
      await playback.evaluate(element=>(element as HTMLAudioElement).pause());
      const completion=page.waitForResponse(response=>response.url().endsWith('/api/uploads/complete')&&response.request().method()==='POST',{timeout:60_000});
      await page.getByRole('button',{name:'Save recording',exact:true}).click();
      expect((await completion).status()).toBe(200);
      await expect(page.getByRole('button',{name:'Recording saved',exact:true})).toBeVisible();
      const after=await load(context.request,credentials.account.caseId);
      const recorded=after.assets.find(asset=>asset.kind==='audio'&&!before.assets.some(prior=>prior.id===asset.id));
      expect(recorded?.mime).toMatch(/audio\/(webm|mp4)/);expect(recorded?.size).toBeGreaterThan(1000);
      const card=page.locator('article.audio-card').filter({hasText:recorded!.name});
      const transcribed=page.waitForResponse(response=>response.url().endsWith('/api/command')&&response.request().postDataJSON()?.action==='transcribe',{timeout:180_000});
      await card.getByRole('button',{name:'Transcribe recording',exact:true}).click();
      expect((await transcribed).status()).toBe(200);
      await expect(card.getByLabel('Review and correct your transcript')).not.toHaveValue('');
      expect((await load(context.request,credentials.account.caseId)).assets.find(asset=>asset.id===recorded!.id)?.data.machineTranscript?.length).toBeGreaterThan(20);
      await page.getByRole('button',{name:'Re-record',exact:true}).click();
      await expect(page.getByRole('button',{name:'Stop recording',exact:true})).toBeVisible();
      await page.waitForTimeout(1500);await page.getByRole('button',{name:'Stop recording',exact:true}).click();
      await page.getByRole('button',{name:'Delete recording',exact:true}).click();
      await expect(page.getByLabel('Preview your recording')).toHaveCount(0);
    }finally{await context.close();await recordingBrowser.close();}
  });
});
