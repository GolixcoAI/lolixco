import {useEffect, useRef, useState} from 'react';
import type {AnalysisEvent} from './analysisProgress';
import {phase9Presentation, phase9Section, record} from './presentationV7';
import {ANALYZER_ENABLED, analyzerApiPath, developerAnalyzerToolsEnabled} from '../../config/analyzerEndpoint';
import {analysisFailure, connectionFailure} from './analysisMessages';

class LocalRequestError extends Error {
 constructor(message: string, readonly status: number, readonly code?: string) {
  super(message);
 }
}

export type ProviderStatus = 'connected' | 'not_configured' | 'configured_disabled' | 'connecting' | 'authentication_failed' | 'quota_exceeded' | 'model_unavailable' | 'request_unsupported' | 'video_unavailable' | 'rate_limited' | 'unsupported' | 'temporarily_unavailable';
type Provider = {status: ProviderStatus; message: string; model?: string};
type StagedMedia = {id: string; name: string; audio_only: boolean};
type Source = {type: 'file'; file: File} | {type: 'staged'; id: string} | {type: 'sample'; filename: string} | {type: 'youtube'; id: string};
type JobEvent = {event_type: string; payload: Record<string, unknown>; section_id?: string};
type Snapshot = {
 staged_media?: StagedMedia;
 youtube_video_id?: string;
 quality_mode?: 'phase8' | 'phase9';
 job_id: string;
 media_filename: string;
 status: string;
 current_stage: string;
 progress_percent: number;
 result_status?: 'partial' | 'complete';
 error?: string;
 error_code?: string;
 events: JobEvent[];
};
type Health = {
 version: string;
 media_limits?: typeof DEFAULT_MEDIA_LIMITS;
 provider?: Provider;
};
type Reports = {v6: unknown; presentation: unknown};

export const DEFAULT_MEDIA_LIMITS = {
 max_bytes: 100 * 1024 * 1024,
 max_seconds: 120,
 max_dimension: 8192,
 max_pixels: 8192 * 4320,
 max_fps: 240,
 extensions: ['.mp4', '.mov', '.m4v', '.mkv', '.webm', '.mp3', '.wav', '.flac', '.ogg', '.opus', '.m4a', '.aac'],
};

const unavailable: Provider = {
 status: 'temporarily_unavailable',
 message: 'AI feedback is temporarily unavailable.',
};
const unconfigured: Provider = {
 status: 'not_configured',
 message: 'AI feedback is unavailable right now.',
};
const terminalStatuses = ['COMPLETE', 'FAILED', 'CANCELLED'];
const visibleEvents = ['QUEUED', 'RUNNING', 'SECTION_COMPLETED', 'SECTION_UNASSESSED'];
const reportModes = {quality_mode: 'phase9'};

function providerFailure(code?: string, message?: string): Provider | undefined {
 if (!message) return undefined;
 if (code && ['not_configured','configured_disabled','authentication_failed','quota_exceeded','model_unavailable','request_unsupported','rate_limited','unsupported','temporarily_unavailable'].includes(code)) {
  return {status: code as ProviderStatus, message};
 }
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
 const controller = new AbortController();
 const abort = () => controller.abort();
 options?.signal?.addEventListener('abort', abort, {once: true});
 if (options?.signal?.aborted) controller.abort();
 const timer = setTimeout(abort, path === 'media' ? 150_000 : 20_000);
 try {
  const response = await fetch(analyzerApiPath(path), {
   ...options, signal: controller.signal,
   headers: {'Content-Type': 'application/json', ...options?.headers}, cache: 'no-store',
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
   const detail = body?.detail;
   const diagnostic = typeof detail === 'string' ? detail : detail?.message;
   const code = body?.error_code ?? detail?.code;
   throw new LocalRequestError(analysisFailure(code, typeof diagnostic === 'string' ? diagnostic : '', response.status, path), response.status, code);
  }
  if (body === null) throw new LocalRequestError('Analysis returned an incomplete response. Please try again.', 502);
  return body;
 } catch (failure) {
  if (failure instanceof LocalRequestError || options?.signal?.aborted) throw failure;
  throw new LocalRequestError(controller.signal.aborted ? analysisFailure('timeout') : connectionFailure(), controller.signal.aborted ? 408 : 0);
 } finally {
  clearTimeout(timer);
  options?.signal?.removeEventListener('abort', abort);
 }
}

function setJobLocation(job: string) {
 const url = new URL(location.href);
 if (job) url.searchParams.set('analysisJob', job);
 else url.searchParams.delete('analysisJob');
 history.replaceState(history.state, '', url);
}

async function removeMedia(id: string) {
 await api(`media/${id}`, {method: 'DELETE'}).catch(error => {
  if (!(error instanceof LocalRequestError && error.status === 404)) throw error;
 });
}

async function requestCancel(job: string) {
 await api(`jobs/${job}/cancel`, {
  method: 'POST',
  body: JSON.stringify({reason: 'Cancelled from Creator Studio'}),
 });
}

async function inspectYoutube(videoId: string, signal: AbortSignal) {
 return api<unknown>('youtube/reference', {
  method: 'POST',
  body: JSON.stringify({video_id: videoId}),
  signal,
 });
}

export function useLocalAnalyzer() {
 const enabled = ANALYZER_ENABLED;
 const [ready, setReady] = useState(false);
 const [checking, setChecking] = useState(enabled);
 const [connectionLost, setConnectionLost] = useState(false);
 const [pollRevision, setPollRevision] = useState(0);
 const [provider, setProvider] = useState(unavailable);
 const [mediaLimits, setMediaLimits] = useState(DEFAULT_MEDIA_LIMITS);
 const [files, setFiles] = useState<{filename: string; size_bytes: number}[]>([]);
 const [events, setEvents] = useState<AnalysisEvent[]>([]);
 const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
 const [reports, setReports] = useState<Reports | null>(null);
 const [error, setError] = useState('');
 const [job, setJob] = useState(() => {
  const id = new URLSearchParams(location.search).get('analysisJob') || '';
  return enabled && /^job_\d+_[a-f0-9]{6}$/.test(id) ? id : '';
 });
 const [starting, setStarting] = useState(false);
 const [uploading, setUploading] = useState(false);
 const [cancelling, setCancelling] = useState(false);
 const [cleaning, setCleaning] = useState(false);
 const [startCancelled, setStartCancelled] = useState(false);
 const [staged, setStaged] = useState<StagedMedia | null>(null);
 const active = useRef(job);
 const startedHere = useRef(false);
 const stageFile = useRef<File | null>(null);
 const pending = useRef(false);
 const cleanupPending = useRef(false);
 const cancelPending = useRef(false);
 const generation = useRef(0);
 const healthGeneration = useRef(0);
 const uploadController = useRef<AbortController | null>(null);
 const mounted = useRef(true);
 const lifecycle = useRef(0);

 async function refresh() {
  if (!enabled) return;
  const token = ++healthGeneration.current;
  setChecking(true);
  setProvider({status:'connecting',message:'Checking analysis availability.'});
  try {
   const health = await api<Health>('health');
   if (health.version !== '8.0.0') throw Error('Analysis is temporarily unavailable.');
   if (healthGeneration.current !== token) return;
   setReady(true);
   setProvider(health.provider ?? unconfigured);
   setMediaLimits(health.media_limits ?? DEFAULT_MEDIA_LIMITS);
   const samples = developerAnalyzerToolsEnabled() ? await api<{files: typeof files}>('inbox').catch(() => ({files: []})) : {files: []};
   if (healthGeneration.current === token) setFiles(samples.files);
  } catch {
   if (healthGeneration.current !== token) return;
   setReady(false);
   setProvider(unavailable);
   setFiles([]);
  } finally {
   if (healthGeneration.current === token) setChecking(false);
  }
 }

 useEffect(() => {
  mounted.current = true;
  void refresh();
  return () => {
   mounted.current = false;
   lifecycle.current++;
   healthGeneration.current++;
   if (pending.current) cancelPending.current = true;
   uploadController.current?.abort();
  };
 }, [enabled]);

 useEffect(() => {
  if (!job) return;
  let alive = true;
  let timer: ReturnType<typeof setTimeout>;
  let inflight = false;
  let cursor = 0;
  let failures = 0;
  const token = generation.current;
  const controller = new AbortController();
  const options = {signal: controller.signal};
  const stream = new EventSource(analyzerApiPath('jobs/' + job + '/events'));
  const current = () => alive && generation.current === token;
  const update = async () => {
   if (inflight || !current() || active.current !== job) return;
   inflight = true;
   try {
    const result = await api<Snapshot>('jobs/' + job, options);
    if (!current()) return;
    const safeError = result.error ? analysisFailure(result.error_code, result.error) : undefined;
    setSnapshot({...result, error: safeError});
    const next: AnalysisEvent[] = [];
    const localPhase9 = result.quality_mode === 'phase9' && !result.youtube_video_id;
    for (const event of result.events.slice(cursor)) {
     if (!visibleEvents.includes(event.event_type) || event.section_id === 'personalized_owner_fit') continue;
     next.push({
      job_id: job,
      type: event.event_type as AnalysisEvent['type'],
      section: localPhase9 && event.section_id && !('method_version' in event.payload && String(event.payload.method_version).startsWith('gemini_')) ? phase9Section(event.payload) : event.payload,
     });
    }
    cursor = result.events.length;
    if (next.length) setEvents(old => [...old, ...next]);
    if (!terminalStatuses.includes(result.status)) {
     failures = 0;
     setConnectionLost(false);
     setError('');
     return;
    }
    if (result.status === 'COMPLETE') {
     const [v6, presentation] = await Promise.all([
      api(`jobs/${job}/report/v6`, options),
      api(`jobs/${job}/report/presentation`, options),
     ]);
     if (!current()) return;
     setReports({v6, presentation});
     const semanticStatus = record(record(record(presentation).context_evidence).semantic_provider_status);
     const semanticFailure = providerFailure(
      typeof semanticStatus.status === 'string' ? semanticStatus.status : undefined,
      typeof semanticStatus.message === 'string' ? semanticStatus.message : undefined,
     );
     if (semanticFailure) setProvider(semanticFailure);
     else if (semanticStatus.status === 'connected') setProvider(previous => ({
      ...previous, status: 'connected',
      message: typeof semanticStatus.message === 'string' ? semanticStatus.message : 'Gemini audiovisual review completed.',
     }));
     const liveSections = result.events.filter(event => event.event_type === 'SECTION_COMPLETED').map(event => event.payload);
     const currentSchema = presentation && typeof presentation === 'object' && 'schema_version' in presentation && presentation.schema_version === '8.0.0-presentation';
     const report = localPhase9 && !currentSchema ? phase9Presentation(presentation, v6, liveSections) : presentation;
     setEvents(old => [...old, {job_id: job, type: 'COMPLETE', report}]);
    } else {
     const type = result.status as 'FAILED' | 'CANCELLED';
     setEvents(old => [...old, {job_id: job, type, message: safeError || (type === 'CANCELLED' ? 'Analysis cancelled. You can analyze this edit again.' : "We couldn't finish this analysis. Please try again.")}]);
     const failure = result.youtube_video_id ? providerFailure(result.error_code, safeError) : undefined;
     if (failure) setProvider(failure);
    }
    active.current = '';
    failures = 0;
    setConnectionLost(false);
    cancelPending.current = false;
    setCancelling(false);
    setError('');
    stream.close();
   } catch (failure) {
    if (!current()) return;
    failures++;
    setError(failure instanceof Error ? failure.message : connectionFailure());
    if (failures >= 3) {setConnectionLost(true); stream.close();}
    if (failure instanceof LocalRequestError && [403, 404, 410].includes(failure.status)) {
     active.current = '';
     cancelPending.current = false;
     setCancelling(false);
     setJob('');
     setSnapshot(null);
     setEvents([]);
     setReports(null);
     setJobLocation('');
     stream.close();
    }
   } finally {
    inflight = false;
   }
  };
  const poll = async () => {
   await update();
   if (current() && active.current === job && failures < 3) timer = setTimeout(poll, failures ? 1500 : 900);
  };
  stream.onmessage = () => {void update();};
  stream.onerror = () => stream.close();
  void poll();
  return () => {
   alive = false;
   controller.abort();
   clearTimeout(timer);
   stream.close();
  };
 }, [job, pollRevision]);

 function resetResult() {
  generation.current++;
  startedHere.current = false;
  setJob('');
  setSnapshot(null);
  setEvents([]);
  setReports(null);
  setError('');
  setStartCancelled(false);
  setConnectionLost(false);
  setJobLocation('');
 }

 async function start(source: Source, semanticConsent = false) {
  if (!ready || pending.current || active.current || cleanupPending.current || (source.type === 'youtube' || semanticConsent) && provider.status !== 'connected') return;
  pending.current = true;
  const lifetime = lifecycle.current;
  const current = () => mounted.current && lifetime === lifecycle.current;
  cancelPending.current = false;
  resetResult();
  setStarting(true);
  let input = staged || snapshot?.staged_media;
  if (source.type === 'staged' || source.type === 'sample') setStaged(input ?? null);
  try {
   if (source.type === 'file' && stageFile.current !== source.file) {
    setUploading(true);
    uploadController.current = new AbortController();
    try {
     const uploaded = await api<{id: string; name: string; video: unknown}>('media', {
      method: 'POST',
      body: source.file,
      headers: {'Content-Type': 'application/octet-stream', 'X-Media-Name': encodeURIComponent(source.file.name)},
      signal: uploadController.current.signal,
     });
     input = {id: uploaded.id, name: uploaded.name, audio_only: !uploaded.video};
     if (!current()) {await removeMedia(input.id).catch(() => {}); return;}
     stageFile.current = source.file;
     setStaged(input);
    } finally {
     setUploading(false);
     uploadController.current = null;
    }
   }
   if (cancelPending.current || !current()) {
    if (source.type === 'file' && input) {
     await removeMedia(input.id);
     setStaged(null);
     stageFile.current = null;
    }
    if (current()) setStartCancelled(true);
    return;
   }

   const localModes = {...reportModes, semantic_consent: semanticConsent};
   const sample = source.type === 'sample' ? {inbox_filename: source.filename, ...localModes} : undefined;
   const reusable = source.type === 'file' || source.type === 'sample' && input?.name === source.filename;
   const mediaId = source.type === 'staged' ? source.id : reusable ? input?.id : undefined;
   const path = source.type === 'youtube' ? 'youtube/start' : mediaId ? `media/${mediaId}/start` : 'jobs/start';
   const payload = source.type === 'youtube' ? {video_id: source.id, consent: true} : mediaId ? localModes : sample;
   const result = await api<{job_id: string}>(path, {method: 'POST', body: JSON.stringify(payload)}).catch(failure => {
    if (!sample || !mediaId || !(failure instanceof LocalRequestError) || failure.status !== 404) throw failure;
    setStaged(null);
    if (cancelPending.current) return null;
    return api<{job_id: string}>('jobs/start', {method: 'POST', body: JSON.stringify(sample)});
   });
   if (!result) {
    if (current()) setStartCancelled(true);
    return;
   }
   if (!current()) {
    // A start accepted after navigation was never acknowledged by this view.
    await requestCancel(result.job_id).catch(() => {});
    return;
   }
   startedHere.current = true;
   active.current = result.job_id;
   setJob(result.job_id);
   setJobLocation(result.job_id);
   if (cancelPending.current) await requestCancel(result.job_id);
  } catch (failure) {
   if (!current()) return;
   if (cancelPending.current && !active.current) {
    setError('');
    setStartCancelled(true);
   } else if (source.type === 'file' && failure instanceof LocalRequestError && failure.status === 404) {
    stageFile.current = null;
    setStaged(null);
    setError('This temporary copy expired. Select Analyze Edit to upload the file again.');
   } else {
    setError(failure instanceof Error ? failure.message : 'Unable to start analysis.');
   }
   if ((source.type === 'youtube' || semanticConsent) && failure instanceof LocalRequestError) {
    const state = providerFailure(failure.code, failure.message);
    if (state) setProvider(state);
   }
   if (cancelPending.current) {
    cancelPending.current = false;
    setCancelling(false);
    if (!active.current) setStartCancelled(true);
   }
  } finally {
   pending.current = false;
   if (current()) setStarting(false);
   if (!active.current && current()) {
    cancelPending.current = false;
    setCancelling(false);
   }
  }
 }

 async function deleteStaged() {
  const input = staged || snapshot?.staged_media;
  if (!input || pending.current || active.current || cleanupPending.current) return false;
  cleanupPending.current = true;
  setCleaning(true);
  try {
   await removeMedia(input.id);
   stageFile.current = null;
   setStaged(null);
   setSnapshot(old => old ? {...old, staged_media: undefined} : old);
   setError('');
   return true;
  } catch (failure) {
   setError(failure instanceof Error ? failure.message : 'Unable to delete temporary media.');
   return false;
  } finally {
   cleanupPending.current = false;
   setCleaning(false);
  }
 }

 async function cancel() {
  if ((!active.current && !pending.current) || cancelPending.current) return;
  cancelPending.current = true;
  setCancelling(true);
  if (!active.current) {uploadController.current?.abort(); return;}
  try {
   await requestCancel(active.current);
   if (connectionLost) {setConnectionLost(false); setPollRevision(value => value + 1);}
  } catch (failure) {
   setError(failure instanceof Error ? failure.message : 'Cancellation failed.');
   cancelPending.current = false;
   setCancelling(false);
  }
 }

 function clear() {
  if (pending.current || active.current || cleanupPending.current) return false;
  const input = staged || snapshot?.staged_media;
  if (input) void removeMedia(input.id).catch(() => {});
  stageFile.current = null;
  setStaged(null);
  resetResult();
  return true;
 }

 function dismissResult() {
  if (pending.current || active.current || cleanupPending.current) return false;
  setStaged(staged || snapshot?.staged_media || null);
  resetResult();
  return true;
 }

 async function deleteReport() {
  if (pending.current || active.current || cleanupPending.current || !job) return false;
  cleanupPending.current = true;
  setCleaning(true);
  try {
   await api(`jobs/${job}`, {method: 'DELETE'});
   setStaged(staged || snapshot?.staged_media || null);
   resetResult();
   return true;
  } catch (failure) {
   setError(failure instanceof Error ? failure.message : 'Unable to delete the analysis report.');
   return false;
  } finally {
   cleanupPending.current = false;
   setCleaning(false);
  }
 }

 const busy = starting || !!active.current;
 function retryConnection() {
  setConnectionLost(false);
  setError('');
  if (active.current) setPollRevision(value => value + 1);
  else void refresh();
 }
 return {
  busy, cancel, cancelling, checking, cleaning, clear, connectionLost, deleteReport, deleteStaged, dismissResult, enabled, error, events, files,
  inspectYoutube, liveJobId: startedHere.current ? job : undefined, mediaLimits, provider,
  ready, refresh, reports, retryConnection, snapshot, staged: staged || snapshot?.staged_media, start, startCancelled, uploading,
 };
}
