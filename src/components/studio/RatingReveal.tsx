import { useEffect, useId, useState, type Ref } from 'react';
import { CATEGORY_LABELS, DEMO_RATINGS, EMPTY_RATINGS, REACTION_POOL, type Rating, type Ratings } from './ratingModel';
import { useRatingMotion } from './useRatingMotion';
import ProcessingLabel from './ProcessingLabel';

const DIAL_ARC = 'M 24 152 A 126 126 0 0 1 276 152';
const TICKS = Array.from({ length: 21 }, (_, i) => {
 const angle = Math.PI - i * Math.PI / 20;
 const major = i % 2 === 0;
 const x = (radius: number) => 150 + Math.cos(angle) * radius;
 const y = (radius: number) => 152 - Math.sin(angle) * radius;
 return <g key={i}>
  <line x1={x(104)} y1={y(104)} x2={x(major ? 95 : 100)} y2={y(major ? 95 : 100)}
   stroke={major ? '#e1e6eb' : '#697787'} strokeWidth={major ? 1.7 : 1}/>
  {major && <text x={x(81)} y={y(81) + 3} textAnchor="middle" fill="#d5dde5" fontSize="9">{i / 2}</text>}
 </g>;
});

function RpmDial({ needle, arc }: { needle: Ref<SVGPathElement>; arc: Ref<SVGPathElement> }) {
 const gradient = useId();
 return <svg viewBox="0 0 300 170" aria-hidden="true">
  <defs>
   <linearGradient id={gradient} x2="0.8" y2="1">
    <stop stopColor="#fff693"/>
    <stop offset=".48" stopColor="#ffe12c"/>
    <stop offset="1" stopColor="#e5a718"/>
   </linearGradient>
  </defs>
  <path d={DIAL_ARC} fill="none" stroke="#39434d" strokeWidth="24" strokeLinecap="round"/>
  <path d={DIAL_ARC} fill="none" stroke="#222932" strokeWidth="22" strokeLinecap="round"/>
  <path d="M 38 152 A 112 112 0 0 1 262 152" fill="none" stroke="#3c4652"/>
  <path ref={arc} className="rpm-active-arc" d={DIAL_ARC} fill="none" stroke={`url(#${gradient})`}
   strokeWidth="13" strokeLinecap="round" pathLength="100" opacity="0"/>
  {TICKS}
  <path ref={needle} className="rpm-needle" d="M 138 152 L 150 148 L 245 152 L 150 156 Z"
   transform="rotate(-180 150 152)"/>
  <circle className="rpm-hub" cx="150" cy="152" r="9" fill="#181c23" strokeWidth="2"/>
  <circle cx="150" cy="152" r="3" fill="#afb7bf"/>
 </svg>;
}

function EvidenceMeasurements({ measurements }: { measurements: Rating['measurements'] }) {
 const scalar = (value: unknown) => typeof value === 'string' || typeof value === 'boolean'
  || typeof value === 'number' && Number.isFinite(value);
 const rows = (entries: [string, unknown][]) => <dl>{entries.map(([key, value]) =>
  <div key={key}><dt>{key.replace(/_/g, ' ')}</dt><dd>{String(value)}</dd></div>)}</dl>;
 const entries = Object.entries(measurements || {});
 const fields = entries.filter(([, value]) => scalar(value));
 const groups = entries.filter(([, value]) => value !== null && typeof value === 'object' && !Array.isArray(value));
 return <div className="rating-diagnostics">
  {fields.length > 0 && rows(fields)}
  {groups.map(([name, value]) => {
   const group = Object.entries(value as Record<string, unknown>).filter(([, item]) => scalar(item));
   return group.length ? <div key={name}><strong>{name.replace(/_/g, ' ')}</strong>{rows(group)}</div> : null;
  })}
 </div>;
}

type RatingRevealProps = {
 ratings?: Ratings; synthetic?: boolean; experimental?: boolean; developmentPreview?: boolean;
 receivedResultId?: string; inputIdentity?: string; settled?: readonly boolean[]; localResult?: boolean; processing?: boolean; analysisComplete?: boolean;
 onSeek?: (time: number) => void;
};

export default function RatingReveal({
 ratings, synthetic = false, experimental = false, developmentPreview = false, receivedResultId, inputIdentity, settled,
 localResult = false, processing = false, analysisComplete = false, onSeek,
}: RatingRevealProps) {
 const [demo, setDemo] = useState(false);
 const [comicPreview, setComicPreview] = useState('');
 const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
 useEffect(() => {
  const query = matchMedia('(prefers-reduced-motion: reduce)');
  const update = () => setReduced(query.matches);
  query.addEventListener('change', update);
  return () => query.removeEventListener('change', update);
 }, []);
 useEffect(() => {
  if (processing || inputIdentity) {
   setDemo(false);
   setComicPreview('');
  }
 }, [processing, inputIdentity]);

 const demoActive = demo && !processing;
 const model = demoActive ? DEMO_RATINGS : ratings ?? EMPTY_RATINGS;
 const actual = model.overall.score;
 const hasScores = model.categories.some(item => item.score !== null);
 const hasObservations = model.categories.some(item => ['EVALUATED_SEMANTIC_EXPERIMENTAL', 'EXPERIMENTAL_SEMANTIC_SCORE'].includes(item.status));
 const finished = demoActive || analysisComplete || !!ratings && !localResult;
 const motion = useRatingMotion({
  model, identity: demoActive ? 'synthetic' : receivedResultId || inputIdentity || 'studio',
  animate: demoActive || processing || !!receivedResultId, processing, finished, reduced, settled,
  completionReaction: hasObservations ? 'REVIEW COMPLETE' : hasScores || localResult ? 'TECHNICAL COMPLETE' : 'REVIEW COMPLETE',
 });
 const { view } = motion;
 const reaction = (!processing && comicPreview) || view.reaction;
 const verdict = view.phase === 'complete' && actual !== null;
 const mode = demoActive || synthetic ? 'SYNTHETIC FIXTURE · SAMPLE SCORES'
  : processing ? 'LIVE ANALYSIS' : experimental ? hasObservations ? 'EXPERIMENTAL SEMANTIC REVIEW' : hasScores ? 'EXPERIMENTAL TECHNICAL SCORES' : 'EXPERIMENTAL OBSERVATIONS'
  : localResult && finished ? 'ANALYSIS RESULTS' : finished ? 'IMPORTED REPORT' : 'EDIT DNA · READY';
 const headline = verdict ? `${actual.toFixed(2)}/10` : processing ? <ProcessingLabel>Analysing</ProcessingLabel>
  : view.phase === 'checkpoint' || view.phase === 'finish' ? <ProcessingLabel>Presenting findings</ProcessingLabel>
  : finished ? 'Overall score unavailable' : 'Ready for analysis';

 return <div className="rating-reveal" data-phase={view.phase} data-has-overall={actual !== null}
  data-complete={view.phase === 'complete'} data-checkpoint={view.index} data-checkpoint-scored={view.scored}>
  <div className={`rating-mode${demoActive || synthetic ? ' rating-synthetic' : ''}`}>{mode}</div>
  <div className="rpm-instrument">
   <RpmDial needle={motion.needle} arc={motion.arc}/>
   <div className="rpm-reaction-slot">
    {reaction && <div className="rpm-reaction" data-reaction={reaction} aria-hidden="true"
     key={reaction + view.index}>{reaction}</div>}
   </div>
  </div>
  <div className="rpm-verdict">
   <small>{verdict ? 'OVERALL EDIT SCORE' : view.index >= 0 && view.index < 7 ? CATEGORY_LABELS[view.index] : 'EDIT DNA ENGINE'}{view.phase === 'checkpoint' && !view.scored ? ' · EVIDENCE REVIEW' : ''}</small>
   <strong>{headline}</strong>
   {(demoActive || synthetic)
    ? <span>Synthetic scores for visual review.</span>
    : finished && actual === null && view.phase === 'complete'
    ? <span>{hasScores ? hasObservations ? 'Review the experimental rubrics and evidence below.' : 'Review technical proxies and their evidence below.' : 'Review the available observations and evidence limits below.'}</span>
    : verdict && <span>{model.overall.status.replace(/_/g, ' ')} · {model.overall.provenance}</span>}
  </div>
  <p className="rating-accessible" aria-live="polite">
   {view.phase === 'complete' ? verdict ? `Overall score ${actual.toFixed(2)} out of ten` : 'Review complete. Overall score unavailable.' : ''}
  </p>
  <div className="rating-controls">
   <button type="button" onClick={motion.skip} disabled={!motion.canSkip}>Skip animation</button>
   <button type="button" onClick={() => { setComicPreview(''); motion.replay(); }}
    disabled={!finished || processing || reduced || view.phase !== 'complete'}>Replay</button>
  </div>
  <div className="rating-breakdown-heading">Assessment <span>7 dimensions</span></div>
  <div className="rating-categories">{CATEGORY_LABELS.map((label, i) => {
   const item = model.categories[i];
   const score = item.score;
   const observation = item.status === 'EVALUATED_SEMANTIC_EXPERIMENTAL';
   return <div className="rating-category" key={label} data-active={view.phase === 'checkpoint' && view.index === i}>
    <div className="rating-category-heading"><h4>{label}</h4>
     {score !== null ? <span className="rating-score-chip" aria-hidden="true" ref={element => { motion.scores.current[i] = element; }}/>
      : observation ? <span className="rating-evidence-chip">Observation</span>
      : (finished || settled?.[i]) && <span className="rating-unassessed">{item.status === 'CONFLICT' ? 'Conflict' : 'No score'}</span>}
    </div>
    {score === null ? <div className="rating-track rating-track-neutral" aria-hidden="true"/>
     : <div className="rating-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={10}
       aria-valuenow={score} aria-valuetext={`${score.toFixed(2)} out of 10`}>
       <div ref={element => { motion.bars.current[i] = element; }}/>
      </div>}
    {item.status === 'EXPERIMENTAL_SEMANTIC_SCORE' && <p className="rating-explanation">
     {i === 5 ? 'Experimental creative execution rubric. Comparative originality requires reference evidence.' : 'Experimental storytelling rubric.'}
    </p>}
    {score === null && !!item.explanation && <p className="rating-explanation">{item.explanation}</p>}
    <details className="rating-dimension-details">
     <summary>Evidence details<span className="rating-accessible"> for {label}</span></summary>
     {score !== null && <p className="rating-final-score">Reported score {score.toFixed(2)}/10</p>}
     {score !== null && <p>{item.explanation || 'Reported score: ' + score.toFixed(2) + '/10'}</p>}
     {score === null && !item.explanation && <p>Evidence for this dimension is pending or unavailable.</p>}
     <small>{item.status.replace(/_/g, ' ')}{item.provenance ? ` · ${item.provenance}` : ''}</small>
     {item.limitations?.filter(limit => limit !== item.explanation).map(limit => <p key={limit}>{limit}</p>)}
     <EvidenceMeasurements measurements={item.measurements}/>
     {!!item.timestamps?.length && <div className="rating-timestamps">
      {item.timestamps.map(time => <button key={time} disabled={!onSeek} onClick={() => onSeek?.(time)}>
       Reference {time.toFixed(2)}s
      </button>)}
     </div>}
    </details>
   </div>;
  })}</div>
  {developmentPreview && <details className="rating-preview-options">
   <summary>Developer animation previews</summary>
   <button className="rating-demo-toggle" type="button" aria-pressed={demoActive} disabled={processing}
    onClick={() => { setComicPreview(''); setDemo(value => !value); }}>
    {demoActive ? 'Exit synthetic fixture' : 'Play seven-score fixture'}
   </button>
   <label>Preview comic reaction
    <select value={comicPreview} disabled={processing} onChange={event => setComicPreview(event.target.value)}>
     <option value="">Choose a reaction</option>
     {REACTION_POOL.map(phrase => <option key={phrase}>{phrase}</option>)}
    </select>
   </label>
  </details>}
 </div>;
}
