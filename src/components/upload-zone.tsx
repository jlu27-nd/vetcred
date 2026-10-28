'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, FileUp, RotateCcw, UploadCloud, X } from 'lucide-react';
import { Button } from './ui';
import type { Asset } from '@/lib/types';

type QueueItem = { id:string;file:File;progress:number;state:'queued'|'uploading'|'complete'|'failed';error?:string;preview?:string };
export type UploadKind = Asset['kind'];

const accepts:Record<UploadKind,string>={photo:'.jpg,.jpeg,.png,.webp',resume:'.pdf,.docx,.txt',support:'.pdf,.docx,.txt',audio:'.mp3,.mp4,.m4a,.mpeg,.mpga,.wav,.webm'};
const descriptions:Record<UploadKind,string>={photo:'JPEG, PNG or WebP · up to 10 MB each',resume:'Text-based PDF, DOCX or TXT · up to 8 MB',support:'PDF, DOCX or TXT · up to 8 MB',audio:'MP3, M4A, MP4, WAV or WebM · up to 24 MB'};
const mimeByExtension:Record<string,string>={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',txt:'text/plain',mp3:'audio/mpeg',mpeg:'audio/mpeg',mpga:'audio/mpeg',mp4:'audio/mp4',m4a:'audio/mp4',wav:'audio/wav',webm:'audio/webm'};

export async function uploadFile(file:File,kind:UploadKind,caseId:string,onProgress:(n:number)=>void,claimId?:string,register?:(xhr:XMLHttpRequest)=>boolean|void) {
  const extension=file.name.split('.').pop()?.toLowerCase() ?? '';
  const mime=file.type.split(';')[0] || mimeByExtension[extension] || 'application/octet-stream';
  const max=(kind==='photo'?10:kind==='audio'?24:8)*1024*1024;
  if (!file.size) throw new Error('This file is empty. Choose a file with content.');
  if (file.size>max) throw new Error(`This file is too large. The limit is ${max/1024/1024} MB.`);
  if (!accepts[kind].split(',').includes('.'+extension)) throw new Error(`This file type is not supported. ${descriptions[kind]}.`);
  const authorization=await fetch('/api/uploads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({caseId,kind,name:file.name,mime,size:file.size,claimId})});
  const result=await authorization.json();
  if (!authorization.ok) throw new Error(result.error || 'Upload authorization failed. Please retry.');
  await new Promise<void>((resolve,reject)=>{
    const xhr=new XMLHttpRequest();
    xhr.open('PUT',result.uploadUrl);
    if(register?.(xhr)===false){reject(new Error('Upload canceled.'));return;}
    xhr.setRequestHeader('Content-Type',mime);
    xhr.upload.onprogress=(event)=>{ if(event.lengthComputable) onProgress(Math.round(event.loaded/event.total*95)); };
    xhr.onload=()=>xhr.status>=200&&xhr.status<300?resolve():reject(new Error('Storage could not accept the upload. Please retry.'));
    xhr.onerror=()=>reject(new Error('The connection was interrupted. Please retry your upload.'));
    xhr.onabort=()=>reject(new Error('Upload canceled.'));
    xhr.send(file);
  });
  const finished=await fetch('/api/uploads/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({caseId,assetId:result.assetId})});
  const completed=await finished.json();
  if(!finished.ok) throw new Error(completed.error || 'The uploaded file could not be validated. Please retry.');
  onProgress(100);
  return result.assetId as string;
}

export function UploadZone({kind,caseId,onUploaded,claimId,disabled=false}:{kind:UploadKind;caseId:string;onUploaded:()=>Promise<void>;claimId?:string;disabled?:boolean}) {
  const [queue,setQueue]=useState<QueueItem[]>([]);
  const [dragging,setDragging]=useState(false);
  const fileInput=useRef<HTMLInputElement>(null);
  const active=useRef(new Map<string,XMLHttpRequest>());
  const previews=useRef(new Map<string,string>());
  const canceled=useRef(new Set<string>());
  const mounted=useRef(true);
  const update=(id:string,patch:Partial<QueueItem>)=>{if(mounted.current)setQueue(items=>items.map(item=>item.id===id?{...item,...patch}:item));};
  useEffect(()=>{mounted.current=true;const uploads=active.current;const urls=previews.current;return()=>{mounted.current=false;uploads.forEach(xhr=>xhr.abort());urls.forEach(url=>URL.revokeObjectURL(url));};},[]);
  async function run(item:QueueItem) {
    if(!mounted.current||canceled.current.has(item.id))return;
    update(item.id,{state:'uploading',progress:0,error:undefined});
    try { await uploadFile(item.file,kind,caseId,p=>update(item.id,{progress:p}),claimId,xhr=>{if(!mounted.current||canceled.current.has(item.id))return false;active.current.set(item.id,xhr);return true;});update(item.id,{state:'complete'});if(mounted.current)await onUploaded(); }
    catch(error){update(item.id,{state:'failed',error:error instanceof Error?error.message:'Upload failed.'});}
    finally{active.current.delete(item.id);}
  }
  function add(files:FileList|File[]|null) {
    if(!files||disabled)return;
    const items=Array.from(files).map(file=>{const id=crypto.randomUUID();const preview=kind==='photo'?URL.createObjectURL(file):undefined;if(preview)previews.current.set(id,preview);return {id,file,progress:0,state:'queued' as const,preview};});
    setQueue(previous=>[...previous,...items]);
    void (async()=>{for(const item of items)await run(item);})();
  }
  return <div className="upload-wrapper"><div className={`upload-zone ${dragging?'is-dragging':''} ${disabled?'is-disabled':''}`} onDragOver={event=>{event.preventDefault();if(!disabled)setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={event=>{event.preventDefault();setDragging(false);add(event.dataTransfer.files);}}>
    <span className="upload-icon"><UploadCloud size={25}/></span><div><h3>{kind==='photo'?'Give your story a little context.':kind==='audio'?'Already have a recording?':kind==='support'?'Connect a supporting document':'Start with what you already have.'}</h3><p>Drop {kind==='photo'?'photos':'a file'} here, or <button type="button" className="inline-button" onClick={()=>fileInput.current?.click()} disabled={disabled}>browse files</button></p><small>{descriptions[kind]}</small></div>
    <input ref={fileInput} type="file" className="sr-only" accept={accepts[kind]} multiple={kind==='photo'} aria-label={kind==='photo'?'Upload photos':kind==='audio'?'Upload audio':kind==='support'?'Upload supporting document':'Upload resume'} disabled={disabled} onChange={event=>{add(event.target.files);event.target.value='';}}/>
  </div>{queue.length>0&&<div className="upload-queue" aria-live="polite">{queue.map(item=><div key={item.id} className="upload-item">{item.preview?<img src={item.preview} className="upload-thumb" alt="Selected photo preview"/>:<FileUp size={20}/>}<div className="upload-item-content"><strong>{item.file.name}</strong><span>{item.state==='complete'?'Uploaded and saved':item.state==='failed'?item.error:`Uploading · ${item.progress}%`}</span>{item.state==='uploading'&&<progress max="100" value={item.progress} aria-label={`Upload progress for ${item.file.name}`}/>}</div>{item.state==='complete'?<CheckCircle2 size={20} className="teal-text"/>:item.state==='failed'?<Button variant="ghost" onClick={()=>void run(item)} aria-label={`Retry ${item.file.name}`}><RotateCcw size={16}/>Retry</Button>:null}<button className="icon-button" onClick={()=>{canceled.current.add(item.id);active.current.get(item.id)?.abort();if(item.preview){URL.revokeObjectURL(item.preview);previews.current.delete(item.id);}setQueue(items=>items.filter(i=>i.id!==item.id));}} aria-label={`Remove ${item.file.name} from upload queue`}><X size={16}/></button></div>)}</div>}</div>;
}
