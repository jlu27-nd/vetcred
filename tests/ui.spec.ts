import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import type { Workspace } from '../src/lib/types';
import { previewHeaders, scopePreviewHeaders } from './preview-access';

test.skip(process.env.VETCRED_RUN_LIVE_E2E !== '1' || !process.env.NEXT_PUBLIC_SUPABASE_URL, 'Requires VETCRED_RUN_LIVE_E2E=1 and the isolated Supabase preview configuration; creates real sample accounts.');

async function nav(page:Page,label:string){
  if((page.viewportSize()?.width??1440)<760)await page.getByRole('button',{name:'Open navigation',exact:true}).click();
  await page.getByRole('navigation',{name:'Workspace navigation'}).getByRole('button',{name:label,exact:true}).click();
}
async function state(page:Page):Promise<Workspace>{
  const response=await page.request.get('/api/workspace',{headers:previewHeaders()});
  expect(response.status()).toBe(200);
  return response.json();
}
async function action(page:Page,name:string,click:()=>Promise<unknown>){
  const response=page.waitForResponse(response=>response.url().endsWith('/api/command')&&response.request().postDataJSON()?.action===name,{timeout:180_000});
  await click();
  const result=await response;
  const data=await result.json();
  expect(result.status(),`${name}: ${data.error??'completed'}`).toBe(200);
  return data;
}

test('real isolated sample UI: source review, photo edit/order, transcript correction, autosave and clean reset',async({page,browser,baseURL})=>{
  await scopePreviewHeaders(page.context(),baseURL);
  page.setDefaultTimeout(20_000);
  const runtimeErrors:string[]=[];
  const consoleErrors:string[]=[];
  const failedResponses:{url:string;status:number}[]=[];
  page.on('pageerror',error=>runtimeErrors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'&&!message.text().includes('401'))consoleErrors.push(message.text());});
  page.on('response',response=>{if(response.status()>=400&&response.status()!==401)failedResponses.push({url:new URL(response.url()).pathname,status:response.status()});});
  await page.setViewportSize({width:1440,height:1000});
  await page.goto('/');
  await expect(page.getByRole('heading',{name:/Your service/})).toBeVisible();
  await page.getByRole('button',{name:'Explore the sample workspace'}).click();
  await expect(page.getByRole('heading',{name:'Welcome back, Alex.'})).toBeVisible({timeout:90_000});
  const initial=await state(page);
  expect(initial.case.isSample).toBe(true);
  expect(initial.assets.filter(asset=>asset.kind==='photo')).toHaveLength(2);
  await mkdir('work',{recursive:true});
  await page.screenshot({path:'work/ui-desktop.png',fullPage:true});
  console.log('UI: sample dashboard and desktop screenshot complete.');

  const other=await browser.newContext({baseURL,viewport:{width:1440,height:900}});
  try{
    const sample=await other.request.post('/api/auth',{headers:previewHeaders(),data:{action:'sample'},timeout:90_000});
    expect(sample.status()).toBe(200);
    const otherState=await (await other.request.get('/api/workspace',{headers:previewHeaders()})).json() as Workspace;
    expect(otherState.case.id).not.toBe(initial.case.id);
    expect(otherState.case.organizationId).not.toBe(initial.case.organizationId);
    const forbidden=await other.request.get(`/api/workspace?caseId=${initial.case.id}`,{headers:previewHeaders()});
    expect([403,404]).toContain(forbidden.status());
  }finally{await other.close();}
  console.log('UI: visitor isolation verified.');

  await nav(page,'Resume & documents');
  await action(page,'extractResume',()=>page.getByRole('button',{name:'Extract & suggest',exact:true}).click());
  await expect(page.getByRole('heading',{name:'Review what we found.'})).toBeVisible();
  await page.getByLabel('Your civilian-language wording').first().fill('Organized medical supplies and helped the team prepare for daily responsibilities.');
  await page.getByLabel('Service experience',{exact:true}).check();
  await action(page,'applyClaims',()=>page.getByRole('button',{name:'Apply 1 selected'}).click());
  const imported=await state(page);
  expect(imported.case.profile.service[0].description).toBe('Organized medical supplies and helped the team prepare for daily responsibilities.');
  expect(imported.case.profile.service[0].sourceIds.length).toBeGreaterThan(0);
  expect(imported.sources.some(source=>source.locator.includes('line'))).toBe(true);
  console.log('UI: resume source review and correction verified.');

  await nav(page,'Photo stories');
  const firstPhoto=page.locator('.photo-card').first();
  await firstPhoto.getByLabel(/^Your original description/).fill('A sample planning conversation with a colleague.');
  await firstPhoto.getByLabel('What was happening?',{exact:true}).fill('We were preparing the supplies for a community event.');
  await firstPhoto.getByLabel('Your role',{exact:true}).fill('I helped organize the supplies.');
  await firstPhoto.getByLabel('What did you personally do?',{exact:true}).fill('I checked our list and discussed what was missing with a colleague.');
  await firstPhoto.getByLabel('Why does this experience matter?',{exact:true}).fill('Clear planning helped us understand what still needed attention.');
  await action(page,'generatePhoto',()=>firstPhoto.getByRole('button',{name:'Draft a caption & story'}).click());
  await expect(firstPhoto.getByText('SAMPLE RESULT',{exact:true})).toBeVisible();
  await firstPhoto.getByLabel('Your portfolio caption').fill('Preparing for a community event through a careful supply check.');
  await action(page,'savePhoto',()=>firstPhoto.getByRole('button',{name:'Save photo',exact:true}).click());
  const beforeOrder=await state(page);
  const firstId=beforeOrder.assets.filter(asset=>asset.kind==='photo').sort((a,b)=>(a.data.position??0)-(b.data.position??0))[0].id;
  await action(page,'reorderPhotos',()=>firstPhoto.getByRole('button',{name:/Move .* down/}).click());
  await page.reload();
  const reordered=await state(page);
  const sorted=reordered.assets.filter(asset=>asset.kind==='photo').sort((a,b)=>(a.data.position??0)-(b.data.position??0));
  expect(sorted[1].id).toBe(firstId);
  expect(sorted[1].data.caption).toBe('Preparing for a community event through a careful supply check.');
  expect(sorted[1].data.description).toBe('A sample planning conversation with a colleague.');
  console.log('UI: photo caption, ordering and reload verified.');

  await nav(page,'Tell your story');
  const recording=page.locator('.audio-card').first();
  await action(page,'transcribe',()=>recording.getByRole('button',{name:'Transcribe recording',exact:true}).click());
  const transcript=recording.getByLabel(/^Review and correct your transcript/);
  await transcript.fill('I worked with the team to check our supply list before a community event. I noticed a missing item and asked a colleague to help locate it.');
  await action(page,'saveTranscript',()=>recording.getByRole('button',{name:'Save correction',exact:true}).click());
  await action(page,'generateStory',()=>recording.getByRole('button',{name:'Generate story from reviewed text'}).click());
  await expect(page.locator('.story-editor')).toHaveCount(2);
  const afterVoice=await state(page);
  expect(afterVoice.assets.find(asset=>asset.kind==='audio')?.data.correctedTranscript).toContain('asked a colleague');
  expect(afterVoice.assets.find(asset=>asset.kind==='audio')?.data.machineTranscript).not.toBe(afterVoice.assets.find(asset=>asset.kind==='audio')?.data.correctedTranscript);
  console.log('UI: transcript correction and story draft verified.');

  await nav(page,'Profile & direction');
  await page.getByLabel('Your name',{exact:true}).fill('Alex Morgan — autosave check');
  await action(page,'saveProfile',()=>page.getByRole('heading',{name:'Start with you.'}).click());
  await expect(page.locator('.save-hint')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading',{name:'Welcome back, Alex.'})).toBeVisible();
  expect((await state(page)).case.profile.name).toBe('Alex Morgan — autosave check');

  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'work/ui-mobile.png',fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await nav(page,'My portfolio');
  await expect(page.getByRole('heading',{name:'Make it yours. Then share it.'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Publish & create sharing link'})).toBeDisabled();
  await page.screenshot({path:'work/ui-mobile-portfolio.png',fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Reset sample',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Welcome back, Alex.'})).toBeVisible({timeout:90_000});
  const reset=await state(page);
  expect(reset.case.id).not.toBe(initial.case.id);
  expect(reset.case.profile.name).toBe('Alex Morgan');
  expect(reset.case.profile.service).toHaveLength(0);
  expect(reset.stories).toHaveLength(0);
  expect(reset.claims).toHaveLength(0);
  await writeFile('work/ui-browser-results.json',JSON.stringify({runtimeErrors,consoleErrors,failedResponses,screenshots:['ui-desktop.png','ui-mobile.png','ui-mobile-portfolio.png'],sampleCaseIsolation:true,photoPersistence:true,resumeReview:true,transcriptRevision:true,profileAutosave:true,sampleReset:true},null,2));
  expect(runtimeErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
