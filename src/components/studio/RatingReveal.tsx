import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {CATEGORY_LABELS,DEMO_RATINGS,EMPTY_RATINGS,REVEAL_MS,RESULT_REVEAL_MS,selectReactions,categoryValue,needleValue,type Ratings} from './ratingModel';
import './rating.css';
const DIAL_ARC = 'M 24 152 A 126 126 0 0 1 276 152';

function RpmDial({ needle, fill, available }: {needle: number; fill: number; available: boolean}) {
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
  {fill > 0 && <path className="rpm-active-arc" d={DIAL_ARC} fill="none" stroke={`url(#${gradient})`}
   strokeWidth="13" strokeLinecap="round" pathLength="100" strokeDasharray={`${fill * 10} 100`}/>}
  {Array.from({length: 21}, (_, i) => {
   const angle = Math.PI - i * Math.PI / 20;
   const major = i % 2 === 0;
   const x = (radius: number) => 150 + Math.cos(angle) * radius;
   const y = (radius: number) => 152 - Math.sin(angle) * radius;
   return <g key={i}>
    <line x1={x(104)} y1={y(104)} x2={x(major ? 96 : 100)} y2={y(major ? 96 : 100)}
     stroke={major ? '#e1e6eb' : '#697787'} strokeWidth={major ? 1.7 : 1}/>
    {major && <text x={x(82)} y={y(82) + 3} textAnchor="middle" fill="#d5dde5" fontSize="9">{i / 2}</text>}
   </g>;
  })}
  <path
   className={available ? 'rpm-needle' : 'rpm-needle-standby'}
   d={available ? 'M 138 152 L 150 148 L 247 152 L 150 156 Z' : 'M 138 152 L 150 148 L 223 152 L 150 156 Z'}
   fill={available ? '#ffe63c' : '#aebbc9'}
   transform={`rotate(${available ? needle * 18 - 180 : -192} 150 152)`}
  />
  <circle cx="150" cy="152" r="9" fill="#181c23" stroke={available ? '#ffe63c' : '#687482'} strokeWidth="2"/>
  <circle cx="150" cy="152" r="3" fill="#afb7bf"/>
 </svg>;
}

export default function RatingReveal({ratings,synthetic=false,developmentPreview=false,receivedResultId,localResult=false,processing=false,analysisComplete=false,onSeek}:{ratings?:Ratings;synthetic?:boolean;developmentPreview?:boolean;receivedResultId?:string;localResult?:boolean;processing?:boolean;analysisComplete?:boolean;onSeek?:(time:number)=>void}){
 const[demo,setDemo]=useState(false);const[timingPreview,setTimingPreview]=useState(false);const[replay,setReplay]=useState(0);const[elapsed,setElapsed]=useState(REVEAL_MS);const[reduced,setReduced]=useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);const root=useRef<HTMLDivElement>(null);const playedResult=useRef(new Set<string>());const model=demo?DEMO_RATINGS:ratings??EMPTY_RATINGS;const hasResults=model.categories.some(x=>x.score!==null)||model.overall.score!==null;const duration=model.overall.score===null?900:demo&&!timingPreview?REVEAL_MS:RESULT_REVEAL_MS;const scoreSignature=JSON.stringify([model.categories.map(x=>x.score),model.overall.score]);const done=elapsed>=duration;const [reactions,setReactions]=useState<string[]>([]);const[animatedIndices,setAnimatedIndices]=useState<Set<number>>(()=>new Set());
 useEffect(()=>{setDemo(false);setTimingPreview(false);setReplay(0)},[ratings]);
 useEffect(()=>{const q=matchMedia('(prefers-reduced-motion: reduce)');const f=()=>setReduced(q.matches);q.addEventListener('change',f);return()=>q.removeEventListener('change',f)},[]);
 useLayoutEffect(()=>{setReactions(selectReactions(model));if(root.current)delete root.current.dataset.measuredDuration;const freshKeys=receivedResultId?[...model.categories.map((x,i)=>x.score===null?'':`${receivedResultId}:${i}`),model.overall.score===null?'':`${receivedResultId}:overall`].filter(k=>k&&!playedResult.current.has(k)):[];const newResult=freshKeys.length>0;setAnimatedIndices(new Set(model.categories.flatMap((item,i)=>item.score!==null&&(demo||replay>0||freshKeys.includes(`${receivedResultId}:${i}`))?[i]:[])));freshKeys.forEach(k=>playedResult.current.add(k));if(reduced||!hasResults||!demo&&replay===0&&!newResult){setElapsed(duration);return}let frame=0;let start:number|undefined;setElapsed(0);const tick=(now:number)=>{if(skipped.current){setElapsed(duration);return}start??=now;const t=Math.min(duration,now-start);setElapsed(t);if(t<duration)frame=requestAnimationFrame(tick);else if(root.current){root.current.dataset.measuredDuration=String(now-start)}};frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame)},[scoreSignature,replay,reduced,hasResults,duration,demo,receivedResultId]);
 const skipped=useRef(false);useEffect(()=>{skipped.current=false},[model,replay]);
 const presentationTime=elapsed*REVEAL_MS/duration;
 const needle=model.overall.score===null?0:needleValue(model,presentationTime);const completed=Math.min(7,Math.floor(presentationTime/300));const reaction=model.overall.score===null?(done?analysisComplete?'TECHNICAL COMPLETE':'FINDINGS READY':reactions[model.categories.findIndex(x=>x.score!==null)]||'FINDING RECEIVED'):done?(model.overall.score===null?analysisComplete?'TECHNICAL COMPLETE':'FINDINGS READY':'FINAL VERDICT!'):completed===7?'SETTLING':completed===0?'GET SET':reactions[completed-1]||'NOT ASSESSED';
 const actual=model.overall.score;const finalText=actual===null?processing?'Analyzing…':'Overall score unavailable':`${actual.toFixed(2)}/10`;
 return <div ref={root} className={`rating-reveal ${demo?'rating-demo':''}`} data-complete={done} data-has-overall={actual!==null} data-duration={duration}>
 <div className="rating-mode">{timingPreview?'REAL-RESULT TIMING PREVIEW — SYNTHETIC':demo?'PREVIEW RATING ANIMATION — DEMO':synthetic?'IMPORTED SYNTHETIC FIXTURE — NOT AI RESULTS':hasResults?localResult?'LOCAL ANALYSIS · RESULT PRESENTATION':'IMPORTED REPORT · RESULT PRESENTATION':'AWAITING SUPPORTED RESULTS'}</div>
 <div className="rpm-instrument"><RpmDial needle={needle} fill={done?(actual??0):needle} available={actual!==null}/><div className={`rpm-reaction ${!hasResults?'rating-reaction-hidden':''}`} aria-hidden="true" key={model.overall.score===null?done?analysisComplete?'technical-finished':'technical-findings':'technical-received':done?'verdict':Math.min(7,Math.floor(presentationTime/300))}>{reaction}</div></div>
 <div className="rpm-verdict"><small>{done?'OVERALL EDIT SCORE':'REVEAL SEQUENCE · NOT A PARTIAL SCORE'}</small><strong>{actual===null?finalText:done?finalText:'Result reveal'}</strong>{!demo&&!synthetic&&actual===null&&<span key={analysisComplete?'complete':'pending'} className={analysisComplete?'technical-completion':''}>{processing?'Findings appear as the service returns them.':analysisComplete?'Technical analysis complete. Artistic assessment is unavailable.':'No supported overall assessment supplied.'}</span>}{demo||synthetic?<span>Synthetic values for visual review. No AI analysis ran.</span>:actual!==null&&<span>{model.overall.status.replace(/_/g,' ')} · {model.overall.provenance}</span>}</div>
 <p className="rating-accessible" aria-live="polite">{done?`${demo?'Demo. ':''}Overall: ${finalText}`:'Results available below. Cinematic presentation in progress.'}</p>
 <div className="rating-controls"><button onClick={()=>{skipped.current=true;setElapsed(duration);setReplay(v=>v)}} disabled={done}>Skip animation</button><button onClick={()=>setReplay(v=>v+1)} disabled={!hasResults||reduced}>Replay</button></div>
 <div className="rating-breakdown-heading">Rating tests <span>7 dimensions</span></div>
 <div className="rating-categories">{CATEGORY_LABELS.map((label,i)=>{const item=model.categories[i];const value=item.score===null?null:done||!animatedIndices.has(i)?item.score:categoryValue(item.score,presentationTime,model.overall.score===null?0:i);return <div className="rating-category" key={label}><div><h4>{label}</h4><span className={value===null?'rating-unassessed':'rating-score-chip'} aria-hidden="true">{value===null?item.status==='CONFLICT'?'Conflict':item.status==='UNKNOWN'?'Unknown':'Unassessed':`${value.toFixed(2)}/10`}</span></div>{value!==null&&<div className="rating-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={10} aria-valuenow={item.score!} aria-valuetext={`${item.score!.toFixed(2)} out of 10`}><div style={{clipPath:`inset(0 ${100-value*10}% 0 0 round 999px)`}}/></div>}{value===null&&<div className="rating-track rating-track-neutral" aria-hidden="true"/>}<span className="rating-accessible">{value===null?'Unassessed':`${item.score!.toFixed(2)} out of 10`}</span>{item.measurements&&<div className="rating-measurements">{Object.entries(item.measurements).filter(([,v])=>typeof v==='number'&&Number.isFinite(v)).map(([k,v])=><span key={k}>{k.replace(/_/g,' ')} <b>{String(v)}</b></span>)}</div>}<details className="rating-dimension-details"><summary>Evidence details<span className="rating-accessible"> for {label}</span></summary>{item.score!==null&&<p>Reported score: {item.score.toFixed(2)}/10</p>}<p>{item.explanation||'No supporting assessment has been supplied for this dimension.'}</p><small>{item.status.replace(/_/g,' ')}{item.provenance?` · ${item.provenance}`:''}</small>{!!item.timestamps?.length&&<div className="rating-timestamps">{item.timestamps.map(t=><button key={t} disabled={!onSeek} onClick={()=>onSeek?.(t)}>Reference {t.toFixed(2)}s</button>)}</div>}</details></div>})}</div>
 <details className="rating-preview-options" open={demo || undefined}><summary>Animation previews</summary><button className="rating-demo-toggle" aria-pressed={demo} onClick={()=>{setTimingPreview(false);setDemo(v=>!v)}}>{demo?'Exit demo · show imported results':'Preview Rating Animation — Demo'}</button>{developmentPreview&&<button className="rating-demo-toggle" onClick={()=>{setTimingPreview(true);setDemo(true);setReplay(v=>v+1)}}>Preview Real-Result Timing</button>}</details>
 
 </div>
}
