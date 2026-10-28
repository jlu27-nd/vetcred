'use client';
import { useState } from 'react';
import { ArrowDown, ArrowUp, ImagePlus, Save, Sparkles, Star, Trash2 } from 'lucide-react';
import type { Asset, PhotoContext } from '@/lib/types';
import type { PanelProps } from './panel-types';
import { Button, EmptyState, Field, PageHeading } from './ui';
import { UploadZone } from './upload-zone';

const blankContext:PhotoContext={happening:'',role:'',date:'',actions:'',matters:''};

function PhotoCard({asset,index,total,workspace,command,busy,move}:{asset:Asset;index:number;total:number;workspace:PanelProps['workspace'];command:PanelProps['command'];busy:boolean;move:(direction:number)=>void}){
  const [context,setContext]=useState<PhotoContext>(asset.data.context??blankContext);
  const [description,setDescription]=useState(asset.data.description??'');
  const [caption,setCaption]=useState(asset.data.caption??'');
  const [association,setAssociation]=useState(asset.data.association??'');
  const [dirty,setDirty]=useState(false);
  const readOnly=workspace.user.role!=='veteran';
  function updateContext(patch:Partial<PhotoContext>){setContext(current=>({...current,...patch}));setDirty(true);}
  async function save(){const result=await command('savePhoto',{id:asset.id,context,description,caption,association});if(result)setDirty(false);}
  return <article className="photo-card"><div className="photo-visual"><img src={`/api/assets/${asset.id}`} alt={asset.data.caption||asset.name}/><div className="photo-badges">{asset.data.cover&&<span><Star size={13} fill="currentColor"/>Cover image</span>}{asset.data.sample&&<span>Sample illustration</span>}</div><span className="photo-counter">{String(index+1).padStart(2,'0')}</span></div><div className="photo-content"><div className="photo-card-heading"><div><h3>{asset.name}</h3><p>Photo context is self-reported.</p></div><div className="button-row compact"><button className="icon-button" aria-label={`Move ${asset.name} up`} disabled={busy||readOnly||index===0} onClick={()=>move(-1)}><ArrowUp size={17}/></button><button className="icon-button" aria-label={`Move ${asset.name} down`} disabled={busy||readOnly||index===total-1} onClick={()=>move(1)}><ArrowDown size={17}/></button><button className="icon-button danger-text" aria-label={`Remove ${asset.name}`} disabled={busy||readOnly} onClick={()=>void command('removeAsset',{id:asset.id})}><Trash2 size={17}/></button></div></div>
      <fieldset disabled={readOnly||busy} className="form-stack"><Field label="Your original description" hint="Your words are preserved separately from AI suggestions."><textarea rows={2} value={description} onChange={e=>{setDescription(e.target.value);setDirty(true);}} placeholder="What would you want someone to know about this photo?"/></Field>
        <details className="context-details" open={!asset.data.context?.actions}><summary>Add context for your story</summary><div className="form-stack"><Field label="What was happening?"><textarea rows={2} value={context.happening} onChange={e=>updateContext({happening:e.target.value})} placeholder="Set the scene in your own words."/></Field><div className="field-row"><Field label="Your role"><input value={context.role} onChange={e=>updateContext({role:e.target.value})} placeholder="What were you responsible for?"/></Field><Field label="Approximate date (optional)"><input value={context.date} onChange={e=>updateContext({date:e.target.value})} placeholder="For example, spring 2020"/></Field></div><Field label="What did you personally do?"><textarea rows={2} value={context.actions} onChange={e=>updateContext({actions:e.target.value})} placeholder="Describe your actions, without needing military terminology."/></Field><Field label="Why does this experience matter?"><textarea rows={2} value={context.matters} onChange={e=>updateContext({matters:e.target.value})} placeholder="What changed, or what did you learn? It is okay if the result is uncertain."/></Field></div></details>
        <Button variant="secondary" onClick={async()=>{await save();await command('generatePhoto',{id:asset.id,context});}} disabled={!context.happening.trim()&&!context.actions.trim()}><Sparkles size={16}/>Draft a caption & story</Button>
        {asset.data.proposedCaption&&<div className="ai-suggestion"><p className="eyebrow"><Sparkles size={13}/>{workspace.case.isSample?'SAMPLE RESULT':'SUGGESTED CAPTION'}</p><p>{asset.data.proposedCaption}</p><button className="text-button" onClick={()=>{setCaption(asset.data.proposedCaption??'');setDirty(true);}}>Use this wording<ArrowDown size={14}/></button></div>}
        <Field label="Your portfolio caption"><textarea rows={3} value={caption} onChange={e=>{setCaption(e.target.value);setDirty(true);}} placeholder="Edit the caption you want others to see."/></Field>
        <Field label="Connect to a timeline entry or story"><select value={association} onChange={e=>{setAssociation(e.target.value);setDirty(true);}}><option value="">No association</option><optgroup label="Service timeline">{workspace.case.profile.service.map(entry=><option value={entry.id} key={entry.id}>{entry.title}</option>)}</optgroup><optgroup label="Stories">{workspace.stories.map(story=><option value={story.id} key={story.id}>{story.title}</option>)}</optgroup></select></Field>
        <div className="photo-sharing-controls"><label className="checkbox-row"><input type="checkbox" checked={asset.data.selected??false} onChange={e=>void command('savePhoto',{id:asset.id,selected:e.target.checked})}/><span>Include in my portfolio</span></label><button className={`text-button ${asset.data.cover?'teal-text':''}`} onClick={()=>void command('savePhoto',{id:asset.id,cover:!asset.data.cover})}><Star size={15} fill={asset.data.cover?'currentColor':'none'}/>{asset.data.cover?'Selected cover':'Use as cover'}</button></div>
        <div className="form-footer"><span className="field-hint">{dirty?'Unsaved photo edits':'Photo details saved'}</span><Button onClick={()=>void save()} disabled={!dirty}><Save size={16}/>Save photo</Button></div>
      </fieldset>
    </div></article>;
}

export function PhotosPanel({workspace,command,refresh,busy}:PanelProps){
  const photos=workspace.assets.filter(asset=>asset.kind==='photo').sort((a,b)=>(a.data.position??0)-(b.data.position??0));
  function move(index:number,direction:number){const ids=photos.map(photo=>photo.id);[ids[index],ids[index+direction]]=[ids[index+direction],ids[index]];void command('reorderPhotos',{ids});}
  return <><PageHeading eyebrow="VISUAL STORYTELLING" title="There’s a story behind that photo." description="You bring the context. We help you find the words. Choose the moments you want to carry into your next chapter."/>
    <UploadZone kind="photo" caseId={workspace.case.id} onUploaded={refresh} disabled={workspace.user.role!=='veteran'}/>
    <div className="notice subtle"><ImagePlus size={18}/><p>A photo offers visual context. It does not establish a qualification, rank, deployment or result. Only your selected photos appear in a published portfolio; location metadata is removed from shared images.</p></div>
    {photos.length?<><div className="section-heading section-space"><h2>Your photo stories <span className="count-bubble">{photos.length}</span></h2><span className="field-hint">{photos.filter(p=>p.data.selected).length} selected for portfolio</span></div><div className="photo-grid">{photos.map((photo,index)=><PhotoCard key={photo.id} asset={photo} index={index} total={photos.length} workspace={workspace} command={command} busy={busy} move={direction=>move(index,direction)}/>)}</div></>:<EmptyState icon={<ImagePlus size={28}/>} title="Small moments can say a lot.">Add a photo of a team, a project, or an experience that matters to you. You decide what the picture means.</EmptyState>}
  </>;
}
