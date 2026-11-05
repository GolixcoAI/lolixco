import type {Ratings,Rating} from './ratingModel';
export const V7_IDS=['beat_synchronization','cuts_and_transitions','pacing','visual_measurements','storytelling_interpretation','originality_creativity','personalized_owner_fit'] as const;
export const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
export const string=(v:unknown)=>typeof v==='string'?v:'';
const scored=new Set(['MEASURED_SIGNAL','EVALUATED_SEMANTIC','PERSONALIZED_ESTIMATE','EXPERIMENTAL_PROXY']);
const states=new Set([...scored,'NOT_YET_ASSESSED','UNKNOWN','CONFLICT']);
export type PresentationSection={section_id:string;score_0_10:number|null;evidence_status:string;method_version:string;creator_explanation:string;timestamps:number[];evidence_refs:Record<string,unknown>};
export type Presentation={schema_version:'7.0.0-presentation';is_synthetic_fixture:boolean;experimental:boolean;assessment_sections:PresentationSection[];ratings:Ratings;context:Record<string,unknown>};
function score(v:unknown):number|null {if(v===null)return null;if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>10)throw Error('Scores must be null or finite numbers from 0 to 10.');return v;}
export function parsePresentation(input:unknown):Presentation{const raw=record(input);const experimental=raw.experimental_phase9===true||raw.overall_score_status==='CALCULATED_EXPERIMENTAL_V9'||Array.isArray(raw.assessment_sections)&&raw.assessment_sections.some(section=>['EVALUATED_SEMANTIC_EXPERIMENTAL','EXPERIMENTAL_PROXY'].includes(string(record(section).evidence_status)));const r=experimental?record(phase9Presentation(raw)):raw;if(r.schema_version!=='7.0.0-presentation')throw Error('Unsupported presentation version.');if(!Array.isArray(r.assessment_sections)||r.assessment_sections.length!==7)throw Error('Presentation requires seven dimensions.');const seen=new Set<string>();
const sections=r.assessment_sections.map(raw=>{const s=record(raw);const id=string(s.section_id);if(!V7_IDS.includes(id as typeof V7_IDS[number])||seen.has(id)||s.dimension_id!==undefined&&s.dimension_id!==id)throw Error('Invalid or duplicate dimension.');seen.add(id);const status=string(s.evidence_status);if(!states.has(status))throw Error('Unknown evidence status.');const value=score(s.score_0_10);if(value!==null&&!scored.has(status))throw Error('Unassessed/conflicting evidence cannot carry a score.');const stamps=s.timestamps??[];if(!Array.isArray(stamps)||stamps.some(t=>typeof t!=='number'||!Number.isFinite(t)||t<0))throw Error('Invalid timestamp references.');return{section_id:id,score_0_10:value,evidence_status:status,method_version:string(s.method_version),creator_explanation:string(s.creator_explanation),timestamps:stamps as number[],evidence_refs:record(s.evidence_refs)};}).sort((a,b)=>V7_IDS.indexOf(a.section_id as typeof V7_IDS[number])-V7_IDS.indexOf(b.section_id as typeof V7_IDS[number]));
const overall=score(r.overall_score_0_10);const status=string(r.overall_score_status);if(!['CALCULATED_PERSONALIZED','CALCULATED_SEMANTIC','NOT_YET_ASSESSED','INSUFFICIENT_DATA'].includes(status)||overall!==null&&!status.startsWith('CALCULATED_'))throw Error('Unsupported overall assessment.');
const toRating=(s:PresentationSection):Rating=>({score:s.score_0_10,status:s.evidence_status,provenance:s.method_version,explanation:s.creator_explanation,timestamps:s.timestamps,measurements:s.evidence_refs});
return{schema_version:'7.0.0-presentation',is_synthetic_fixture:r.is_synthetic_fixture===true,experimental,assessment_sections:sections,ratings:{categories:sections.map(toRating),overall:{score:overall,status,provenance:string(r.overall_score_method)}},context:record(r.context_evidence)};}

const phase9Limits: Record<string, string> = {
 beat_synchronization: 'Experimental cut-to-grid and mixed-audio onset proxy. The independent uniform timing control does not preserve shot spacing. Transients can come from edit effects, dialogue, or music.',
 cuts_and_transitions: 'Experimental histogram continuity proxy. A contrasting hard cut can be intentional. Flash counts are a signal for review, not a safety assessment.',
 pacing: 'Experimental shot duration and audio energy proxy. Consistent cadence, silence and slower scenes can be deliberate.',
 visual_measurements: 'Experimental format, sharpness and contrast proxy. These measurements do not establish composition, effects quality, or freedom from compression artifacts.',
 storytelling_interpretation: 'Artistic grade withheld. Timing and audio energy do not establish narrative structure, character presence, or emotional resolution.',
 originality_creativity: 'Artistic grade withheld. Shot duration statistics cannot establish originality without suitable comparison evidence.',
 personalized_owner_fit: 'Grade withheld. This weighted reuse of the other dimensions has no independently validated Phase 9 owner-fit result.',
};

export function phase9Section(input: unknown) {
 const raw = record(input);
 const id = string(raw.section_id);
 const supportedProxy = V7_IDS.slice(0, 4).some(key => key === id);
 const value = supportedProxy && ['MEASURED_SIGNAL', 'EXPERIMENTAL_PROXY'].includes(string(raw.evidence_status))
  ? score(raw.score_0_10) : null;
 const evidence = record(raw.evidence_refs);
 // The Phase 7 export includes legacy beat metrics even when its score comes from Phase 9.
 const legacyBeat = id === 'beat_synchronization' && 'primary_grid_tight_percent' in evidence;
 const legacyBeatKeys = /^(primary_grid|double_time|subdivision_16th|onset_transient|compound_tight|anticipatory|rigid_grid|compound_alignment)/;
 const refs = Object.fromEntries(Object.entries(evidence)
  .filter(([key, value]) => typeof value === 'number' && Number.isFinite(value)
   && !/significance|p_value|loocv|entropy/.test(key) && !(legacyBeat && legacyBeatKeys.test(key)))
  .map(([key, value]) => [key === 'excess_synchronization_lift_percent' ? 'excess_synchronization_percentage_points' : key, value]));
 const momentTimes = (group: unknown) => Array.isArray(group)
  ? group.map(moment => record(moment).timestamp_sec)
   .filter((time): time is number => typeof time === 'number' && Number.isFinite(time) && time >= 0)
  : [];
 const hits = momentTimes(raw.best_synchronized_moments);
 const misses = momentTimes(raw.rhythmic_drift_moments);
 const formatTimes = (times: number[]) => times.map(time => time.toFixed(2) + 's').join(', ');
 const timingNotes = [
  hits.length && 'Detected matches: ' + formatTimes(hits) + '.',
  misses.length && 'Outside the timing windows: ' + formatTimes(misses) + '.',
 ].filter(Boolean).join(' ');
 return {
  ...raw,
  score_0_10: value,
  evidence_status: value === null ? 'NOT_YET_ASSESSED' : 'EXPERIMENTAL_PROXY',
  method_version: 'phase9_experimental_proxy',
  creator_explanation: [phase9Limits[id], timingNotes].filter(Boolean).join(' '),
  evidence_refs: refs,
  timestamps: [...new Set([...hits, ...misses, ...(Array.isArray(raw.timestamps) ? raw.timestamps : [])])],
 };
}

export function phase9Presentation(input: unknown, v6?: unknown, sections: unknown[] = []) {
 const raw = record(input);
 const cards = record(record(record(v6).section_d_semantic_evaluation).scorecard);
 const aliases: Record<string,string> = {
  cuts_and_transitions: 'transitions', visual_measurements: 'visual_quality', storytelling_interpretation: 'storytelling_emotion',
 };
 return {
  ...raw,
  experimental_phase9: true,
  overall_score_0_10: null,
  overall_score_status: 'NOT_YET_ASSESSED',
  overall_score_method: null,
  assessment_sections: Array.isArray(raw.assessment_sections) ? raw.assessment_sections.map(input => {
   const section = record(input);
   const id = string(section.section_id);
   const details = record(record(cards[aliases[id] || id]).metric_details);
   const live = record(sections.find(value => record(value).section_id === id));
   return phase9Section({...section,
    best_synchronized_moments: live.best_synchronized_moments ?? section.best_synchronized_moments,
    rhythmic_drift_moments: live.rhythmic_drift_moments ?? section.rhythmic_drift_moments,
    evidence_refs: {...record(section.evidence_refs), ...details}});
  }) : raw.assessment_sections,
 };
}
