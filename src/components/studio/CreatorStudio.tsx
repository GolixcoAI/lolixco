import {useEffect, useId, useMemo, useRef, useState, type ReactNode} from 'react';
import {ArrowUpRight, AudioLines, ChevronDown, Download, Film, Layers, Link2, Minus, Play, Plus, ScanLine, SlidersHorizontal, Upload} from 'lucide-react';
import YouTubePlayer from '../video/YouTubePlayer';
import RatingReveal from './RatingReveal';
import {applyAnalysisEvent, INITIAL_ANALYSIS, progressPresentation, type AnalysisEvent} from './analysisProgress';
import {adaptStudioReport, type Evidence, type StudioReport} from './studioAdapter';
import {useLocalAnalyzer} from './useLocalAnalyzer';
import {youtubePlaybackIssue, youtubeReferenceId, youtubeWatchUrl} from './youtubeReference';

type Media =
 | {url: string; title: string; type: 'local'; file: File; audioOnly: boolean}
 | {url: string; title: string; type: 'sample'}
 | {url: string; title: string; type: 'staged'; id: string; audioOnly: boolean}
 | {url: string; title: string; type: 'youtube'; id: string};
type Preview = {duration: number; dimensions: string; error?: string};
const EMPTY_PREVIEW: Preview = {duration: 0, dimensions: '—'};
const EMPTY_EVENTS: readonly AnalysisEvent[] = [];
const tabs = ['Timeline', 'Scenes', 'Chapters', 'Markers'];
const providerLabels = {
 connected: 'Connected',
 not_configured: 'Not configured',
 rate_limited: 'Rate-limited',
 unsupported: 'Unsupported',
 temporarily_unavailable: 'Temporarily unavailable',
};
const clock = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
const audioFile = /\.(mp3|wav|flac|ogg|opus|m4a|aac)$/i;
const audioOnly = (media: Media | null) => !!media && 'audioOnly' in media && media.audioOnly;

function Panel({title, icon, children}: {title: string; icon: ReactNode; children: ReactNode}) {
 return <section className="studio-panel"><header>{icon}<h2>{title}</h2></header>{children}</section>;
}

function CompactSection({title, children, className = '', id, open: controlledOpen, onToggle}: {
 title: string; children: ReactNode; className?: string; id?: string; open?: boolean; onToggle?: (open: boolean) => void;
}) {
 const [expanded, setExpanded] = useState(false);
 const bodyId = useId();
 const open = controlledOpen ?? expanded;
 return <div id={id} className={className}>
  <button className="studio-compact-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => (onToggle ?? setExpanded)(!open)}>
   {title}<ChevronDown size={16} aria-hidden="true"/>
  </button>
  <div id={bodyId} className="studio-compact-body" data-open={open}>{children}</div>
 </div>;
}

function Finding({item}: {item: Evidence}) {
 return <div className="studio-finding">
  <div><span>{item.label.replaceAll('_', ' ')}</span><span className={`studio-status ${item.status === 'CONFLICT' ? 'conflict' : ''}`}>{item.status}</span></div>
  <strong>{item.value}</strong>
  {item.provenance && <small>Evidence · {item.provenance}</small>}
 </div>;
}

function downloadReport(value: unknown) {
 const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], {type: 'application/json'}));
 const link = document.createElement('a');
 link.href = url;
 link.download = 'lolixco-analysis-report.json';
 link.click();
 setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function CreatorStudio({analysisEvents = EMPTY_EVENTS}: {analysisEvents?: readonly AnalysisEvent[]}) {
 const analyzer = useLocalAnalyzer();
 const incomingEvents = analyzer.events.length ? analyzer.events : analysisEvents;
 const progress = useMemo(() => {
  try {return incomingEvents.reduce(applyAnalysisEvent, INITIAL_ANALYSIS);}
  catch {return {...INITIAL_ANALYSIS, status: 'FAILED' as const, message: 'Analysis evidence could not be validated.'};}
 }, [incomingEvents]);
 const progressiveReport = useMemo(() => {
  const report = progressPresentation(progress);
  return report ? adaptStudioReport(report) : null;
 }, [progress]);
 const [mode, setMode] = useState<'local' | 'youtube'>('local');
 const [media, setMedia] = useState<Media | null>(null);
 const [preview, setPreview] = useState<Preview>(EMPTY_PREVIEW);
 const [time, setTime] = useState(0);
 const [url, setUrl] = useState('');
 const [urlTouched, setUrlTouched] = useState(false);
 const [error, setError] = useState('');
 const [imported, setImported] = useState<{report: StudioReport; raw: unknown} | null>(null);
 const [loading, setLoading] = useState(false);
 const [consent, setConsent] = useState(false);
 const [previewOpen, setPreviewOpen] = useState(false);
 const [embedIssue, setEmbedIssue] = useState('');
 const [referenceTitle, setReferenceTitle] = useState('');
 const inputRevision = useRef(0);
 const scrollOnStart = useRef(false);
 const player = useRef<HTMLMediaElement | null>(null);
 const statusPanel = useRef<HTMLDivElement>(null);
 const local = useRef<HTMLInputElement>(null);
 const json = useRef<HTMLInputElement>(null);
 const urlInput = useRef<HTMLInputElement>(null);
 const inputId = useId();

 const report = progress.status === 'IDLE' ? imported?.report : progressiveReport;
 const markerReport = useMemo(() => {
  if (!analyzer.reports || report?.remoteObservation) return report;
  try {return adaptStudioReport(analyzer.reports.v6);}
  catch {return report;}
 }, [analyzer.reports, report]);
 const youtubeId = media?.type === 'youtube' ? media.id : '';
 const title = media?.type === 'youtube' ? referenceTitle || report?.referenceTitle || media.title : media?.title;
 const {duration, dimensions} = preview;
 const {max_bytes, max_seconds, max_dimension, max_pixels, max_fps, extensions} = analyzer.mediaLimits;
 const canSeek = duration > 0 && media?.type !== 'youtube';
 const fileLimit = max_bytes / (1024 * 1024);
 const resolutionLimit = `${Math.floor(max_pixels / max_dimension)}p-equivalent`;
 const limitsText = `${fileLimit} MiB · ${max_seconds / 60} min · up to ${resolutionLimit} / ${max_fps} fps`;
 const fileIssue = media?.type === 'local' && (
  !media.file.size ? 'Choose a file with media content.'
  : media.file.size > max_bytes ? `Choose a file up to ${fileLimit} MiB.`
  : !extensions.some(extension => media.file.name.toLowerCase().endsWith(extension)) ? 'Choose a supported video or audio format.'
  : duration > max_seconds ? `Trim the file to ${max_seconds} seconds or less.`
  : ''
 );
 const invalidUrl = mode === 'youtube' && urlTouched && !!url.trim() && !youtubeReferenceId(url);
 const remoteReady = analyzer.provider.status === 'connected' && consent;
 const sourceLocked = analyzer.busy || analyzer.cleaning;
 const canStart = analyzer.ready && !!media && !sourceLocked && !fileIssue && (media.type !== 'youtube' || remoteReady);
 const jobStatus = analyzer.snapshot?.status;
 const jobStage = analyzer.cancelling ? 'Cancelling analysis…'
  : analyzer.uploading ? 'Preparing media…'
  : analyzer.busy && !jobStatus ? 'Preparing media…'
  : analyzer.busy && jobStatus === 'COMPLETE' ? 'Preparing results…'
  : analyzer.snapshot?.current_stage || (analyzer.startCancelled ? 'Analysis cancelled' : '');
 const stagedUrl = media?.type === 'local' ? media.url : '';
 const inspectYoutube = analyzer.inspectYoutube;

 useEffect(() => () => {if (stagedUrl) URL.revokeObjectURL(stagedUrl);}, [stagedUrl]);
 useEffect(() => {
  if (!analyzer.busy || !scrollOnStart.current) return;
  scrollOnStart.current = false;
  if (matchMedia('(max-width: 780px)').matches) {
   const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
   statusPanel.current?.scrollIntoView({block: 'start', behavior});
  }
 }, [analyzer.busy]);
 useEffect(() => {
  if (media || !analyzer.snapshot) return;
  const {staged_media: staged, media_filename: filename, youtube_video_id: id} = analyzer.snapshot;
  if (id) {
   setMode('youtube');
   setUrl(youtubeWatchUrl(id));
   setMedia({url: youtubeWatchUrl(id), title: 'YouTube reference', type: 'youtube', id});
  } else if (staged) {
   setMedia({url: '/api/v8/media/' + staged.id, title: staged.name, type: 'staged', id: staged.id, audioOnly: staged.audio_only});
  } else if (analyzer.files.some(file => file.filename === filename)) {
   setMedia({url: '/__dna/media?filename=' + encodeURIComponent(filename), title: filename, type: 'sample'});
  }
 }, [analyzer.snapshot, analyzer.files, media]);

 useEffect(() => {
  if (!youtubeId || !analyzer.ready) return;
  const controller = new AbortController();
  void inspectYoutube(youtubeId, controller.signal).then(raw => {
   if (!controller.signal.aborted) setReferenceTitle(adaptStudioReport(raw).referenceTitle || '');
  }).catch(() => {/* Publisher metadata is optional. */});
  return () => controller.abort();
 }, [youtubeId, analyzer.ready, inspectYoutube]);

 function clearInput() {
  if (!analyzer.clear()) return false;
  inputRevision.current++;
  setMedia(null);
  setPreview(EMPTY_PREVIEW);
  setTime(0);
  setError('');
  setImported(null);
  setLoading(false);
  setConsent(false);
  setEmbedIssue('');
  setReferenceTitle('');
  return true;
 }

 function selectMode(next: 'local' | 'youtube') {
  if (mode === next) return true;
  if (!clearInput()) return false;
  setMode(next);
  setUrl('');
  setUrlTouched(false);
  return true;
 }

 function updateYoutube(value: string) {
  if (sourceLocked) return;
  const id = youtubeReferenceId(value);
  setUrl(value);
  if (id === (youtubeId || null)) return;
  if (!clearInput() || !id) return;
  setMedia({url: youtubeWatchUrl(id), title: 'YouTube reference', type: 'youtube', id});
 }

 function selectFile(file: File) {
  if (!clearInput()) return;
  setMode('local');
  setMedia({
   type: 'local', url: URL.createObjectURL(file), title: file.name,
   file, audioOnly: file.type.startsWith('audio/') || audioFile.test(file.name),
  });
 }

 function selectSample(filename: string) {
  if (!clearInput() || !filename) return;
  setMode('local');
  setMedia({url: '/__dna/media?filename=' + encodeURIComponent(filename), title: filename, type: 'sample'});
 }

 function seek(seconds: number) {
  if (!player.current || !canSeek) return;
  const target = Math.max(0, Math.min(duration, seconds));
  player.current.currentTime = target;
  setTime(target);
 }

 function showPreview() {
  setPreviewOpen(true);
  requestAnimationFrame(() => document.getElementById('studio-preview')?.scrollIntoView({block: 'nearest'}));
 }

 async function importReport(file: File) {
  if (sourceLocked) return;
  const revision = ++inputRevision.current;
  setLoading(true);
  try {
   if (file.size > 2_000_000) throw Error('Choose a report smaller than 2 MB.');
   const raw = JSON.parse(await file.text());
   const adapted = adaptStudioReport(raw);
   if (inputRevision.current !== revision || !analyzer.dismissResult()) return;
   setImported({report: adapted, raw});
   setError('');
  } catch (failure) {
   if (inputRevision.current === revision) setError(failure instanceof Error ? failure.message : 'Report unavailable.');
  } finally {
   if (inputRevision.current === revision) setLoading(false);
  }
 }

 function startAnalysis() {
  if (!canStart || !media) return;
  scrollOnStart.current = true;
  inputRevision.current++;
  setImported(null);
  setLoading(false);
  setError('');
  if (media.type === 'local') void analyzer.start({type: 'file', file: media.file});
  else if (media.type === 'sample') void analyzer.start({type: 'sample', filename: media.title});
  else {
   if (media.type === 'youtube') setConsent(false);
   void analyzer.start({type: media.type, id: media.id});
  }
 }

 function exportReport() {
  if (report) downloadReport(imported?.raw ?? progress.report ?? report);
 }

 async function deleteTemporary() {
  if (await analyzer.deleteStaged() && media?.type === 'staged') {
   setMedia(null);
   setPreview(EMPTY_PREVIEW);
   setTime(0);
  }
 }

 function setPreviewDuration(element: HTMLMediaElement) {
  const length = Number.isFinite(element.duration) ? element.duration : 0;
  const size = element instanceof HTMLVideoElement ? `${element.videoWidth} × ${element.videoHeight}` : 'Audio';
  setPreview({duration: length, dimensions: size});
 }

 const terminalReport = !analyzer.busy && !!report && (progress.status === 'COMPLETE' || !!imported);
 const sampleName = media?.type === 'sample' ? media.title : '';
 const displayError = error || fileIssue || analyzer.error || (jobStatus === 'FAILED' && analyzer.snapshot?.error) || progress.status === 'FAILED' && progress.message;

 return <div className="creator-studio">
  <header className="studio-banner">
   <div className="studio-kicker">LOLIXCO / CREATIVE WORKSPACE <span>01</span></div>
   <h1>CREATOR <em>STUDIO</em></h1>
   <p>Analyze your edit, follow the evidence and explore seven assessment dimensions.</p>
  </header>

  <section className="studio-intake" aria-labelledby="studio-intake-heading">
   <div className="studio-intake-heading">
    <h2 id="studio-intake-heading">Choose your media</h2>
    <div className="studio-connections">
     <span><i className="studio-dot" data-connected={analyzer.ready}/>Local analyzer · {analyzer.ready ? 'Connected' : 'Offline'}</span>
     <span><i className="studio-dot" data-connected={analyzer.provider.status === 'connected'}/>Gemini · {providerLabels[analyzer.provider.status]}</span>
    </div>
   </div>
   <div className="studio-source-selector" aria-label="Analysis source" role="group">
    <button type="button" aria-pressed={mode === 'local'} disabled={sourceLocked} onClick={() => {if (selectMode('local')) local.current?.click();}}>
     <Upload size={17} aria-hidden="true"/>Import Video / Audio
    </button>
    <button type="button" aria-pressed={mode === 'youtube'} disabled={sourceLocked} onClick={() => {if (selectMode('youtube')) requestAnimationFrame(() => urlInput.current?.focus());}}>
     <Link2 size={17} aria-hidden="true"/>Paste YouTube URL
    </button>
   </div>
   <input ref={local} type="file" accept={extensions.join(',')} hidden aria-label="Import local video or audio" onChange={event => {
    const file = event.target.files?.[0];
    if (file) selectFile(file);
    event.target.value = '';
   }}/>
   <input ref={json} type="file" accept="application/json,.json" hidden aria-label="Import analysis JSON" onChange={event => {
    const file = event.target.files?.[0];
    if (file) void importReport(file);
    event.target.value = '';
   }}/>

   {mode === 'youtube' ? <div className="studio-youtube-intake">
    <label htmlFor={inputId}>Public YouTube video</label>
    <input id={inputId} ref={urlInput} type="url" inputMode="url" placeholder="https://youtu.be/…" value={url} disabled={sourceLocked}
     aria-invalid={invalidUrl} aria-describedby="studio-youtube-capability"
     onChange={event => updateYoutube(event.target.value)} onBlur={() => setUrlTouched(true)}/>
    {invalidUrl && <p className="studio-inline-error">Enter a public HTTPS YouTube watch, Shorts or youtu.be URL.</p>}
   </div> : <p className="studio-intake-help">Private local video and audio · {limitsText}</p>}

   {media && <div className="studio-selected-source">
    {audioOnly(media) ? <AudioLines size={18} aria-hidden="true"/> : media.type === 'youtube' ? <Link2 size={18} aria-hidden="true"/> : <Film size={18} aria-hidden="true"/>}
    <div>
     <strong>{title}</strong>
     <small>{media.type === 'youtube' ? embedIssue || 'Public video link accepted'
      : fileIssue ? 'File needs attention'
      : preview.error || (duration ? `${clock(duration)} · ${dimensions}` : 'Format accepted · full validation at start')}</small>
    </div>
    <button type="button" onClick={showPreview}>Preview</button>
    {media.type === 'youtube' && <a href={media.url} target="_blank" rel="noopener noreferrer">Watch on YouTube <ArrowUpRight size={14} aria-hidden="true"/></a>}
   </div>}

   <div className="studio-start-area">
    <div className="studio-start-details">
     {mode === 'youtube' ? <div id="studio-youtube-capability">
      {analyzer.provider.status === 'connected' ? <>
       <p>Gemini can analyze audiovisual content from the first two minutes of an eligible public video. Playback and analysis are separate.</p>
       <label className="studio-consent"><input type="checkbox" checked={consent} disabled={!youtubeId || analyzer.busy} onChange={event => setConsent(event.target.checked)}/>
        <span>Send this public URL to Google Gemini. Analysis may use the configured API quota or incur charges.</span>
       </label>
      </> : <p>Public video AI analysis needs a connected Gemini provider. {analyzer.provider.message}</p>}
     </div> : <p>{media ? 'The analyzer processes your file privately on this device.' : 'Choose a video or audio file to enable analysis.'}</p>}
     {!analyzer.ready && <p>{analyzer.enabled ? 'Start the local analyzer and refresh its connection.' : 'Live analysis is available in the localhost workspace.'}</p>}
    </div>
    <button className="studio-start" type="button" disabled={!canStart} onClick={startAnalysis}>
     <ScanLine size={19} aria-hidden="true"/>START AI ANALYSIS
    </button>
   </div>

   {displayError && <p className="studio-inline-error" role="alert">{displayError}</p>}

   {(analyzer.busy || jobStage) && <div ref={statusPanel} className="studio-job-status" data-status={jobStatus || 'starting'}>
    <div role="status">
     <strong>{jobStage}</strong>
     {analyzer.busy && analyzer.snapshot && <progress aria-label="Analyzer job progress" max={100} value={analyzer.snapshot.progress_percent}/>}
    </div>
    {analyzer.busy && <button type="button" disabled={analyzer.cancelling} onClick={() => void analyzer.cancel()}>Cancel analysis</button>}
   </div>}

   <div className="studio-intake-actions">
    {analyzer.enabled && mode === 'local' && <details className="studio-samples">
     <summary>Sample &amp; Previous Local Files</summary>
     <div>
      {analyzer.files.length ? <label>Choose a local sample
       <select value={sampleName} disabled={sourceLocked} onChange={event => selectSample(event.target.value)}>
        <option value="">Select a file…</option>
        {analyzer.files.map(file => <option key={file.filename} value={file.filename}>{file.filename}</option>)}
       </select>
      </label> : <p>No sample files are available in this workspace.</p>}
     </div>
    </details>}
    {analyzer.enabled && (!analyzer.ready || mode === 'youtube') && <button type="button" onClick={() => void analyzer.refresh()}>Refresh connection</button>}
    {terminalReport && <button type="button" onClick={exportReport}><Download size={15} aria-hidden="true"/>Export report</button>}
   </div>
  </section>

  <div className="studio-workspace">
   <section className="studio-analyzer" aria-label="Analysis results">
    <Panel title="AI EDIT ANALYZER" icon={<ScanLine size={16} aria-hidden="true"/>}>
     {report?.remoteObservation && <div className="studio-remote-observation">
      <p className="studio-observation-badge">Remote AI Observation · Gemini {report.remoteObservation.model} · Experimental</p>
      {report.remoteObservation.directlyObserved && <p><strong>Model-reported observations</strong> {report.remoteObservation.directlyObserved}</p>}
      {report.remoteObservation.uncertain && <p><strong>Uncertain hypotheses</strong> {report.remoteObservation.uncertain}</p>}
     </div>}
     {report?.metadataOnly && <p className="studio-observation-badge">Publisher metadata only</p>}
     <RatingReveal experimental={report?.experimental} localResult={analyzer.enabled && progress.status !== 'IDLE'}
      processing={analyzer.busy} analysisComplete={!analyzer.busy && progress.status === 'COMPLETE'}
      onSeek={canSeek ? seek : undefined} receivedResultId={analyzer.liveJobId} ratings={report?.ratings}
      synthetic={report?.synthetic} developmentPreview={import.meta.env.DEV || import.meta.env.VITE_STUDIO_TIMING_PREVIEW === 'true'}/>
     {report && <details className="studio-evidence-details">
      <summary>Evidence Details</summary>
      {!!report.mediaNotes?.length && <ul className="studio-media-notes">{report.mediaNotes.map((note, i) => <li key={i}>{note}</li>)}</ul>}
      {report.evidence.map((item, i) => <Finding key={i} item={item}/>)}
     </details>}
    </Panel>
   </section>

   <CompactSection title="Preview & timeline" className="studio-preview" id="studio-preview" open={previewOpen} onToggle={setPreviewOpen}>
    <Panel title="PREVIEW MONITOR" icon={<Film size={15} aria-hidden="true"/>}>
     <div className={`studio-monitor ${media ? 'loaded' : ''} ${audioOnly(media) ? 'is-audio' : ''} ${media?.type === 'youtube' ? 'is-youtube' : ''}`}>
      {!media ? <div className="studio-empty"><div className="studio-crosshair"><Play size={26}/></div><h3>Media preview</h3><p>Choose a file or paste a YouTube link above.</p></div>
       : media.type === 'youtube' ? <YouTubePlayer key={media.id} videoId={media.id} title={title} autoPlay={false} controls
        iframeReferrerPolicy="strict-origin-when-cross-origin" onError={code => setEmbedIssue(youtubePlaybackIssue(code))}
        onPlay={() => setEmbedIssue('')}/>
       : preview.error ? <p className="studio-preview-error">{preview.error}</p>
       : audioOnly(media) ? <audio key={media.url} ref={element => {player.current = element;}} src={media.url} controls preload="metadata"
        onLoadedMetadata={event => setPreviewDuration(event.currentTarget)} onTimeUpdate={event => setTime(event.currentTarget.currentTime)}
        onError={() => setPreview(old => ({...old, error: 'Browser preview unavailable. The local analyzer can still check the file.'}))}/>
       : <video key={media.url} ref={element => {player.current = element;}} src={media.url} controls preload="metadata" playsInline
        onLoadedMetadata={event => setPreviewDuration(event.currentTarget)} onTimeUpdate={event => setTime(event.currentTarget.currentTime)}
        onError={() => setPreview(old => ({...old, error: 'Browser preview unavailable. The local analyzer can still check the file.'}))}/>}
     </div>
     <div className="studio-media-caption"><strong>{title || 'No media selected'}</strong><span>{duration ? clock(duration) : '—'} / {dimensions}</span></div>
    </Panel>
    <Timeline media={media} duration={duration} time={time} report={markerReport} seek={seek}/>
   </CompactSection>

   <CompactSection title="Project details" className="studio-inspector">
    <Panel title="PROJECT" icon={<SlidersHorizontal size={15} aria-hidden="true"/>}>
     <h3>{title || 'Untitled workspace'}</h3>
     <dl>
      <div><dt>Source</dt><dd>{media?.type === 'youtube' ? 'Public YouTube URL' : media ? 'Local file' : '—'}</dd></div>
      <div><dt>Duration</dt><dd>{duration ? clock(duration) : '—'}</dd></div>
      <div><dt>Format</dt><dd>{dimensions}</dd></div>
     </dl>
     <button disabled={sourceLocked || loading} onClick={() => json.current?.click()}>{loading ? 'Reading report…' : 'Import analysis report'}</button>
     {analyzer.staged && !analyzer.busy && <button disabled={analyzer.cleaning} onClick={() => void deleteTemporary()}>Delete temporary media</button>}
     {analyzer.reports && !analyzer.busy && <button disabled={analyzer.cleaning} onClick={() => void analyzer.deleteReport()}>Delete saved report</button>}
     <p className="studio-note">Local analysis copies expire after one hour. Saved reports can be exported and deleted here.</p>
    </Panel>
   </CompactSection>
  </div>

  {report && <CompactSection title="Recognition & insights" className="studio-insights">
   <div className="studio-bottom">
    <Panel title="DETECTED MUSIC" icon={<AudioLines size={15}/>}><Finding item={report.music}/></Panel>
    <Panel title="SOURCE CANDIDATES" icon={<ScanLine size={15}/>}>
     {report.sources.length ? report.sources.map((item, i) => <Finding key={i} item={item}/>)
      : <Finding item={{label: 'Visual recognition', status: 'UNKNOWN', value: report.sourceNote || 'No independently identified sources.', provenance: ''}}/>}
    </Panel>
    <Panel title="SUGGESTED IMPROVEMENTS" icon={<SlidersHorizontal size={15}/>}>
     <p className="studio-note">{report.ratings.categories[0]?.timestamps?.length
      ? 'Review the marked cut-to-audio references against the beats you intended to emphasize.'
      : report.scenes.length ? 'Review the transition timestamps to see how the shot changes serve your intended pacing.'
      : 'The report contains no timestamped evidence for a specific editing suggestion.'}</p>
    </Panel>
   </div>
  </CompactSection>}
 </div>;
}

function Timeline({media, duration, time, report, seek}: {
 media: Media | null; duration: number; time: number; report?: StudioReport | null; seek: (time: number) => void;
}) {
 const [tab, setTab] = useState('Timeline');
 const [zoom, setZoom] = useState(1);
 const markers = (report?.markers ?? []).filter(marker => duration > 0 && marker.time <= duration);
 const listed = tab === 'Scenes' ? markers.filter(marker => marker.kind === 'cut') : markers;
 const canSeek = duration > 0 && media?.type !== 'youtube';

 return <Panel title="EDIT TIMELINE" icon={<Layers size={15} aria-hidden="true"/>}>
  <div className="studio-tabs" role="tablist" aria-label="Workspace views" onKeyDown={event => {
   const index = tabs.indexOf(tab);
   const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
    : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
    : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
   if (next < 0) return;
   event.preventDefault();
   setTab(tabs[next]);
   event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus();
  }}>
   {tabs.map(item => <button key={item} role="tab" tabIndex={tab === item ? 0 : -1} aria-selected={tab === item} onClick={() => setTab(item)}>{item}</button>)}
   <span className="studio-zoom"><button aria-label="Zoom timeline out" onClick={() => setZoom(Math.max(1, zoom - 1))}><Minus size={13}/></button>{zoom}×<button aria-label="Zoom timeline in" onClick={() => setZoom(Math.min(4, zoom + 1))}><Plus size={13}/></button></span>
  </div>
  <div className="studio-timeline-scroll">
   <div className="studio-timeline" style={{width: `${zoom * 100}%`}}>
    <div className="studio-ruler">{Array.from({length: 7}, (_, i) => <span key={i}>{clock(duration * i / 6)}</span>)}</div>
    {tab === 'Timeline' ? <>
     <div className="studio-track"><span>{audioOnly(media) ? 'AUDIO' : 'VIDEO'}</span>
      <div className="studio-track-empty">{markers.length ? `${markers.length} supplied timestamp markers` : media ? 'No timestamp markers supplied yet' : 'Import media to begin'}</div>
     </div>
     <div className="studio-marker-lanes">
      {(['cut', 'beat', 'reference'] as const).filter(kind => markers.some(marker => marker.kind === kind)).map(kind =>
       <div className={`studio-marker-lane ${kind}`} key={kind} aria-label={`${kind} markers`}>
        {markers.filter(marker => marker.kind === kind).map(marker => <button key={`${marker.kind}:${marker.time}`} disabled={!canSeek}
         style={{left: `${marker.time / duration * 100}%`}} aria-label={`Seek to ${marker.label} at ${marker.time.toFixed(2)} seconds`}
         title={`${marker.label} · ${marker.time.toFixed(2)}s`} onClick={() => seek(marker.time)}/>)}
       </div>)}
     </div>
     <input aria-label="Timeline playhead" type="range" min="0" max={duration || 1} step="0.01" value={time} disabled={!canSeek} onChange={event => seek(Number(event.target.value))}/>
    </> : <div className="studio-tab-content">
     {(tab === 'Scenes' || tab === 'Markers') && listed.length
      ? listed.map(marker => <button key={`${marker.kind}:${marker.time}`} disabled={!canSeek} onClick={() => seek(marker.time)}>{marker.label} · {marker.time.toFixed(2)}s</button>)
      : tab === 'Scenes' ? 'No cut timestamps supplied.' : tab === 'Markers' ? 'No timestamp references supplied.' : 'Chapters not supplied by this report.'}
    </div>}
   </div>
  </div>
  <p className="studio-note">{media?.type === 'youtube' ? 'Timeline seeking is available for local files.' : 'Timestamp markers come from the analysis report.'}</p>
 </Panel>;
}
