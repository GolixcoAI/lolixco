import type {Ratings,Rating} from './ratingModel';
export const ASSESSMENT_IDS=['beat_synchronization','cuts_and_transitions','pacing','visual_measurements','storytelling_interpretation','originality_creativity'] as const;
// Existing imports use this alias while historical v7 payloads remain supported.
export const V7_IDS=ASSESSMENT_IDS;
const LEGACY_IDS=[...ASSESSMENT_IDS,'personalized_owner_fit'];
export const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
export const string=(v:unknown)=>typeof v==='string'?v:'';
const scored=new Set(['MEASURED_SIGNAL','EVALUATED_SEMANTIC','PERSONALIZED_ESTIMATE','EXPERIMENTAL_PROXY','EXPERIMENTAL_SEMANTIC_SCORE']);
const states=new Set([...scored,'NOT_YET_ASSESSED','UNKNOWN','CONFLICT','EVALUATED_SEMANTIC_EXPERIMENTAL']);
export type PresentationSection={section_id:string;score_0_10:number|null;evidence_status:string;method_version:string;creator_explanation:string;limitations:string[];timestamps:number[];evidence_refs:Record<string,unknown>};
export type Presentation={schema_version:'8.0.0-presentation';is_synthetic_fixture:boolean;experimental:boolean;assessment_sections:PresentationSection[];ratings:Ratings;context:Record<string,unknown>};
function score(v:unknown):number|null {if(v===null)return null;if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>10)throw Error('Scores must be null or finite numbers from 0 to 10.');return v;}
export function parsePresentation(input: unknown): Presentation {
 const raw = record(input);
 const sourceSections = Array.isArray(raw.assessment_sections) ? raw.assessment_sections : [];
 const phase9 = raw.experimental_phase9 === true || raw.overall_score_status === 'CALCULATED_EXPERIMENTAL_V9'
  || sourceSections.some(section => record(section).evidence_status === 'EXPERIMENTAL_PROXY');
 const experimental = phase9 || sourceSections.some(section =>
  ['EVALUATED_SEMANTIC_EXPERIMENTAL', 'EXPERIMENTAL_SEMANTIC_SCORE'].includes(string(record(section).evidence_status)));
 const legacy = raw.schema_version === '7.0.0-presentation';
 if (!legacy && raw.schema_version !== '8.0.0-presentation') throw Error('Unsupported presentation version.');
 if (legacy && (sourceSections.length !== 7 || new Set(sourceSections.map(section => record(section).section_id)).size !== 7
  || sourceSections.some(section => !LEGACY_IDS.includes(string(record(section).section_id))))) {
  throw Error('Historical presentation requires its seven original dimensions.');
 }
 const presentation = legacy && phase9 ? record(phase9Presentation(raw)) : raw;
 const currentSections = Array.isArray(presentation.assessment_sections)
  ? presentation.assessment_sections.filter(section => record(section).section_id !== 'personalized_owner_fit') : [];
 if (currentSections.length !== 6) throw Error('Presentation requires six dimensions.');
 const seen = new Set<string>();
 const sections = currentSections.map(value => {
  const section = record(value);
  const id = string(section.section_id);
  if (!V7_IDS.includes(id as typeof V7_IDS[number]) || seen.has(id)
   || section.dimension_id !== undefined && section.dimension_id !== id) throw Error('Invalid or duplicate dimension.');
  seen.add(id);
  const status = string(section.evidence_status);
  if (!states.has(status)) throw Error('Unknown evidence status.');
  const numericScore = score(section.score_0_10);
  if (status === 'EXPERIMENTAL_SEMANTIC_SCORE') validateSemanticScore(section);
  if (numericScore !== null && !scored.has(status)) throw Error('Unassessed/conflicting evidence cannot carry a score.');
  const timestamps = section.timestamps ?? [];
  if (!Array.isArray(timestamps) || timestamps.some(time => typeof time !== 'number' || !Number.isFinite(time) || time < 0)) {
   throw Error('Invalid timestamp references.');
  }
  return {
   section_id: id, score_0_10: numericScore, evidence_status: status,
   method_version: string(section.method_version), creator_explanation: string(section.creator_explanation),
   limitations: Array.isArray(section.limitations) ? section.limitations.filter((item): item is string => typeof item === 'string') : [],
   timestamps: timestamps as number[], evidence_refs: record(section.evidence_refs),
  };
 }).sort((left, right) => V7_IDS.indexOf(left.section_id as typeof V7_IDS[number]) - V7_IDS.indexOf(right.section_id as typeof V7_IDS[number]));
 const overall = legacy ? null : score(presentation.overall_score_0_10);
 const status = legacy ? 'NOT_YET_ASSESSED' : string(presentation.overall_score_status);
 if (!['CALCULATED_EXPERIMENTAL_SIX','CALCULATED_SEMANTIC_SIX','CALCULATED_SEMANTIC','NOT_YET_ASSESSED','INSUFFICIENT_DATA'].includes(status)
  || overall !== null && (!status.startsWith('CALCULATED_') || sections.some(section => section.score_0_10 === null)
   || !string(presentation.overall_score_method))) throw Error('Unsupported overall assessment.');
 const toRating = (section: PresentationSection): Rating => ({
  score: section.score_0_10, status: section.evidence_status, provenance: section.method_version,
  explanation: section.creator_explanation, limitations: section.limitations,
  timestamps: section.timestamps, measurements: section.evidence_refs,
 });
 return {
  schema_version: '8.0.0-presentation', is_synthetic_fixture: presentation.is_synthetic_fixture === true, experimental,
  assessment_sections: sections,
  ratings: {categories: sections.map(toRating), overall: {score: overall, status, provenance: string(presentation.overall_score_method)}},
  context: record(presentation.context_evidence),
 };
}

const semanticMethods: Record<string, string> = {
 beat_synchronization: 'gemini_audiovisual_rhythm_rubric_v1',
 cuts_and_transitions: 'gemini_transition_rubric_v1',
 pacing: 'gemini_pacing_rubric_v1',
 visual_measurements: 'gemini_visual_craft_rubric_v1',
 storytelling_interpretation: 'gemini_storytelling_rubric_v1',
 originality_creativity: 'gemini_creative_execution_rubric_v1',
};

function validateSemanticScore(section: Record<string, unknown>) {
 const refs = record(section.evidence_refs);
 if (section.method_version !== semanticMethods[string(section.section_id)]
  || !string(refs.provider_model) || !string(refs.assessment_scope)
  || typeof refs.supported_criteria !== 'number' || refs.supported_criteria < 3) {
  throw Error('Semantic ratings require a supported rubric and audiovisual evidence.');
 }
}

const phase9Limits: Record<string, string> = {
 beat_synchronization: 'Experimental cut-to-grid and mixed-audio onset proxy. Transients can come from edit effects, dialogue, or music. The circular-shift diagnostic preserves cut spacing.',
 cuts_and_transitions: 'Experimental histogram continuity proxy. A contrasting hard cut can be intentional. Flash counts are a signal for review, not a safety assessment.',
 pacing: 'Experimental shot duration and audio energy proxy. Consistent cadence, silence and slower scenes can be deliberate.',
 visual_measurements: 'Experimental format, sharpness and contrast proxy. These measurements do not establish composition, effects quality, or freedom from compression artifacts.',
 storytelling_interpretation: 'Artistic grade withheld. Timing and audio energy do not establish narrative structure, character presence, or emotional resolution.',
 originality_creativity: 'Artistic grade withheld. Shot duration statistics cannot establish originality without suitable comparison evidence.',
};

export function phase9Section(input: unknown) {
 const raw = record(input);
 const id = string(raw.section_id);
 if (raw.evidence_status === 'EXPERIMENTAL_SEMANTIC_SCORE') {
  validateSemanticScore(raw);
  return raw;
 }
 const supportedProxy = V7_IDS.slice(0, 4).some(key => key === id);
 const semanticObservation = raw.score_0_10 === null
  && raw.evidence_status === 'EVALUATED_SEMANTIC_EXPERIMENTAL'
  && (raw.method_version === 'gemini_semantic_experimental' || raw.method_version === semanticMethods[id]);
 const value = supportedProxy && ['MEASURED_SIGNAL', 'EXPERIMENTAL_PROXY'].includes(string(raw.evidence_status))
  ? score(raw.score_0_10) : null;
 const evidence = record(raw.evidence_refs);
 // The Phase 7 export includes legacy beat metrics even when its score comes from Phase 9.
 const legacyBeat = id === 'beat_synchronization' && 'primary_grid_tight_percent' in evidence;
 const legacyBeatKeys = /^(primary_grid|double_time|subdivision_16th|onset_transient|compound_tight|anticipatory|rigid_grid|compound_alignment)/;
 function cleanRefValue(v: unknown): unknown {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  if (v && typeof v === 'object' && !Array.isArray(v)) {
   const entries = Object.entries(v as Record<string, unknown>)
    .filter(([k]) => !/significance|p_value|loocv/.test(k))
    .map(([k, val]) => [k, cleanRefValue(val)])
    .filter(([_, val]) => val !== undefined);
   return entries.length ? Object.fromEntries(entries) : undefined;
  }
  return undefined;
 }
 const refs = Object.fromEntries(Object.entries(evidence)
  .filter(([key]) => !/significance|p_value|loocv/.test(key) && !(legacyBeat && legacyBeatKeys.test(key)))
  .map(([key, value]) => [
   key === 'excess_synchronization_lift_percent' ? 'excess_synchronization_percentage_points' : key,
   cleanRefValue(value)
  ])
  .filter(([_, value]) => value !== undefined));
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
  evidence_status: semanticObservation ? 'EVALUATED_SEMANTIC_EXPERIMENTAL' : value === null ? 'NOT_YET_ASSESSED' : 'EXPERIMENTAL_PROXY',
  method_version: (semanticObservation || string(raw.method_version).startsWith('phase9_'))
   ? string(raw.method_version) : 'phase9_experimental_proxy',
  creator_explanation: semanticObservation ? string(raw.creator_explanation)
   : [value === null ? string(refs.assessment_reason) : '', phase9Limits[id], timingNotes].filter(Boolean).join(' '),
  evidence_refs: refs,
  timestamps: [...new Set([...hits, ...misses, ...(Array.isArray(raw.timestamps) ? raw.timestamps : [])])],
 };
}

export function phase9Presentation(input: unknown, v6?: unknown, sections: unknown[] = []) {
 const raw = record(input);
 if (raw.schema_version === '8.0.0-presentation' && v6 === undefined) return raw;
 const cards = record(record(record(v6).section_d_semantic_evaluation).scorecard);
 const aliases: Record<string,string> = {
  cuts_and_transitions: 'transitions', visual_measurements: 'visual_quality', storytelling_interpretation: 'storytelling_emotion',
 };
 return {
  ...raw,
  experimental_phase9: true,
  schema_version: '8.0.0-presentation',
  overall_score_0_10: raw.schema_version === '8.0.0-presentation' ? raw.overall_score_0_10 ?? null : null,
  overall_score_status: raw.schema_version === '8.0.0-presentation' ? raw.overall_score_status ?? 'NOT_YET_ASSESSED' : 'NOT_YET_ASSESSED',
  overall_score_method: raw.schema_version === '8.0.0-presentation' ? raw.overall_score_method : null,
  assessment_sections: Array.isArray(raw.assessment_sections) ? raw.assessment_sections.filter(input => record(input).section_id !== 'personalized_owner_fit').map(input => {
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
