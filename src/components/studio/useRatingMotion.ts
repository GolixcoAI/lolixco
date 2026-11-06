import { useLayoutEffect, useRef, useState } from 'react';
import { CHECKPOINT_MS, FINISH_MS, checkpointValue, easeOut, pickReaction, type Ratings } from './ratingModel';

type Step = { index: number; score: number | null; reaction: string };
type View = { index: number; reaction: string; phase: 'idle' | 'working' | 'checkpoint' | 'finish' | 'complete' };
const REST: View = { index: -1, reaction: '', phase: 'idle' };
const FINISH = 7;

function newRun(key: string) {
 return {
  key, skipped: false, scheduled: new Map<number, number | null>(), used: new Set<string>(),
  queue: [] as Step[], current: null as Step | null, started: 0, from: 0, needle: 0,
  workingSince: 0, workingFrom: 0,
 };
}

export function useRatingMotion({
 model, identity, animate, processing, finished, reduced, completionReaction,
}: {
 model: Ratings; identity: string; animate: boolean; processing: boolean;
 finished: boolean; reduced: boolean; completionReaction: string;
}) {
 const [view, setView] = useState<View>(REST);
 const viewRef = useRef(REST);
 const [replay, setReplay] = useState({ identity: '', count: 0 });
 const run = useRef(newRun(''));
 const frame = useRef(0);
 const needle = useRef<SVGPathElement>(null);
 const arc = useRef<SVGPathElement>(null);
 const bars = useRef<(HTMLDivElement | null)[]>([]);
 const replaying = replay.identity === identity;
 const key = identity + ':' + (replaying ? replay.count : 0);
 const overall = model.overall.score;

 function show(next: View) {
  const previous = viewRef.current;
  if (previous.phase === next.phase && previous.index === next.index && previous.reaction === next.reaction) return;
  viewRef.current = next;
  setView(next);
 }

 function paintNeedle(value: number) {
  run.current.needle = value;
  needle.current?.setAttribute('transform', 'rotate(' + (value * 18 - 180) + ' 150 152)');
  arc.current?.setAttribute('stroke-dasharray', value * 10 + ' 100');
  arc.current?.setAttribute('opacity', value > 0.05 ? '1' : '0');
 }

 function paintBar(index: number, value: number) {
  bars.current[index]?.style.setProperty('--rating-fill', String(value / 10));
 }

 function stop() {
  cancelAnimationFrame(frame.current);
  frame.current = 0;
 }

 function settle() {
  const active = run.current;
  active.queue = [];
  active.current = null;
  model.categories.forEach((item, index) => paintBar(index, item.score ?? 0));
  paintNeedle(overall ?? 0);
  show(finished ? {
   index: FINISH, reaction: overall === null ? completionReaction : 'FINAL VERDICT', phase: 'complete',
  } : processing ? { ...REST, phase: 'working' } : REST);
 }

 useLayoutEffect(() => stop, []);

 useLayoutEffect(() => {
  stop();
  if (run.current.key !== key) {
   const previousNeedle = viewRef.current.phase === 'working' && processing ? run.current.needle : 0;
   run.current = newRun(key);
   model.categories.forEach((_, index) => paintBar(index, 0));
   paintNeedle(previousNeedle);
   show(REST);
  }
  const active = run.current;
  if (reduced || active.skipped || !(animate || replaying) || (!processing && !finished)) {
   if (reduced && (processing || finished)) active.skipped = true;
   settle();
   return;
  }
  model.categories.forEach(({ score }, index) => {
   if (score === null) {
    if (active.scheduled.delete(index)) {
     active.queue = active.queue.filter(step => step.index !== index);
     if (active.current?.index === index) active.current = null;
    }
    return;
   }
   if (active.scheduled.get(index) === score) return;
   active.scheduled.set(index, score);
   const step = { index, score, reaction: pickReaction(score, active.used) };
   const pending = active.queue.findIndex(entry => entry.index === index);
   if (pending >= 0) active.queue[pending] = step;
   else active.queue.push(step);
  });
  if (finished && (!active.scheduled.has(FINISH) || active.scheduled.get(FINISH) !== overall)) {
   active.scheduled.set(FINISH, overall);
   active.queue.push({ index: FINISH, score: overall, reaction: overall === null ? completionReaction : 'FINAL VERDICT' });
  }

  function tick(now: number) {
   frame.current = 0;
   if (!active.current && active.queue.length) {
    active.current = active.queue.shift()!;
    active.started = now;
    active.workingSince = 0;
    active.from = active.needle;
    const isFinish = active.current.index === FINISH;
    show({ index: active.current.index, reaction: isFinish ? '' : active.current.reaction, phase: isFinish ? 'finish' : 'checkpoint' });
   }
   const step = active.current;
   if (step) {
    const elapsed = now - active.started;
    const isFinish = step.index === FINISH;
    const target = step.score ?? 0;
    const duration = isFinish ? FINISH_MS : CHECKPOINT_MS;
    if (isFinish) {
     const rise = FINISH_MS * 0.43;
     const peak = overall === null ? 8.4 : 10;
     paintNeedle(elapsed < rise
      ? active.from + (peak - active.from) * easeOut(elapsed / rise)
      : peak + (target - peak) * easeOut((elapsed - rise) / (duration - rise)));
    } else {
     paintNeedle(checkpointValue(active.from, target, elapsed));
     paintBar(step.index, checkpointValue(0, target, elapsed));
    }
    if (elapsed >= duration) {
     active.current = null;
     if (isFinish) show({ index: FINISH, reaction: step.reaction, phase: 'complete' });
    }
   } else if (processing) {
    if (!active.workingSince) {
     active.workingSince = now;
     active.workingFrom = active.needle;
    }
    const t = now - active.workingSince;
    const pulse = 3.65 + 2.95 * Math.sin(t / 520) + 0.16 * Math.sin(t / 47);
    paintNeedle(active.workingFrom + (pulse - active.workingFrom) * easeOut(t / 520));
    show({ ...REST, phase: 'working' });
   }
   if (active.current || active.queue.length || processing) frame.current = requestAnimationFrame(tick);
  }
  if (active.current || active.queue.length || processing) frame.current = requestAnimationFrame(tick);
  return stop;
 });

 function skip() {
  run.current.skipped = true;
  stop();
  settle();
 }

 return {
  view, needle, arc, bars, skip,
  canSkip: !reduced && !run.current.skipped && (processing || view.phase === 'checkpoint' || view.phase === 'finish'),
  replay: () => setReplay(value => ({ identity, count: value.identity === identity ? value.count + 1 : 1 })),
 };
}
