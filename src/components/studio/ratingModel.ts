export const CATEGORY_KEYS = ['beat_synchronization','transitions','pacing','visual_quality','storytelling_emotion','originality_creativity','owner_fit'] as const;
export const CATEGORY_LABELS = ['Beat synchronization','Cuts & transitions','Pacing','Visual measurements','Storytelling interpretation','Originality / creative execution','Personalized owner fit'];
export type Rating = {score:number|null;status:string;provenance:string;explanation?:string;limitations?:string[];timestamps?:number[];measurements?:Record<string,unknown>};
export type Ratings = {categories:Rating[];overall:Rating};
const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
function rating(value: unknown, parent: Record<string, unknown>, key = ''): Rating {
 const field = obj(value);
 const status = typeof field.status === 'string' ? field.status : 'NOT_YET_ASSESSED';
 const method = typeof field.method_version === 'string' ? field.method_version : '';
 const provenance = typeof field.provenance === 'string' ? field.provenance
  : method || (typeof parent.provenance === 'string' ? parent.provenance : '');
 const candidate = field.score ?? field.score_0_10 ?? field.predicted_score;
 const measurements = obj(field.metric_details || field.evidence_refs);
 const semanticMethod = key === 'storytelling_emotion' ? 'gemini_storytelling_rubric_v1'
  : key === 'originality_creativity' ? 'gemini_creative_execution_rubric_v1' : '';
 const semantic = status === 'EXPERIMENTAL_SEMANTIC_SCORE' && !!semanticMethod && method === semanticMethod
  && typeof measurements.supported_criteria === 'number' && measurements.supported_criteria >= 3
  && typeof measurements.provider_model === 'string' && !!measurements.provider_model;
 const supported = ['EVALUATED_SEMANTIC', 'PERSONALIZED_ESTIMATE', 'MEASURED_SIGNAL'].includes(status) || semantic;
 return {
  score: typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0 && candidate <= 10
   && supported && !!provenance ? candidate : null,
  status, provenance, measurements,
  explanation: typeof field.notes === 'string' ? field.notes : typeof field.creator_explanation === 'string' ? field.creator_explanation : undefined,
  limitations: Array.isArray(field.limitations) ? field.limitations.filter((item): item is string => typeof item === 'string') : [],
  timestamps: Array.isArray(field.timestamps) ? field.timestamps.filter((time): time is number => typeof time === 'number' && Number.isFinite(time) && time >= 0) : [],
 };
}

export function adaptRatings(input: unknown): Ratings {
 const raw = obj(input);
 const semantic = obj(raw.section_d_semantic_evaluation);
 const personal = obj(raw.section_e_personalized_model);
 const physical = obj(raw.section_c_physical_signals);
 const cards = {...obj(physical.scorecard), ...obj(semantic.scorecard), ...obj(personal.scorecard)};
 return {
  categories: CATEGORY_KEYS.map(key => rating(key === 'owner_fit' ? personal.owner_fit : cards[key] ?? semantic[key], key === 'owner_fit' ? personal : semantic, key)),
  overall: rating(personal.overall_prediction ?? semantic.overall_prediction, personal.overall_prediction ? personal : semantic),
 };
}
export const EMPTY_RATINGS:Ratings={categories:CATEGORY_KEYS.map(()=>({score:null,status:'NOT_YET_ASSESSED',provenance:''})),overall:{score:null,status:'NOT_YET_ASSESSED',provenance:''}};
export const DEMO_RATINGS:Ratings={categories:[6.9,5.17,7.17,4.79,3.14,8.12,5.42].map(score=>({score,status:'DEMO',provenance:'Synthetic visual-review fixture'})),overall:{score:5.17,status:'DEMO',provenance:'Synthetic visual-review fixture'}};
export const easeOut=(n:number)=>1-Math.pow(1-Math.max(0,Math.min(1,n)),3);
export const CHECKPOINT_MS = 620;
export const FINISH_MS = 850;

export function checkpointValue(from: number, to: number, elapsed: number) {
 return from + (to - from) * easeOut(elapsed / (CHECKPOINT_MS * 0.9));
}

export const REACTION_POOL = [
 'CLEAN!', 'SHEESH!', 'THAT HIT!', 'SMOOTH!', 'NICE!', 'HARD!', "LET'S GO!", 'WILD!',
 'HEAT!', 'TOO CLEAN!', 'SOLID!', 'BANG!', 'SHARP!', 'FIREEE!', 'YOO!', 'COLD!', 'OOF!',
 'BRUH!', 'TOUGH!', 'IN FOCUS!', 'TAKE NOTE!', 'HOLD UP!', 'CHECK THIS!', 'STEADY!',
 'RESET!', 'COOKING!', 'COOKED!', "YOU'RE COOKING!", 'SHUT UP!',
] as const;

const WEAK_REACTIONS = new Set(['OOF!', 'BRUH!', 'RESET!', 'COOKED!']);
const WEAK_SCORE_POOL = new Set(['IN FOCUS!', 'TAKE NOTE!', 'HOLD UP!', 'CHECK THIS!', 'STEADY!', 'SOLID!', 'SHARP!', 'TOUGH!', 'NICE!', ...WEAK_REACTIONS]);

export function scoreAtCheckpoint(target: number, elapsed: number, from = 0) {
 const value = checkpointValue(from, target, elapsed);
 const hundredths = Math.round(Math.max(0, Math.min(10, value)) * 100);
 return hundredths / 100;
}

export function sampleReactions(scores: readonly (number | null)[], random = Math.random): string[] {
 const remaining = [...REACTION_POOL] as string[];
 return scores.map(score => {
  const eligible = remaining.filter(word => score === null
   ? !WEAK_REACTIONS.has(word)
   : score >= 6 ? !WEAK_REACTIONS.has(word)
   : score < 4 ? WEAK_SCORE_POOL.has(word) : true);
  const pool = eligible.length ? eligible : remaining;
  const index = Math.min(pool.length - 1, Math.floor(Math.max(0, random()) * pool.length));
  const word = pool[index];
  remaining.splice(remaining.indexOf(word), 1);
  return word;
 });
}
