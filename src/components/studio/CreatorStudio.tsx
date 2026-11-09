import {useEffect, useId, useMemo, useRef, useState, type ReactNode} from 'react';
import {ArrowUpRight, AudioLines, ChevronDown, Download, Film, Layers, Link2, Minus, Play, Plus, ScanLine, SlidersHorizontal, Upload} from 'lucide-react';
import YouTubePlayer, {type YouTubePlayerHandle} from '../video/YouTubePlayer';
import Dialog from '../ui/Dialog';
import LoadingRing from '../ui/LoadingRing';
import ProductState from '../ui/ProductState';
import RatingReveal from './RatingReveal';
import ProcessingLabel from './ProcessingLabel';
import {V7_IDS} from './presentationV7';
import {applyAnalysisEvent, INITIAL_ANALYSIS, progressPresentation, type AnalysisEvent} from './analysisProgress';
import {adaptStudioReport, type Evidence, type StudioReport} from './studioAdapter';
import {useLocalAnalyzer} from './useLocalAnalyzer';
import {youtubePlaybackIssue, youtubeReferenceId, youtubeWatchUrl} from './youtubeReference';
import {developerAnalyzerToolsEnabled} from '../../config/analyzerEndpoint';
import {ANALYSIS_PRIVACY_KEY, readAnalysisPrivacy, saveAnalysisPrivacy, type AnalysisPrivacy, type ProcessingChoice} from './analysisPrivacy';
import {analysisStage} from './analysisMessages';

type Media =
 | {url: string; title: string; type: 'local'; file: File; audioOnly: boolean}
 | {url: string; title: string; type: 'sample'}
 | {url: string; title: string; type: 'staged'; id: string; audioOnly: boolean}
 | {url: string; title: string; type: 'youtube'; id: string};
type Preview = {duration: number; dimensions: string; error?: string};
const EMPTY_PREVIEW: Preview = {duration: 0, dimensions: '—'};
const EMPTY_EVENTS: readonly AnalysisEvent[] = [];
const tabs = ['Timeline', 'Scenes', 'Markers'];
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
  <div><span>{item.label.replaceAll('_', ' ')}</span><span className={`studio-status ${item.status === 'CONFLICT' ? 'conflict' : ''}`}>{({MEASURED:'Measured',EXPERIMENTAL:'Experimental',INFERRED:'Possible match',PERSONALIZED:'Historical','NOT ASSESSED':'Not assessed',UNKNOWN:'Unconfirmed',CONFLICT:'Needs review'})[item.status]}</span></div>
  <strong>{item.value}</strong>
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
  catch {return {...INITIAL_ANALYSIS, status: 'FAILED' as const, message: 'Your feedback could not be loaded. Please analyze the edit again.'};}
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
 const [privacy, setPrivacy] = useState(readAnalysisPrivacy);
 const [privacyScope, setPrivacyScope] = useState<'files' | 'youtube' | 'manage' | null>(() => new URLSearchParams(location.search).get('privacy') === 'processing' ? 'manage' : null);
 const [rememberPrivacy, setRememberPrivacy] = useState(true);
 const pendingConsent = useRef(false);
 const consentRevision = useRef(0);
 const developerTools = developerAnalyzerToolsEnabled();
 const [previewOpen, setPreviewOpen] = useState(false);
 const [embedIssue, setEmbedIssue] = useState('');
 const [youtubeReady, setYoutubeReady] = useState(false);
 const [referenceTitle, setReferenceTitle] = useState('');
 const inputRevision = useRef(0);
 const scrollOnStart = useRef(false);
 const player = useRef<HTMLMediaElement | null>(null);
 const youtubePlayer = useRef<YouTubePlayerHandle>(null);
 const statusPanel = useRef<HTMLDivElement>(null);
 const local = useRef<HTMLInputElement>(null);
 const json = useRef<HTMLInputElement>(null);
 const urlInput = useRef<HTMLInputElement>(null);
 const inputId = useId();

 const report = progress.status === 'IDLE' ? imported?.report : progressiveReport;
 const markerReport = useMemo(() => {
  if (!analyzer.reports || media?.type === 'youtube') return report;
  try {return adaptStudioReport(analyzer.reports.v6);}
  catch {return report;}
 }, [analyzer.reports, report, media?.type]);
 const youtubeId = media?.type === 'youtube' ? media.id : '';
 const title = media?.type === 'youtube' ? referenceTitle || report?.referenceTitle || media.title : media?.title;
 const {duration, dimensions} = preview;
 const {max_bytes, max_seconds, extensions} = analyzer.mediaLimits;
 const canSeek = media?.type === 'youtube' ? youtubeReady && !embedIssue : duration > 0;
 const fileLimit = max_bytes / (1024 * 1024);
 const limitsText = `Up to ${fileLimit} MiB · ${max_seconds / 60} minutes`;
 const fileIssue = media?.type === 'local' && (
  !media.file.size ? 'Choose a file with media content.'
  : media.file.size > max_bytes ? `This file is larger than ${fileLimit} MiB. Choose a smaller file.`
  : !extensions.some(extension => media.file.name.toLowerCase().endsWith(extension)) ? 'Choose a supported video or audio format.'
  : duration > max_seconds ? 'This edit is longer than two minutes. Trim it and try again.'
  : ''
 );
 const invalidUrl = mode === 'youtube' && urlTouched && !!url.trim() && !youtubeReferenceId(url);
 const remoteReady = analyzer.provider.status === 'connected' && privacy.youtube !== 'decline';
 const sourceLocked = analyzer.busy || analyzer.cleaning;
 const canStart = analyzer.ready && !!media && !sourceLocked && !fileIssue && (media.type !== 'youtube' || remoteReady);
 const jobStatus = analyzer.snapshot?.status;
 const jobStage = analyzer.cancelling ? 'Cancelling analysis…'
  : analyzer.uploading ? 'Preparing media…'
  : analyzer.busy && !jobStatus ? 'Preparing media…'
  : analyzer.busy && jobStatus === 'COMPLETE' ? 'Preparing results…'
  : analyzer.snapshot ? analysisStage(analyzer.snapshot.current_stage, jobStatus)
  : analyzer.startCancelled ? 'Analysis cancelled. You can analyze this edit again.' : '';
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
  const {staged_media: staged, media_filename: filename, youtube_video_id: id, media_id: cloudMedia} = analyzer.snapshot;
  if (id) {
   setMode('youtube');
   setUrl(youtubeWatchUrl(id));
   setMedia({url: youtubeWatchUrl(id), title: 'YouTube reference', type: 'youtube', id});
  } else if (staged) {
   setMedia({url: '/api/v8/media/' + staged.id, title: staged.name, type: 'staged', id: staged.id, audioOnly: staged.audio_only});
  } else if (cloudMedia && analyzer.cloud) {
   setMedia({url:'',title:filename,type:'staged',id:cloudMedia,audioOnly:false});
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
  pendingConsent.current = false;
  setEmbedIssue('');
  setYoutubeReady(false);
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
  const selectionStarted = performance.now();
  if (!clearInput()) return;
  setMode('local');
  setMedia({
   type: 'local', url: URL.createObjectURL(file), title: file.name,
   file, audioOnly: file.type.startsWith('audio/') || audioFile.test(file.name),
  });
  setPreviewOpen(true);
  requestAnimationFrame(() => {
   try {performance.measure('lolixco.file_selection',{start:selectionStarted,duration:performance.now()-selectionStarted});}catch{/* Optional browser timing. */}
  });
 }

 function selectSample(filename: string) {
  if (!clearInput() || !filename) return;
  setMode('local');
  setMedia({url: '/__dna/media?filename=' + encodeURIComponent(filename), title: filename, type: 'sample'});
 }

 function seek(seconds: number) {
  if (media?.type === 'youtube' && canSeek) {
   youtubePlayer.current?.seekTo(Math.max(0, seconds), true);
   showPreview();
   return;
  }
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
   if (inputRevision.current === revision) setError(file.size > 2_000_000 ? 'Choose a report smaller than 2 MB.' : "That report couldn't be opened. Choose a valid Lolixco report.");
  } finally {
   if (inputRevision.current === revision) setLoading(false);
  }
 }

 function runAnalysis(cloud: boolean) {
  if (!canStart || !media) return;
  scrollOnStart.current = true;
  inputRevision.current++;
  setImported(null);
  setLoading(false);
  setError('');
  if (media.type === 'local') void analyzer.start({type: 'file', file: media.file}, cloud);
  else if (media.type === 'sample') void analyzer.start({type: 'sample', filename: media.title}, cloud);
  else {
   void analyzer.start({type: media.type, id: media.id}, cloud);
  }
 }

 function startAnalysis() {
  if (!canStart || !media) return;
  const scope = media.type === 'youtube' ? 'youtube' : 'files';
  if (analyzer.provider.status === 'connected' && privacy[scope] === 'ask') {
   consentRevision.current = inputRevision.current;
   pendingConsent.current = true;
   setPrivacyScope(scope);
   return;
  }
  runAnalysis(analyzer.provider.status === 'connected' && privacy[scope] === 'allow');
 }

 function choosePrivacy(scope: 'files' | 'youtube', choice: ProcessingChoice) {
  const next: AnalysisPrivacy = {...privacy, [scope]: choice};
  setPrivacy(next);
  if (rememberPrivacy) saveAnalysisPrivacy({...readAnalysisPrivacy(), [scope]: choice});
  const shouldStart = pendingConsent.current && consentRevision.current === inputRevision.current;
  pendingConsent.current = false;
  closePrivacy();
  if (shouldStart && (scope === 'files' || choice === 'allow')) runAnalysis(choice === 'allow');
 }

 function openPrivacy() {
  pendingConsent.current = false;
  setPrivacyScope('manage');
 }

 function closePrivacy() {
  pendingConsent.current = false;
  setPrivacyScope(null);
  const current = new URL(location.href);
  if (current.searchParams.has('privacy')) {current.searchParams.delete('privacy'); history.replaceState(history.state, '', current);}
 }

 useEffect(() => {
  window.addEventListener('lolixco:analysis-privacy', openPrivacy);
  const syncPrivacy = (event: StorageEvent) => {if (event.key === ANALYSIS_PRIVACY_KEY || event.key === null) setPrivacy(readAnalysisPrivacy());};
  window.addEventListener('storage', syncPrivacy);
  return () => {window.removeEventListener('lolixco:analysis-privacy', openPrivacy); window.removeEventListener('storage', syncPrivacy);};
 }, []);

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
   <h1>Creator <em>Studio</em></h1>
   <p>Discover what makes your edit work.</p>
  </header>

  <section className="studio-intake" aria-labelledby="studio-intake-heading">
   <div className="studio-intake-heading">
    <h2 id="studio-intake-heading">Start with your edit</h2>
   </div>
   <div className="studio-source-selector" aria-label="Analysis source" role="group">
    <button type="button" aria-pressed={mode === 'local'} disabled={sourceLocked} onClick={() => {if (selectMode('local')) local.current?.click();}}>
     <Upload size={17} aria-hidden="true"/>Upload Video
    </button>
    <button type="button" aria-pressed={mode === 'youtube'} disabled={sourceLocked} onClick={() => {if (selectMode('youtube')) requestAnimationFrame(() => urlInput.current?.focus());}}>
     <Link2 size={17} aria-hidden="true"/>Paste YouTube Link
    </button>
   </div>
   <input ref={local} type="file" accept={extensions.join(',')} hidden aria-label="Upload video or audio" onChange={event => {
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
    <label htmlFor={inputId}>YouTube link</label>
    <input id={inputId} ref={urlInput} type="url" inputMode="url" placeholder="https://youtu.be/…" value={url} disabled={sourceLocked}
     aria-invalid={invalidUrl} aria-describedby="studio-youtube-capability"
     onChange={event => updateYoutube(event.target.value)} onBlur={() => setUrlTouched(true)}/>
    {invalidUrl && <p className="studio-inline-error">Enter a public HTTPS YouTube watch, Shorts or youtu.be URL.</p>}
   </div> : <p className="studio-intake-help">{limitsText} · MP4, MOV, WebM and more</p>}

   {media && <div className="studio-selected-source">
    {audioOnly(media) ? <AudioLines size={18} aria-hidden="true"/> : media.type === 'youtube' ? <Link2 size={18} aria-hidden="true"/> : <Film size={18} aria-hidden="true"/>}
    <div>
     <strong>{title}</strong>
     <small>{media.type === 'youtube' ? embedIssue || 'Public video link accepted'
      : fileIssue ? 'File needs attention'
      : preview.error || (duration ? `${clock(duration)} · ${dimensions}` : 'Ready to preview')}</small>
    </div>
    <button type="button" onClick={showPreview}>Preview</button>
    {media.type === 'youtube' && <a href={media.url} target="_blank" rel="noopener noreferrer">Watch on YouTube <ArrowUpRight size={14} aria-hidden="true"/></a>}
   </div>}

   <div className="studio-start-area">
    <div className="studio-start-details">
     <p id="studio-youtube-capability">{!media ? 'Choose a video or paste a public YouTube link.'
      : media.type === 'youtube' ? privacy.youtube === 'decline' ? 'YouTube analysis needs permission to process this public link with Google.' : 'Review up to the first two minutes of a public video.'
      : privacy.files === 'decline' || analyzer.provider.status !== 'connected' ? 'Signal analysis uses technical measurements, without sending media to an AI provider.'
      : privacy.files === 'allow' ? 'AI feedback includes video and audio processing by Google.' : 'Choose how your edit is processed before analysis.'}</p>
    </div>
    <button className="studio-start" type="button" disabled={!canStart} onClick={startAnalysis}>
     <ScanLine size={19} aria-hidden="true"/>{analyzer.busy ? <ProcessingLabel>Analyzing</ProcessingLabel> : 'Analyze Edit'}
    </button>
   </div>

   {analyzer.checking && <LoadingRing size="small" label="Getting analysis ready"/>}
   {!analyzer.checking && !analyzer.ready && <ProductState kind="notice" title={analyzer.enabled ? 'Analysis is temporarily unavailable' : 'Analysis is not available here yet'}
    description={analyzer.enabled ? 'Please try again. Your selected file will stay ready.' : 'You can still discover and watch edits. Analysis will need a supported processing service.'}
    action={analyzer.enabled ? {label: 'Retry', onClick: () => void analyzer.refresh()} : undefined}/>}
   {analyzer.ready && mode === 'youtube' && analyzer.provider.status !== 'connected' && !displayError && <ProductState kind="notice" title="AI analysis is unavailable right now"
    description="Please try again later, or upload a video for signal-based feedback." action={{label: 'Retry', onClick: () => void analyzer.refresh()}}/>}
   {analyzer.connectionLost ? <ProductState kind="error" title="Analysis connection interrupted" description="Your analysis may still be running. Reconnect to retrieve its results."
    action={{label: 'Reconnect', onClick: analyzer.retryConnection}}/>
    : displayError && <ProductState kind="error" title="Let's try that again" description={displayError}
     action={analyzer.busy ? undefined : mode === 'youtube' && analyzer.provider.status !== 'connected'
      ? {label: 'Retry', onClick: () => void analyzer.refresh()}
      : mode === 'youtube' ? {label: 'Edit link', onClick: () => urlInput.current?.focus()}
      : {label: 'Choose another file', onClick: () => local.current?.click()}}/>}

   {(analyzer.busy || jobStage) && <div ref={statusPanel} className="studio-job-status" data-status={jobStatus || 'starting'}>
    <div role="status">
     <strong>{analyzer.busy && !analyzer.connectionLost ? <ProcessingLabel>{jobStage}</ProcessingLabel> : analyzer.connectionLost ? 'Waiting to reconnect' : jobStage}</strong>
     {analyzer.busy && analyzer.snapshot && <progress aria-label="Analyzer job progress" max={100} value={analyzer.snapshot.progress_percent}/>}
    </div>
    {analyzer.busy && <button type="button" disabled={analyzer.cancelling} onClick={() => void analyzer.cancel()}>Cancel analysis</button>}
   </div>}

   <div className="studio-intake-actions">
    <button type="button" className="studio-privacy-control" onClick={openPrivacy} disabled={sourceLocked}>Analysis privacy</button>
    <a href="/?view=help#analyze">How it works</a>
    {developerTools && mode === 'local' && <details className="studio-samples">
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
    {terminalReport && <button type="button" onClick={exportReport}><Download size={15} aria-hidden="true"/>Export report</button>}
   </div>
  </section>

  <div className="studio-workspace" data-has-results={!!report || analyzer.busy}>
   <section className="studio-analyzer" aria-label="Analysis results">
    <Panel title="Your feedback" icon={<ScanLine size={16} aria-hidden="true"/>}>
     {report?.remoteObservation && <div className="studio-remote-observation">
      {report.remoteObservation.directlyObserved && <p><strong>What stood out</strong> {report.remoteObservation.directlyObserved}</p>}
      {report.remoteObservation.uncertain && <p><strong>What needs confirmation</strong> {report.remoteObservation.uncertain}</p>}
     </div>}
     {report?.metadataOnly && <p className="studio-observation-badge">Video details only. This video has not been analyzed.</p>}
     {!report && !analyzer.busy ? <ProductState title="Make your next edit stronger" description="Get feedback on rhythm, transitions, pacing, visuals, storytelling and creative impact. Upload a video or paste a YouTube link to begin."/>
      : !report && analyzer.busy ? <div className="studio-result-skeleton" aria-busy="true" aria-label="Preparing edit feedback">
       <LoadingRing label="Reviewing your edit"/>
       {V7_IDS.map(id => <div className="studio-skeleton-row" key={id} aria-hidden="true"><span/><i/></div>)}
      </div>
      : <RatingReveal experimental={report?.experimental} localResult={analyzer.enabled && progress.status !== 'IDLE'}
      inputIdentity={media?.url} settled={V7_IDS.map(id => !!progress.sections[id])}
      processing={analyzer.busy} analysisComplete={!analyzer.busy && progress.status === 'COMPLETE'}
      onSeek={canSeek ? seek : undefined} evidenceWatchUrl={media?.type === 'youtube' ? media.url : undefined} receivedResultId={analyzer.liveJobId} ratings={report?.ratings}
      synthetic={report?.synthetic} developmentPreview={developerTools}/>}
     {report && <details className="studio-evidence-details">
      <summary>Evidence Details</summary>
      {report.remoteObservation && <p className="studio-note">AI processing by Google · {report.remoteObservation.model}. Observations and approximate timestamps are model-reported, and may be incomplete.</p>}
      {!!report.mediaNotes?.length && <ul className="studio-media-notes">{report.mediaNotes.map((note, i) => <li key={i}>{note}</li>)}</ul>}
      {report.evidence.map((item, i) => <Finding key={i} item={item}/>)}
     </details>}
    </Panel>
   </section>

   {media && <CompactSection title="Preview & timeline" className="studio-preview" id="studio-preview" open={previewOpen} onToggle={setPreviewOpen}>
    <Panel title="Preview" icon={<Film size={15} aria-hidden="true"/>}>
     <div className={`studio-monitor ${media ? 'loaded' : ''} ${audioOnly(media) ? 'is-audio' : ''} ${media?.type === 'youtube' ? 'is-youtube' : ''}`}>
      {!media ? <div className="studio-empty"><div className="studio-crosshair"><Play size={26}/></div><h3>Media preview</h3><p>Choose a file or paste a YouTube link above.</p></div>
       : media.type === 'youtube' ? <YouTubePlayer ref={youtubePlayer} key={media.id} videoId={media.id} title={title} autoPlay={false} controls
        iframeReferrerPolicy="strict-origin-when-cross-origin" onReady={() => setYoutubeReady(true)} onError={code => {setYoutubeReady(false);setEmbedIssue(youtubePlaybackIssue(code));}}
        onPlay={() => setEmbedIssue('')}/>
       : !media.url ? <p className="studio-preview-error">Your analysis has been restored. Choose the original file again if you want to preview it; the report remains available.</p>
       : preview.error ? <p className="studio-preview-error">{preview.error}</p>
       : audioOnly(media) ? <audio key={media.url} ref={element => {player.current = element;}} src={media.url} controls preload="metadata"
        onLoadedMetadata={event => setPreviewDuration(event.currentTarget)} onTimeUpdate={event => setTime(event.currentTarget.currentTime)}
        onError={() => setPreview(old => ({...old, error: 'Preview is unavailable for this format. You can still analyze the file.'}))}/>
       : <video key={media.url} ref={element => {player.current = element;}} src={media.url} controls preload="metadata" playsInline
        onLoadedMetadata={event => setPreviewDuration(event.currentTarget)} onTimeUpdate={event => setTime(event.currentTarget.currentTime)}
        onError={() => setPreview(old => ({...old, error: 'Preview is unavailable for this format. You can still analyze the file.'}))}/>}
     </div>
     <div className="studio-media-caption"><strong>{title || 'No media selected'}</strong><span>{duration ? clock(duration) : '—'} / {dimensions}</span></div>
    </Panel>
    {report && <Timeline media={media} duration={duration} time={time} report={markerReport} seek={seek}/>}
   </CompactSection>}

   <CompactSection title="Reports & privacy" className="studio-inspector">
    <Panel title="Reports & privacy" icon={<SlidersHorizontal size={15} aria-hidden="true"/>}>
     {media && <h3>{title}</h3>}
     {media && <dl>
      <div><dt>Source</dt><dd>{media?.type === 'youtube' ? 'YouTube' : media ? 'Uploaded file' : '—'}</dd></div>
      <div><dt>Duration</dt><dd>{duration ? clock(duration) : '—'}</dd></div>
      <div><dt>Format</dt><dd>{dimensions}</dd></div>
     </dl>}
     <button disabled={sourceLocked || loading} onClick={() => json.current?.click()}>{loading ? 'Reading report…' : 'Import analysis report'}</button>
     {analyzer.staged && !analyzer.busy && <button disabled={analyzer.cleaning} onClick={() => void deleteTemporary()}>Delete temporary media</button>}
     {analyzer.reports && !analyzer.busy && <button disabled={analyzer.cleaning} onClick={() => void analyzer.deleteReport()}>Delete saved report</button>}
     <p className="studio-note">{analyzer.cloud ? 'Upload access expires after one hour and report access after 24 hours. Expired stored files are swept every 15 minutes, with a one-day storage lifecycle backup. Export a report to keep it, or delete it sooner here.' : 'Temporary uploads are removed after one hour when no analysis is running. Delete them sooner here. Reports remain until you delete them.'}</p>
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

  {privacyScope && <Dialog title={privacyScope === 'manage' ? 'Analysis privacy' : privacyScope === 'youtube' ? 'Analyze this public video?' : 'Choose how to analyze your edit'}
   onClose={closePrivacy}>
   <div className="studio-privacy-dialog">
    <p>{privacyScope === 'youtube' ? 'Google will process this public YouTube link and its available video and audio to generate AI feedback.'
     : 'With your permission, an analysis copy of your video and audio is processed by Google to generate AI feedback.'}</p>
    <p>Google’s data use depends on the service configuration. <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noopener noreferrer">Read Google’s processing terms</a> and <a href="/?view=help#privacy">Lolixco privacy information</a>.</p>
    {privacyScope === 'manage' ? <>
     <label>Uploaded files<select value={privacy.files} onChange={event => {const choice = event.target.value as ProcessingChoice; setPrivacy(previous => ({...previous, files: choice})); saveAnalysisPrivacy({...readAnalysisPrivacy(), files: choice});}}>
      <option value="ask">Ask before AI processing</option><option value="allow">Allow Google AI feedback</option><option value="decline">Use signal analysis only</option>
     </select></label>
     <label>Public YouTube links<select value={privacy.youtube} onChange={event => {const choice = event.target.value as ProcessingChoice; setPrivacy(previous => ({...previous, youtube: choice})); saveAnalysisPrivacy({...readAnalysisPrivacy(), youtube: choice});}}>
      <option value="ask">Ask before AI processing</option><option value="allow">Allow Google AI feedback</option><option value="decline">Do not analyze with Google</option>
     </select></label>
     <p>Changes apply to future analyses on this browser. Withdrawing permission does not undo processing that already happened. You can delete uploaded copies and saved reports in Creator Studio.</p>
     <button className="studio-privacy-primary" onClick={closePrivacy}>Done</button>
    </> : <>
     <label className="studio-remember"><input type="checkbox" checked={rememberPrivacy} onChange={event => setRememberPrivacy(event.target.checked)}/>
      Remember this choice for future {privacyScope === 'files' ? 'uploaded edits' : 'public YouTube links'} on this browser</label>
     <div className="studio-privacy-actions">
      <button className="studio-privacy-primary" onClick={() => choosePrivacy(privacyScope, 'allow')}>Allow AI feedback</button>
      <button onClick={() => choosePrivacy(privacyScope, 'decline')}>{privacyScope === 'files' ? 'Use signal analysis' : 'Not now'}</button>
     </div>
     {privacyScope === 'files' && <p>Signal analysis uses technical measurements without sharing media with an AI provider. Storytelling and creative judgments may be unavailable.</p>}
    </>}
   </div>
  </Dialog>}
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
