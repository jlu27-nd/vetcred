'use client';

import { useEffect, useRef, useState } from 'react';
import { Mic, Square, RotateCcw, Trash2, Upload } from 'lucide-react';
import { Button } from './ui';

export function VoiceRecorder({onReady,disabled=false}:{onReady:(file:File)=>Promise<void>;disabled?:boolean}) {
  const recorder=useRef<MediaRecorder|null>(null);
  const stream=useRef<MediaStream|null>(null);
  const timer=useRef<ReturnType<typeof setInterval>|null>(null);
  const chunks=useRef<Blob[]>([]);
  const mounted=useRef(true);
  const [recording,setRecording]=useState(false);
  const [seconds,setSeconds]=useState(0);
  const [file,setFile]=useState<File|null>(null);
  const [playback,setPlayback]=useState('');
  const [error,setError]=useState('');
  const [saving,setSaving]=useState(false);
  const [saved,setSaved]=useState(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;if(timer.current)clearInterval(timer.current);if(recorder.current){recorder.current.onstop=null;recorder.current.ondataavailable=null;recorder.current.onerror=null;if(recorder.current.state==='recording')recorder.current.stop();}stream.current?.getTracks().forEach(track=>track.stop());};},[]);
  useEffect(()=>()=>{if(playback)URL.revokeObjectURL(playback);},[playback]);
  function stop(){if(recorder.current?.state==='recording')recorder.current.stop();if(timer.current)clearInterval(timer.current);stream.current?.getTracks().forEach(track=>track.stop());setRecording(false);}
  async function start(){
    setError('');setSaved(false);
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){setError('Recording is unavailable in this browser. You can upload audio or use the typed-story option below.');return;}
    const mime=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(type=>MediaRecorder.isTypeSupported(type));
    if(!mime){setError('This browser does not support a recording format we can process. Upload audio or type your story below.');return;}
    try{
      const media=await navigator.mediaDevices.getUserMedia({audio:true});if(!mounted.current){media.getTracks().forEach(track=>track.stop());return;}stream.current=media;
      const next=new MediaRecorder(media,{mimeType:mime});recorder.current=next;chunks.current=[];setFile(null);setPlayback('');setSeconds(0);
      next.ondataavailable=event=>{if(event.data.size)chunks.current.push(event.data);};
      next.onstop=()=>{const blob=new Blob(chunks.current,{type:mime});const captured=new File([blob],`my-story-${Date.now()}.${mime.includes('mp4')?'m4a':'webm'}`,{type:mime});setFile(captured);setPlayback(URL.createObjectURL(captured));media.getTracks().forEach(track=>track.stop());setRecording(false);};
      next.onerror=()=>{setError('Recording stopped unexpectedly. Try again, upload audio, or type your story.');stop();};
      next.start(1000);setRecording(true);
      const started=Date.now();timer.current=setInterval(()=>{const elapsed=Math.floor((Date.now()-started)/1000);setSeconds(elapsed);if(elapsed>=120)stop();},250);
    }catch{setError('Microphone access was not available. You can allow it in your browser settings, upload audio, or type your story below.');stream.current?.getTracks().forEach(track=>track.stop());}
  }
  async function save(){if(!file)return;setSaving(true);try{await onReady(file);setSaved(true);}catch(e){setError(e instanceof Error?e.message:'The recording could not be saved. Please retry.');}finally{setSaving(false);}}
  return <div className="recorder"><div className={`record-orb ${recording?'recording':''}`}><Mic size={31}/></div><h3>{recording?'Take your time. We’re listening.':file?'Your story, in your own words.':'Tell me about a time people depended on you.'}</h3><p className="recorder-hint">What was happening? What did you personally do? What changed?</p><div className="recorder-time" role="timer" aria-label="Recording time">{String(Math.floor(seconds/60)).padStart(2,'0')}:{String(seconds%60).padStart(2,'0')}</div><p className="field-hint">Up to 2 minutes · Your recording stays private</p>
    {file&&playback&&<audio controls src={playback} className="audio-player" aria-label="Preview your recording"/>}
    <div className="button-row centered">{recording?<Button variant="danger" onClick={stop}><Square size={16}/>Stop recording</Button>:<Button onClick={()=>void start()} disabled={disabled||saving}>{file?<RotateCcw size={17}/>:<Mic size={17}/>} {file?'Re-record':'Start recording'}</Button>}{file&&!recording&&<><Button variant="secondary" onClick={()=>void save()} busy={saving} disabled={saved||disabled}><Upload size={16}/>{saved?'Recording saved':'Save recording'}</Button><button className="icon-button" aria-label="Delete recording" disabled={saving} onClick={()=>{setFile(null);setPlayback('');setSeconds(0);setSaved(false);}}><Trash2 size={18}/></button></>}</div>{error&&<p role="alert" className="notice notice-error">{error}</p>}
  </div>;
}
