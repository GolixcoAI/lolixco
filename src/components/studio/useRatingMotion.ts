import { useLayoutEffect, useRef, useState } from 'react';
import { CHECKPOINT_MS, FINISH_MS, checkpointValue, easeOut, sampleReactions, scoreAtCheckpoint, CATEGORY_LABELS, type Ratings } from './ratingModel';

type Step = { index: number; score: number | null; reaction: string };
type View = {
 index: number; reaction: string; scored: boolean;
 phase: 'idle' | 'working' | 'checkpoint' | 'finish' | 'complete';
};
type MotionInputs = {
 model: Ratings; identity: string; animate: boolean; processing: boolean;
 finished: boolean; reduced: boolean; completionReaction: string; settled?: readonly boolean[];
};
const REST: View = { index: -1, reaction: '', scored: false, phase: 'idle' };
const FINISH = CATEGORY_LABELS.length;

function newRun(key: string) {
 return {
  key, skipped: false, scheduled: new Map<number, number | null>(), reactionsShown: new Set<number>(),
  queue: [] as Step[], current: null as Step | null, started: 0, from: 0, fromScore: 0, needle: 0,
  scoreValues: Array<number>(CATEGORY_LABELS.length).fill(0), workingSince: 0, workingFrom: 0,
 };
}

export function useRatingMotion(inputs: MotionInputs) {
 const { model, identity, animate, processing, finished, reduced, completionReaction, settled } = inputs;
 const [view, setView] = useState<View>(REST);
 const viewRef = useRef(REST);
 const [replay, setReplay] = useState({ identity: '', count: 0 });
 const session = useRef({ identity: '', reactions: null as string[] | null });
 const run = useRef(newRun(''));
 const latest = useRef(inputs);
 const frame = useRef(0);
 const needle = useRef<SVGPathElement>(null);
 const arc = useRef<SVGPathElement>(null);
 const bars = useRef<(HTMLDivElement | null)[]>([]);
 const scores = useRef<(HTMLSpanElement | null)[]>([]);
 const replaying = replay.identity === identity;
 const key = identity + ':' + (replaying ? replay.count : 0);
 const signature = JSON.stringify(model.categories.map(item => item.score));
 const settledSignature = JSON.stringify(settled);

 function show(next: View) {
  const previous = viewRef.current;
  if (previous.phase === next.phase && previous.index === next.index
   && previous.reaction === next.reaction && previous.scored === next.scored) return;
  viewRef.current = next;
  setView(next);
 }

 function paintNeedle(value: number) {
  run.current.needle = value;
  needle.current?.setAttribute('transform', `rotate(${value * 18 - 180} 150 152)`);
  arc.current?.setAttribute('stroke-dasharray', `${value * 10} 100`);
  arc.current?.setAttribute('opacity', value > 0.05 ? '1' : '0');
 }

 function paintScore(index: number, value: number, complete = false) {
  const hundredths = Math.round(Math.max(0, Math.min(10, value)) * 100);
  const displayed = hundredths / 100;
  run.current.scoreValues[index] = displayed;
  const bar = bars.current[index];
  if (bar) {
   bar.style.setProperty('--rating-fill', (hundredths / 1000).toFixed(3));
   bar.dataset.scoreValue = displayed.toFixed(2);
   bar.dataset.settled = String(complete);
  }
  const label = scores.current[index];
  if (label) label.textContent = `${displayed.toFixed(2)}/10`;
 }

 function stop() {
  cancelAnimationFrame(frame.current);
  frame.current = 0;
 }

 function settle() {
  const active = run.current;
  const current = latest.current;
  active.queue = [];
  active.current = null;
  current.model.categories.forEach((item, index) => paintScore(index, item.score ?? 0, true));
  paintNeedle(current.model.overall.score ?? 0);
  show(current.finished ? {
   index: FINISH,
   reaction: current.model.overall.score === null ? current.completionReaction : 'FINAL VERDICT!',
   scored: current.model.overall.score !== null, phase: 'complete',
  } : current.processing ? { ...REST, phase: 'working' } : REST);
 }

 function tick(now: number) {
  frame.current = 0;
  const active = run.current;
  const current = latest.current;
  if (!active.current && active.queue.length) {
   active.current = active.queue.shift()!;
   active.started = now;
   active.workingSince = 0;
   active.from = active.needle;
   active.fromScore = active.scoreValues[active.current.index] ?? 0;
   const isFinish = active.current.index === FINISH;
   if (!isFinish && active.current.reaction) active.reactionsShown.add(active.current.index);
   show({
    index: active.current.index, reaction: isFinish ? '' : active.current.reaction,
    scored: active.current.score !== null, phase: isFinish ? 'finish' : 'checkpoint',
   });
  }
  const step = active.current;
  if (step) {
   const elapsed = now - active.started;
   const isFinish = step.index === FINISH;
   const target = step.score ?? 0;
   const duration = isFinish ? FINISH_MS : CHECKPOINT_MS;
   if (isFinish) {
    const rise = FINISH_MS * 0.43;
    const peak = step.score === null ? 8.4 : 10;
    paintNeedle(elapsed < rise
     ? active.from + (peak - active.from) * easeOut(elapsed / rise)
     : peak + (target - peak) * easeOut((elapsed - rise) / (duration - rise)));
   } else if (step.score !== null) {
    // The bar and visible number receive the same hundredth from this frame.
    paintScore(step.index, scoreAtCheckpoint(target, elapsed, active.fromScore), elapsed >= duration * .9);
    paintNeedle(checkpointValue(active.from, target, elapsed));
   } else {
    // Evidence checkpoints have motion, while their score remains unavailable.
    const pulse = Math.sin(Math.min(1, elapsed / duration) * Math.PI);
    paintNeedle(active.from + (5.8 - active.from) * pulse * .55);
   }
   if (elapsed >= duration) {
    active.current = null;
    if (isFinish) show({
     index: FINISH, reaction: step.reaction, scored: step.score !== null, phase: 'complete',
    });
   }
  } else if (current.processing) {
   if (!active.workingSince) {
    active.workingSince = now;
    active.workingFrom = active.needle;
   }
   const t = now - active.workingSince;
   const pulse = 3.65 + 2.95 * Math.sin(t / 520) + 0.16 * Math.sin(t / 47);
   paintNeedle(active.workingFrom + (pulse - active.workingFrom) * easeOut(t / 520));
   show({ ...REST, phase: 'working' });
  }
  if (active.current || active.queue.length || current.processing) frame.current = requestAnimationFrame(tick);
 }

 useLayoutEffect(() => () => stop(), []);

 useLayoutEffect(() => {
  latest.current = inputs;
  if (session.current.identity !== identity) session.current = { identity, reactions: null };
  if (run.current.key !== key) {
   stop();
   const previousNeedle = viewRef.current.phase === 'working' && processing ? run.current.needle : 0;
   run.current = newRun(key);
   model.categories.forEach((_, index) => paintScore(index, 0));
   paintNeedle(previousNeedle);
   show(REST);
  }
  const active = run.current;
  if (reduced || active.skipped || !(animate || replaying) || (!processing && !finished)) {
   stop();
   if (reduced && (processing || finished)) active.skipped = true;
   settle();
   return;
  }
  const ready = model.categories.map((item, index) => item.score !== null || !!settled?.[index] || finished);
  if (!session.current.reactions && ready.some(Boolean)) {
   session.current.reactions = sampleReactions(model.categories.map(item => item.score));
  }
  model.categories.forEach(({ score }, index) => {
   if (score === null && active.scheduled.has(index) && active.scheduled.get(index) !== null) {
    active.queue = active.queue.filter(step => step.index !== index);
    if (active.current?.index === index) active.current = null;
    active.scheduled.delete(index);
    paintScore(index, 0);
    show(processing ? { ...REST, phase: 'working' } : REST);
   }
   if (!ready[index] || active.scheduled.has(index) && active.scheduled.get(index) === score) return;
   active.scheduled.set(index, score);
   const step = {
    index, score,
    reaction: active.reactionsShown.has(index) ? '' : session.current.reactions![index],
   };
   const pending = active.queue.findIndex(entry => entry.index === index);
   if (pending >= 0) {
    step.reaction = active.queue[pending].reaction;
    active.queue[pending] = step;
   } else {
    const finishIndex = active.queue.findIndex(entry => entry.index === FINISH);
    active.queue.splice(finishIndex < 0 ? active.queue.length : finishIndex, 0, step);
   }
  });
  if (finished && (!active.scheduled.has(FINISH) || active.scheduled.get(FINISH) !== model.overall.score)) {
   active.scheduled.set(FINISH, model.overall.score);
   active.queue = active.queue.filter(step => step.index !== FINISH);
   active.queue.push({
    index: FINISH, score: model.overall.score,
    reaction: model.overall.score === null ? completionReaction : 'FINAL VERDICT!',
   });
  }
  if (!frame.current && (active.current || active.queue.length || processing)) frame.current = requestAnimationFrame(tick);
 }, [key, identity, signature, settledSignature, model.overall.score, animate, processing, finished, reduced, completionReaction]);

 function skip() {
  run.current.skipped = true;
  stop();
  settle();
 }

 return {
  view, needle, arc, bars, scores, skip,
  canSkip: !reduced && !run.current.skipped && (processing || view.phase === 'checkpoint' || view.phase === 'finish'),
  replay: () => setReplay(value => ({ identity, count: value.identity === identity ? value.count + 1 : 1 })),
 };
}
