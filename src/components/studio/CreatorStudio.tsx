import {useLocalAnalyzer,type QualityMode} from './useLocalAnalyzer';
import {applyAnalysisEvent,INITIAL_ANALYSIS,progressPresentation,type AnalysisEvent} from './analysisProgress';
import {youtubeReferenceId} from './youtubeReference';
import RatingReveal from "./RatingReveal";
import {useEffect,useId,useMemo,useRef,useState} from 'react';
import {ChevronDown,Upload,Film,AudioLines,ScanLine,SlidersHorizontal,Download,Plus,Minus,Play,Layers,ArrowUpRight} from 'lucide-react';
import YouTubePlayer from '../video/YouTubePlayer';
import {adaptStudioReport,type StudioReport,type Evidence} from './studioAdapter';
import './studio.css';
const clock=(v:number)=>`${Math.floor(v/60)}:${String(Math.floor(v%60)).padStart(2,'0')}`;
function Status({value}:{value:string}){return <span className={`studio-status ${value==='CONFLICT'?'conflict':''}`}>{value}</span>}
function Panel({title,icon,children}:{title:string;icon:React.ReactNode;children:React.ReactNode}){return <section className="studio-panel"><header>{icon}<h2>{title}</h2></header>{children}</section>}
function CompactSection({ title, children, className = '' }: {
 title: string;
 children: React.ReactNode;
 className?: string;
}) {
 const [open, setOpen] = useState(false);
 const id = useId();
 return <div className={className}>
  <button className="studio-compact-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
   {title}<ChevronDown size={16} aria-hidden="true"/>
  </button>
  <div id={id} className="studio-compact-body" data-open={open}>{children}</div>
 </div>;
}
function Finding({item}:{item:Evidence}){return <div className="studio-finding"><div><span>{item.label}</span><Status value={item.status}/></div><strong>{item.value}</strong>{item.provenance&&<small>Evidence: {item.provenance}</small>}</div>}
export default function CreatorStudio({analysisEvents=[]}:{analysisEvents?:readonly AnalysisEvent[]}){
 const analyzer=useLocalAnalyzer();
 const [qualityMode,setQualityMode]=useState<QualityMode>('phase8');
 const incomingEvents=analyzer.events.length?analyzer.events:analysisEvents;
 const progress=useMemo(()=>{try{return incomingEvents.reduce(applyAnalysisEvent,INITIAL_ANALYSIS)}catch{return{...INITIAL_ANALYSIS,status:'FAILED' as const,message:'Analysis event could not be validated.'}}},[incomingEvents]);
 const progressiveReport=useMemo(()=>{const r=progressPresentation(progress);return r?adaptStudioReport(r):null},[progress]);
 const [media,setMedia]=useState<{url:string;title:string;type:'local'|'youtube'|'inbox'|'staged';id?:string;audioOnly?:boolean}|null>(null);const[duration,setDuration]=useState(0);const[size,setSize]=useState('—');const[time,setTime]=useState(0);const[tab,setTab]=useState('Timeline');const[zoom,setZoom]=useState(1);const[url,setUrl]=useState('');const[error,setError]=useState('');const[importedReport,setReport]=useState<StudioReport|null>(null);const[loading,setLoading]=useState(false);const video=useRef<HTMLMediaElement|null>(null);
 const [localFile,setLocalFile]=useState<File|null>(null);
 const [rawImported,setRawImported]=useState<unknown>(null);
 const [checkingReference,setCheckingReference]=useState(false);const local=useRef<HTMLInputElement>(null);const json=useRef<HTMLInputElement>(null);
 useEffect(()=>()=>{if(media?.type==='local')URL.revokeObjectURL(media.url)},[media]);
 const report=progress.status==='IDLE'?importedReport:progressiveReport;
 const markerReport=useMemo(()=>analyzer.reports?adaptStudioReport(analyzer.reports.v6):report,[analyzer.reports,report]);
 const markers=(markerReport?.markers||[]).filter(m=>duration>0&&m.time<=duration);
 const listedMarkers=tab==='Scenes'?markers.filter(m=>m.kind==='cut'):markers;
 const canSeek=!!duration&&media?.type!=='youtube';
 function downloadRaw(value:unknown,name:string){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 function selectInbox(name:string){reset();analyzer.setSelected(name);if(name)setMedia({url:'/__dna/media?filename='+encodeURIComponent(name),title:name,type:'inbox'});else setMedia(null)}
 useEffect(()=>{const name=analyzer.snapshot?.media_filename;if(!media&&name&&analyzer.files.some(f=>f.filename===name))setMedia({url:'/__dna/media?filename='+encodeURIComponent(name),title:name,type:'inbox'})},[analyzer.snapshot?.media_filename,analyzer.files,media]);
 useEffect(()=>{
  const staged=analyzer.snapshot?.staged_media;
  if(!media&&staged)setMedia({url:'/api/v8/media/'+staged.id,title:staged.name,type:'staged',audioOnly:staged.audio_only});
 },[analyzer.snapshot?.staged_media,media]);
 function reset(){analyzer.clear();setLocalFile(null);setRawImported(null);setDuration(0);setTime(0);setSize('—');setReport(null);setError('')}
 function openYoutube(){
  const id=youtubeReferenceId(url);
  if(!id){setError('Enter a valid HTTPS YouTube watch, Shorts or youtu.be URL.');return}
  reset();
  setMedia({url:`https://www.youtube.com/watch?v=${id}`,title:'YouTube reference',type:'youtube',id});
 }
 async function checkReference(){
  if(media?.type!=='youtube'||!media.id||checkingReference)return;
  setCheckingReference(true);setError('');
  try{
   const raw=await analyzer.inspectYoutube(media.id);
   const result=adaptStudioReport(raw);
   setReport(result);setRawImported(raw);
   setMedia({...media,title:result.referenceTitle||'YouTube reference'});
  }catch(e){setError(e instanceof Error?e.message:'Publisher metadata is unavailable.')}
  finally{setCheckingReference(false)}
 }
 async function deleteTemporary(){
  if(await analyzer.deleteStaged()&&media?.type==='staged')setMedia(null);
 }
 function seek(t:number){if(video.current&&duration){const target=Math.max(0,Math.min(duration,t));video.current.currentTime=target;setTime(target)}}
 async function importReport(file:File){if(analyzer.busy){setError('Cancel or finish the active job before importing a report.');return}setLoading(true);try{if(file.size>2_000_000)throw Error('Report must be smaller than 2 MB.');const raw=JSON.parse(await file.text());const imported=adaptStudioReport(raw);analyzer.clear();setReport(imported);setRawImported(raw);setError('')}catch(e){setError(e instanceof Error?e.message:'Report unavailable')}finally{setLoading(false)}}
 function exportReport(){
  if(report)downloadRaw(rawImported||analyzer.reports?.presentation||progress.report||report,'lolixco-analysis-report.json');
 }
 return <div className="creator-studio">
 <header className="studio-banner"><div className="studio-kicker">LOLIXCO / CREATIVE WORKSPACE <span>01</span></div><h1>CREATOR <em>STUDIO</em></h1><p>AI-powered edit analysis, creative intelligence and publishing tools.</p></header>
 <div className="studio-toolbar"><span><span className="studio-dot"/> BROWSER SESSION <small>Local files stay on this device</small></span><div><button disabled={analyzer.busy||checkingReference} onClick={()=>local.current?.click()}><Upload size={15}/> Import media</button><button className="studio-primary" disabled={analyzer.busy||checkingReference} onClick={()=>json.current?.click()}><ScanLine size={15}/> Import analysis report</button></div></div>
 <input ref={local} type="file" accept="video/*,audio/*,.mkv,.flac,.opus" hidden aria-label="Import local video" onChange={e=>{const f=e.target.files?.[0];if(f&&!analyzer.busy){analyzer.setSelected('');reset();setLocalFile(f);setMedia({url:URL.createObjectURL(f),title:f.name,type:'local',audioOnly:f.type.startsWith('audio/')||/\.(mp3|wav|flac|ogg|opus|m4a|aac)$/i.test(f.name)})}e.target.value=''}}/>
 <input ref={json} type="file" accept="application/json,.json" hidden aria-label="Import analysis JSON" onChange={e=>{const f=e.target.files?.[0];if(f)void importReport(f);e.target.value=''}}/>
 {error&&<div className="studio-error" role="alert">{error}</div>}
 {analyzer.enabled&&<details className="studio-local-service">
 <summary>
  <span className="studio-connection-label"><span className="studio-dot" data-connected={analyzer.ready}/> Local Edit DNA · {analyzer.ready?'Connected':'Offline'}</span>
  <strong>{media?.title || analyzer.selected || 'Select video or audio'}</strong>
  <span role="status">{analyzer.uploading ? 'Staging file on this device…' : analyzer.snapshot?.status === 'COMPLETE' ? 'Analysis complete' : analyzer.snapshot ? `${analyzer.snapshot.current_stage} · ${analyzer.snapshot.progress_percent}%` : analyzer.busy ? 'Analyzing…' : progress.status === 'IDLE' ? 'Ready for analysis' : progress.status.replace(/_/g, ' ')}</span>
 </summary>
 <div className="studio-service-controls"><div><strong>LOCAL EDIT DNA · {analyzer.ready?'CONNECTED':'OFFLINE'}</strong><span>Choose a file above or select from the authorized inbox.</span></div><label>Authorized inbox<select aria-label="Authorized inbox video" value={analyzer.selected} disabled={analyzer.busy||checkingReference} onChange={e=>selectInbox(e.target.value)}><option value="">Select an authorized video…</option>{analyzer.files.map(f=><option key={f.filename} value={f.filename}>{f.filename}</option>)}</select></label><button disabled={analyzer.busy||checkingReference} onClick={()=>void analyzer.refresh()}>Refresh inbox</button>{analyzer.busy&&!analyzer.uploading&&analyzer.snapshot&&['QUEUED','RUNNING'].includes(analyzer.snapshot.status)&&<button onClick={()=>void analyzer.cancel()}>Cancel analysis</button>}
 {analyzer.staged&&!analyzer.busy&&<button onClick={()=>void deleteTemporary()}>Delete temporary media</button>}<p>Start Analysis copies the selected file to private storage on this device. Up to 100 MiB and 2 minutes. The temporary copy expires after one hour.</p>{analyzer.snapshot&&<p role="status">{analyzer.snapshot.status} · {analyzer.snapshot.current_stage} · service progress {analyzer.snapshot.progress_percent}%{analyzer.snapshot.duration_seconds?` · ${analyzer.snapshot.duration_seconds.toFixed(2)} seconds processing`:''}</p>}{analyzer.error&&<p role="alert">{analyzer.error}</p>}{analyzer.reports&&<div><button onClick={()=>downloadRaw(analyzer.reports!.v6,'edit-dna-v6.json')}>Export v6 report</button><button onClick={()=>downloadRaw(analyzer.reports!.presentation,'edit-dna-presentation-v7.json')}>Export Phase 7 report</button><details><summary>{analyzer.snapshot?.quality_mode==='phase9'?'View raw research reports · unreviewed claims':'View raw reports locally'}</summary><pre>{JSON.stringify(analyzer.reports,null,2)}</pre></details></div>}
 <label>Analysis mode
  <select value={qualityMode} disabled={analyzer.busy||checkingReference} onChange={e=>setQualityMode(e.target.value==='phase9'?'phase9':'phase8')}>
   <option value="phase8">Phase 8 · Technical analysis</option>
   <option value="phase9">Phase 9 · Experimental AI assessment</option>
  </select>
 </label>
 <button className="studio-analyze" disabled={!analyzer.ready||analyzer.busy||checkingReference||!(media?.type==='inbox'&&analyzer.selected||media?.type==='local'&&localFile)} onClick={()=>void analyzer.start(qualityMode,media?.type==='local'?localFile||undefined:undefined)}>
  Start Analysis <span>{analyzer.uploading?'Staging file on this device…':analyzer.busy?'Local analysis in progress':media?.type==='local'?'Analyze imported media locally':'Analyze selected inbox video'}</span>
 </button>
 </div></details>}
 {!analyzer.enabled && media && <div className="studio-current-media">{media.title} · {report ? 'Report loaded' : 'Preview ready'}</div>}
 <section className="studio-reference-entry" aria-label="YouTube reference">
 <form className="studio-url" onSubmit={e=>{e.preventDefault();if(!analyzer.busy&&!checkingReference)openYoutube()}}><input aria-label="YouTube URL" type="url" placeholder="Paste a YouTube watch or Shorts URL…" value={url} onChange={e=>setUrl(e.target.value)}/><button type="submit" disabled={analyzer.busy||checkingReference}>Open reference <ArrowUpRight size={14}/></button></form>
 {media?.type==='youtube'&&<div className="studio-reference-status">
  <p>Official player where embedding is permitted. Publisher metadata is available separately. Audiovisual analysis requires an approved provider.</p>
  {analyzer.enabled&&<button disabled={!analyzer.ready||checkingReference} onClick={()=>void checkReference()}>{checkingReference?'Checking YouTube…':'Check YouTube metadata'}</button>}
  {rawImported!==null&&<button onClick={exportReport}>Export YouTube report</button>}
 </div>}
 </section>

 {!!report?.mediaNotes?.length&&<ul className="studio-media-notes" aria-label="Media observations">{report.mediaNotes.map(note=><li key={note}>{note}</li>)}</ul>}

 <div className="studio-workspace"><section className="studio-analyzer"><Panel title="AI EDIT ANALYZER" icon={<ScanLine size={16}/>}><div className="studio-analyzer-heading"><span className="studio-orbit" aria-hidden="true"><ScanLine size={28}/></span><div><small>EDIT DNA / EVIDENCE ENGINE</small><h3>{loading?'Reading report…':report?'Evidence workspace':'See beyond the cut.'}</h3></div></div><p className="studio-note">Import a v6 or Phase 7 report to explore measured signals, supported interpretations and unknowns.</p>{!analyzer.snapshot&&progress.status!=='IDLE'&&<p className="studio-note" role="status">Analysis job: {progress.status.replace(/_/g,' ')}{progress.message?` — ${progress.message}`:''}</p>}<RatingReveal experimental={report?.experimental} localResult={analyzer.enabled&&progress.status!=='IDLE'} key={analyzer.snapshot?.job_id||'studio'} processing={analyzer.busy} analysisComplete={analyzer.snapshot?.status==='COMPLETE'||progress.status==='COMPLETE'} onSeek={canSeek?seek:undefined} receivedResultId={analyzer.liveJobId} ratings={report?.ratings} synthetic={report?.synthetic} developmentPreview={import.meta.env.DEV || import.meta.env.VITE_STUDIO_TIMING_PREVIEW==='true'}/>{report&&<details className="studio-evidence-details"><summary>Additional technical evidence</summary>{report.evidence.map((x,i)=><Finding key={i} item={x}/>)}</details>}</Panel></section>
 <CompactSection title="Preview & timeline" className="studio-preview"><Panel title="PREVIEW MONITOR" icon={<Film size={15}/>}><div className={`studio-monitor ${media?'loaded':''}`}>
 {!media?<div className="studio-empty"><div className="studio-crosshair"><Play size={26}/></div><h3>Your next great edit starts here.</h3><p>Import a permitted local video to preview it.<br/>Nothing is uploaded or analyzed automatically.</p><button disabled={analyzer.busy||checkingReference} onClick={()=>local.current?.click()}>Choose video <ArrowUpRight size={15}/></button></div>:media.audioOnly?<audio ref={element=>{video.current=element}} src={media.url} controls onLoadedMetadata={e=>setDuration(e.currentTarget.duration)} onTimeUpdate={e=>setTime(e.currentTarget.currentTime)}/>:media.type!=='youtube'?<video ref={element=>{video.current=element}} src={media.url} controls playsInline onLoadedMetadata={e=>{const v=e.currentTarget;setDuration(v.duration);setSize(`${v.videoWidth} × ${v.videoHeight}`)}} onTimeUpdate={e=>setTime(e.currentTarget.currentTime)} onError={()=>setError('This browser cannot preview the selected codec. You can still try local analysis.')}/>:<YouTubePlayer videoId={media.id!} title={media.title} autoPlay={false} controls/>}
 </div><div className="studio-media-caption"><strong>{media?.title||'No media selected'}</strong><span>{duration?clock(duration):'—'} / {size}</span></div></Panel>
 <Panel title="EDIT TIMELINE" icon={<Layers size={15}/>}><div className="studio-tabs" role="tablist" aria-label="Workspace views" onKeyDown={e=>{const tabs=['Timeline','Scenes','Chapters','Markers'];const i=tabs.indexOf(tab);const n=e.key==='ArrowRight'?(i+1)%4:e.key==='ArrowLeft'?(i+3)%4:e.key==='Home'?0:e.key==='End'?3:-1;if(n>=0){e.preventDefault();setTab(tabs[n]);(e.currentTarget.querySelectorAll('[role=tab]')[n] as HTMLButtonElement).focus()}}}>{['Timeline','Scenes','Chapters','Markers'].map(t=><button key={t} role="tab" tabIndex={tab===t?0:-1} aria-selected={tab===t} onClick={()=>setTab(t)}>{t}</button>)}<span className="studio-zoom"><button aria-label="Zoom timeline out" onClick={()=>setZoom(Math.max(1,zoom-1))}><Minus size={13}/></button>{zoom}×<button aria-label="Zoom timeline in" onClick={()=>setZoom(Math.min(4,zoom+1))}><Plus size={13}/></button></span></div><div className="studio-timeline-scroll"><div className="studio-timeline" style={{width:`${zoom*100}%`}}><div className="studio-ruler">{Array.from({length:7},(_,i)=><span key={i}>{clock(duration*i/6)}</span>)}</div>{tab==='Timeline'?<><div className="studio-track"><span>{media?.audioOnly?'AUDIO':'VIDEO'}</span><div className="studio-track-empty">{markers.length?`${markers.length} supplied timestamp markers`:media?'No timestamp markers supplied yet':'Import media to begin'}</div></div><div className="studio-marker-lanes">{(['cut','beat','reference'] as const).filter(kind=>markers.some(m=>m.kind===kind)).map(kind=><div className={`studio-marker-lane ${kind}`} key={kind} aria-label={`${kind} markers`}>{markers.filter(m=>m.kind===kind).map(m=><button key={`${m.kind}:${m.time}`} disabled={!canSeek} style={{left:`${m.time/duration*100}%`,width:`min(7px, ${Math.min(...markers.filter(other=>other.kind===m.kind&&other.time!==m.time).map(other=>Math.abs(other.time-m.time)),duration)*80/duration}%)`}} aria-label={`Seek to ${m.label} at ${m.time.toFixed(2)} seconds`} title={`${m.label} · ${m.time.toFixed(2)}s`} onClick={()=>seek(m.time)}/>)}</div>)}</div><input aria-label="Timeline playhead" type="range" min="0" max={duration||1} step="0.01" value={time} disabled={media?.type==='youtube'||!duration} onChange={e=>seek(Number(e.target.value))}/></>:<div className="studio-tab-content">{(tab==='Scenes'||tab==='Markers')&&listedMarkers.length?listedMarkers.map(m=><button key={`${m.kind}:${m.time}`} disabled={!canSeek} onClick={()=>seek(m.time)}>{m.label} · {m.time.toFixed(2)}s</button>):tab==='Scenes'?'No cut timestamps supplied.':tab==='Markers'?'No timestamp references supplied.':'Chapters not supplied by this report.'}</div>}</div></div><p className="studio-note">{media?.type==='youtube'?'Official embed playback only. Timeline inspection of YouTube streams is unavailable.':markers.length?`${markers.filter(m=>m.kind==='cut').length} cut, ${markers.filter(m=>m.kind==='beat').length} beat, ${markers.filter(m=>m.kind==='reference').length} evidence-reference markers supplied. No positions are inferred from BPM.`:'No timestamp markers supplied yet.'}</p></Panel>
 </CompactSection>
 <CompactSection title="Project details" className="studio-inspector"><Panel title="PROJECT" icon={<SlidersHorizontal size={15}/>}><div className="studio-project-icon"><Film size={24}/></div><h3>{media?.title||'Untitled workspace'}</h3><dl>{[['Source',media?.type||'—'],['Duration',duration?clock(duration):'—'],['Resolution',size],['Format',size==='—'?'—':Number(size.split(' × ')[0])<Number(size.split(' × ')[1])?'Vertical / Shorts':'Landscape'],['Analysis',progress.status!=='IDLE'?progress.status.replace(/_/g,' '):report?'Report imported':'Not assessed'],['Tags','None verified']].map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl><button disabled={!report} onClick={exportReport}><Download size={14}/> Export report</button><p className="studio-note">Session only. No account history or cloud project storage.</p><div className="studio-privacy">PRIVATE BY DEFAULT<br/><span>Importing a file does not grant publishing rights.</span></div></Panel></CompactSection></div>
 <CompactSection title="Analysis insights" className="studio-insights"><div className="studio-bottom"><Panel title="DETECTED SCENES" icon={<Film size={15}/>}><p className="studio-note">{markerReport?.markers.length?`${markerReport.markers.length} supplied timestamp references. Review them in the timeline.`:'No scene analysis available yet.'}</p></Panel><Panel title="AUDIO INSIGHTS" icon={<AudioLines size={15}/>}><div className="studio-wave-empty" aria-hidden="true"/><p className="studio-note">{report?.mediaNotes?.length?report.mediaNotes.join(' '):'Open Evidence Details for available timing and audio measurements.'}</p></Panel><Panel title="DETECTED MUSIC" icon={<AudioLines size={15}/>}><Finding item={report?.music||{label:'Recognition',status:'UNKNOWN',value:'Music not yet identified.',provenance:''}}/></Panel><Panel title="DETECTED SOURCE" icon={<ScanLine size={15}/>} >{report?.sources.length?report.sources.map((x,i)=><Finding key={i} item={x}/>):<Finding item={{label:'Visual recognition',status:'UNKNOWN',value:'No independently identified sources.',provenance:''}}/>}</Panel><Panel title="SUGGESTED IMPROVEMENTS" icon={<SlidersHorizontal size={15}/>}><p className="studio-note">No supported recommendations yet. Suggestions will be linked to specific findings.</p></Panel></div></CompactSection>
 </div>
}
