import {useEffect, useRef, useState} from 'react';
import type {AnalysisEvent} from './analysisProgress';
import {phase9Presentation, phase9Section} from './presentationV7';

class LocalRequestError extends Error {
 constructor(message: string, readonly status: number, readonly code?: string) {
  super(message);
 }
}

type ProviderStatus = 'connected' | 'not_configured' | 'rate_limited' | 'unsupported' | 'temporarily_unavailable';
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
 max_dimension: 1920,
 max_pixels: 1920 * 1080,
 max_fps: 60,
 extensions: ['.mp4', '.mov', '.m4v', '.mkv', '.webm', '.mp3', '.wav', '.flac', '.ogg', '.opus', '.m4a', '.aac'],
};

const unavailable: Provider = {
 status: 'temporarily_unavailable',
 message: 'Connect to the local analyzer to check Gemini availability.',
};
const unconfigured: Provider = {
 status: 'not_configured',
 message: 'Set GEMINI_API_KEY and enable public YouTube analysis on the local analyzer, then restart it.',
};
const terminalStatuses = ['COMPLETE', 'FAILED', 'CANCELLED'];
const visibleEvents = ['QUEUED', 'RUNNING', 'SECTION_COMPLETED', 'SECTION_UNASSESSED'];
const reportModes = {quality_mode: 'phase9'};

function providerFailure(code?: string, message?: string): Provider | undefined {
 if (!message) return undefined;
 if (code === 'not_configured' || code === 'rate_limited' || code === 'unsupported' || code === 'temporarily_unavailable') {
  return {status: code, message};
 }
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
 const response = await fetch('/api/v8/' + path, {
  ...options,
  headers: {'Content-Type': 'application/json', ...options?.headers},
  cache: 'no-store',
 });
 const body = await response.json().catch(() => null);
 if (!response.ok) {
  const detail = body?.detail;
  const message = typeof detail === 'string' ? detail : detail?.message;
  throw new LocalRequestError(message || `Local service returned ${response.status}.`, response.status, body?.error_code ?? detail?.code);
 }
 if (body === null) throw Error('The local analyzer returned an unreadable response.');
 return body;
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
 const enabled = import.meta.env.DEV && location.hostname === '127.0.0.1';
 const [ready, setReady] = useState(false);
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

 async function refresh() {
  if (!enabled) return;
  const token = ++healthGeneration.current;
  try {
   const health = await api<Health>('health');
   if (health.version !== '8.0.0') throw Error('Expected local analyzer v8.0.0.');
   if (healthGeneration.current !== token) return;
   setReady(true);
   setProvider(health.provider ?? unconfigured);
   setMediaLimits(health.media_limits ?? DEFAULT_MEDIA_LIMITS);
   const samples = await api<{files: typeof files}>('inbox').catch(() => ({files: []}));
   if (healthGeneration.current === token) setFiles(samples.files);
  } catch {
   if (healthGeneration.current !== token) return;
   setReady(false);
   setProvider(unavailable);
   setFiles([]);
  }
 }

 useEffect(() => {
  void refresh();
  return () => {healthGeneration.current++;};
 }, [enabled]);

 useEffect(() => {
  if (!job) return;
  let alive = true;
  let timer: ReturnType<typeof setTimeout>;
  let inflight = false;
  let cursor = 0;
  const token = generation.current;
  const controller = new AbortController();
  const options = {signal: controller.signal};
  const stream = new EventSource('/api/v8/jobs/' + job + '/events');
  const current = () => alive && generation.current === token;
  const update = async () => {
   if (inflight || !current() || active.current !== job) return;
   inflight = true;
   try {
    const result = await api<Snapshot>('jobs/' + job, options);
    if (!current()) return;
    setSnapshot(result);
    const next: AnalysisEvent[] = [];
    const localPhase9 = result.quality_mode === 'phase9' && !result.youtube_video_id;
    for (const event of result.events.slice(cursor)) {
     if (!visibleEvents.includes(event.event_type)) continue;
     next.push({
      job_id: job,
      type: event.event_type as AnalysisEvent['type'],
      section: localPhase9 && event.section_id ? phase9Section(event.payload) : event.payload,
     });
    }
    cursor = result.events.length;
    if (next.length) setEvents(old => [...old, ...next]);
    if (!terminalStatuses.includes(result.status)) return;
    if (result.status === 'COMPLETE') {
     const [v6, presentation] = await Promise.all([
      api(`jobs/${job}/report/v6`, options),
      api(`jobs/${job}/report/presentation`, options),
     ]);
     if (!current()) return;
     setReports({v6, presentation});
     const liveSections = result.events.filter(event => event.event_type === 'SECTION_COMPLETED').map(event => event.payload);
     const report = localPhase9 ? phase9Presentation(presentation, v6, liveSections) : presentation;
     setEvents(old => [...old, {job_id: job, type: 'COMPLETE', report}]);
    } else {
     const type = result.status as 'FAILED' | 'CANCELLED';
     setEvents(old => [...old, {job_id: job, type, message: result.error || result.current_stage}]);
     const failure = result.youtube_video_id ? providerFailure(result.error_code, result.error) : undefined;
     if (failure) setProvider(failure);
    }
    active.current = '';
    cancelPending.current = false;
    setCancelling(false);
    setError('');
    stream.close();
   } catch (failure) {
    if (!current()) return;
    setError(failure instanceof Error ? failure.message : 'Could not read analysis status.');
    if (failure instanceof LocalRequestError && [403, 404, 410].includes(failure.status)) {
     active.current = '';
     cancelPending.current = false;
     setCancelling(false);
     setJob('');
     setJobLocation('');
     stream.close();
    }
   } finally {
    inflight = false;
   }
  };
  const poll = async () => {
   await update();
   if (current() && active.current === job) timer = setTimeout(poll, 900);
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
 }, [job]);

 function resetResult() {
  generation.current++;
  startedHere.current = false;
  setJob('');
  setSnapshot(null);
  setEvents([]);
  setReports(null);
  setError('');
  setStartCancelled(false);
  setJobLocation('');
 }

 async function start(source: Source) {
  if (!ready || pending.current || active.current || cleanupPending.current || source.type === 'youtube' && provider.status !== 'connected') return;
  pending.current = true;
  cancelPending.current = false;
  resetResult();
  setStarting(true);
  let input = staged || snapshot?.staged_media;
  if (source.type === 'staged' || source.type === 'sample') setStaged(input ?? null);
  try {
   if (source.type === 'file' && stageFile.current !== source.file) {
    setUploading(true);
    try {
     const uploaded = await api<{id: string; name: string; video: unknown}>('media', {
      method: 'POST',
      body: source.file,
      headers: {'Content-Type': 'application/octet-stream', 'X-Media-Name': encodeURIComponent(source.file.name)},
     });
     input = {id: uploaded.id, name: uploaded.name, audio_only: !uploaded.video};
     stageFile.current = source.file;
     setStaged(input);
    } finally {
     setUploading(false);
    }
   }
   if (cancelPending.current) {
    if (source.type === 'file' && input) {
     await removeMedia(input.id);
     setStaged(null);
     stageFile.current = null;
    }
    setStartCancelled(true);
    return;
   }

   const sample = source.type === 'sample' ? {inbox_filename: source.filename, ...reportModes} : undefined;
   const reusable = source.type === 'file' || source.type === 'sample' && input?.name === source.filename;
   const mediaId = source.type === 'staged' ? source.id : reusable ? input?.id : undefined;
   const path = source.type === 'youtube' ? 'youtube/start' : mediaId ? `media/${mediaId}/start` : 'jobs/start';
   const payload = source.type === 'youtube' ? {video_id: source.id, consent: true} : mediaId ? reportModes : sample;
   const result = await api<{job_id: string}>(path, {method: 'POST', body: JSON.stringify(payload)}).catch(failure => {
    if (!sample || !mediaId || !(failure instanceof LocalRequestError) || failure.status !== 404) throw failure;
    setStaged(null);
    if (cancelPending.current) return null;
    return api<{job_id: string}>('jobs/start', {method: 'POST', body: JSON.stringify(sample)});
   });
   if (!result) {
    setStartCancelled(true);
    return;
   }
   startedHere.current = true;
   active.current = result.job_id;
   setJob(result.job_id);
   setJobLocation(result.job_id);
   if (cancelPending.current) await requestCancel(result.job_id);
  } catch (failure) {
   if (source.type === 'file' && failure instanceof LocalRequestError && failure.status === 404) {
    stageFile.current = null;
    setStaged(null);
    setError('The temporary copy expired. Press Start AI Analysis to stage the selected file again.');
   } else {
    setError(failure instanceof Error ? failure.message : 'Unable to start analysis.');
   }
   if (source.type === 'youtube' && failure instanceof LocalRequestError) {
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
   setStarting(false);
   if (!active.current) {
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
  if (!active.current) return;
  try {
   await requestCancel(active.current);
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
 return {
  busy, cancel, cancelling, cleaning, clear, deleteReport, deleteStaged, dismissResult, enabled, error, events, files,
  inspectYoutube, liveJobId: startedHere.current ? job : undefined, mediaLimits, provider,
  ready, refresh, reports, snapshot, staged: staged || snapshot?.staged_media, start, startCancelled, uploading,
 };
}
