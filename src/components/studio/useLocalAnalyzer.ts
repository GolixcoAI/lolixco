import{useEffect,useRef,useState}from'react';import type{AnalysisEvent}from'./analysisProgress';
import {phase9Presentation, phase9Section} from './presentationV7';
class LocalRequestError extends Error {
 constructor(message:string,readonly status:number){super(message)}
}
export type QualityMode = 'phase8' | 'phase9';
type StagedMedia = {id:string;name:string;audio_only:boolean};
type Snapshot={staged_media?:StagedMedia;quality_mode?:QualityMode;job_id:string;media_filename:string;status:string;current_stage:string;progress_percent:number;error?:string;duration_seconds?:number;events:{event_type:string;payload:Record<string,unknown>;section_id?:string}[]};
export function useLocalAnalyzer(){const enabled=import.meta.env.DEV&&location.hostname==='127.0.0.1';const[ready,setReady]=useState(false);const[files,setFiles]=useState<{filename:string;size_bytes:number}[]>([]);const[selected,setSelected]=useState('');const[events,setEvents]=useState<AnalysisEvent[]>([]);const[snapshot,setSnapshot]=useState<Snapshot|null>(null);const[reports,setReports]=useState<{v6:unknown;presentation:unknown}|null>(null);const[error,setError]=useState('');const[job,setJob]=useState(()=>{const id=new URLSearchParams(location.search).get('analysisJob')||'';return enabled&&/^job_\d+_[a-f0-9]{6}$/.test(id)?id:''});const startedHere=useRef(false);const[starting,setStarting]=useState(false);
 const [uploading,setUploading]=useState(false);
 const [staged,setStaged]=useState<StagedMedia|null>(null);
 const stagedFile=useRef<File|null>(null);const generation=useRef(0);const terminal=useRef(false);
 async function api(path:string,options?:RequestInit){
  const r=await fetch('/api/v8/'+path,{...options,headers:{'Content-Type':'application/json',...options?.headers},cache:'no-store'});
  if(!r.ok){
   const body=await r.json().catch(()=>null);
   throw new LocalRequestError(typeof body?.detail==='string'?body.detail:`Local service returned ${r.status}.`,r.status);
  }
  return r.json();
 }
 async function refresh(){if(!enabled)return;try{const health=await api('health');if(health.version!=='8.0.0')throw Error('Expected local analyzer service v8.0.0');const inbox=await api('inbox');setFiles(inbox.files);setReady(true);setError('')}catch{setReady(false);setError('Local analyzer unavailable. Start npm run dna:serve, then npm run dev:dna.')}}
 useEffect(()=>{void refresh()},[enabled]);
 useEffect(()=>{if(!job)return;let alive=true;let timer:ReturnType<typeof setTimeout>;let inflight=false;let cursor=0;const token=generation.current;const stream=new EventSource('/api/v8/jobs/'+encodeURIComponent(job)+'/events');
 const update=async()=>{if(inflight||!alive||terminal.current)return;inflight=true;try{const s:Snapshot=await api('jobs/'+encodeURIComponent(job));if(!alive||generation.current!==token)return;setSnapshot(s);setSelected(old=>old||s.media_filename);const next:AnalysisEvent[]=[];for(const e of s.events.slice(cursor)){if(['QUEUED','RUNNING','SECTION_COMPLETED','SECTION_UNASSESSED','FAILED','CANCELLED'].includes(e.event_type))next.push({job_id:job,type:e.event_type as AnalysisEvent['type'],section:s.quality_mode==='phase9'&&e.section_id?phase9Section(e.payload):e.payload,message:typeof e.payload.error==='string'?e.payload.error:undefined});}cursor=s.events.length;
 if(s.status==='COMPLETE'){const[v6,presentation]=await Promise.all([api(`jobs/${job}/report/v6`),api(`jobs/${job}/report/presentation`)]);if(!alive)return;setReports({v6,presentation});next.push({job_id:job,type:'COMPLETE',report:s.quality_mode==='phase9'?phase9Presentation(presentation,v6,s.events.filter(event=>event.event_type==='SECTION_COMPLETED').map(event=>event.payload)):presentation});terminal.current=true;stream.close()}
 if(['FAILED','CANCELLED'].includes(s.status)){if(!next.some(e=>e.type===s.status))next.push({job_id:job,type:s.status as AnalysisEvent['type'],message:s.error||s.current_stage});terminal.current=true;stream.close()}
 if(next.length)setEvents(old=>[...old,...next]);setError('');
 }catch(e){if(alive)setError(e instanceof Error?e.message:'Could not read job status')}finally{inflight=false}};
 const poll=async()=>{await update();if(alive&&!terminal.current)timer=setTimeout(poll,1000)};stream.onmessage=()=>{void update()};stream.onerror=()=>{stream.close()};void poll();return()=>{alive=false;clearTimeout(timer);stream.close()};},[job]);
 async function start(qualityMode:QualityMode,file?:File){
  if(!enabled||!ready||!file&&!selected||starting||busy)return;
  setStarting(true);
  setError('');
  try {
   let input=staged;
   if(file&&stagedFile.current!==file){
    setUploading(true);
    try {
     const uploaded=await api('media',{
      method:'POST',body:file,headers:{'Content-Type':'application/octet-stream','X-Media-Name':encodeURIComponent(file.name)},
     });
     input={id:uploaded.id,name:uploaded.name,audio_only:!uploaded.video};
     stagedFile.current=file;
     setStaged(input);
    } finally {
     setUploading(false);
    }
   }
   const r=await api(file&&input?`media/${input.id}/start`:'jobs/start',{
    method:'POST',body:JSON.stringify(file?{quality_mode:qualityMode}:{inbox_filename:selected,quality_mode:qualityMode}),
   });
   startedHere.current=true;generation.current++;terminal.current=false;setEvents([]);setReports(null);setSnapshot(null);setJob(r.job_id);
   const u=new URL(location.href);u.searchParams.set('analysisJob',r.job_id);history.replaceState(history.state,'',u);
  }catch(e){
   if(file&&e instanceof LocalRequestError&&e.status===404){
    stagedFile.current=null;setStaged(null);
    setError('The temporary copy expired. Start Analysis again to stage the selected file.');
   }else setError(e instanceof Error?e.message:'Unable to start analysis.');
  }
  finally{setStarting(false)}
 }
 async function deleteStaged(){
  const input=staged||snapshot?.staged_media;
  if(!input||busy)return false;
  try {
   await api(`media/${input.id}`,{method:'DELETE'}).catch(e=>{
    if(!(e instanceof LocalRequestError&&e.status===404))throw e;
   });
   stagedFile.current=null;
   setStaged(null);
   setSnapshot(old=>old?{...old,staged_media:undefined}:old);
   setError('');
   return true;
  }catch(e){
   setError(e instanceof Error?e.message:'Unable to delete temporary media.');
   return false;
  }
 }
 async function inspectYoutube(videoId:string):Promise<unknown>{
  return api('youtube/reference',{method:'POST',body:JSON.stringify({video_id:videoId})});
 }
 async function cancel(){if(!job)return;try{await api(`jobs/${job}/cancel`,{method:'POST',body:JSON.stringify({reason:'Owner requested cancellation from Creator Studio'})});setError('Cancellation requested; waiting for service confirmation.')}catch(e){setError(e instanceof Error?e.message:'Cancellation failed')}}
 function clear(){if(starting||!!job&&!terminal.current)return;const input=staged||snapshot?.staged_media;
 if(input)void api(`media/${input.id}`,{method:'DELETE'}).catch(()=>{});
 stagedFile.current=null;setStaged(null);
 generation.current++;terminal.current=true;startedHere.current=false;setJob('');setSelected('');setEvents([]);setSnapshot(null);setReports(null);setError('');const u=new URL(location.href);u.searchParams.delete('analysisJob');history.replaceState(history.state,'',u)}
 const busy=starting||!!job&&!terminal.current;
 return{uploading,staged:staged||snapshot?.staged_media,deleteStaged,inspectYoutube,liveJobId:startedHere.current?job:undefined,clear,receivedResultId:startedHere.current&&reports?job:undefined,enabled,ready,files,selected,setSelected,events,snapshot,reports,error,busy,start,cancel,refresh};}
