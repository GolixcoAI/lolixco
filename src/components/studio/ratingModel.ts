export const CATEGORY_KEYS = ['beat_synchronization','transitions','pacing','visual_quality','storytelling_emotion','originality_creativity'] as const;
export const CATEGORY_LABELS = ['Beat Synchronization / Audiovisual Rhythm','Cuts & Transitions','Pacing','Visual Craftsmanship','Storytelling & Coherence','Creative Execution & Impact'];
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
 const semanticMethods = ['gemini_audiovisual_rhythm_rubric_v1','gemini_transition_rubric_v1','gemini_pacing_rubric_v1','gemini_visual_craft_rubric_v1','gemini_storytelling_rubric_v1','gemini_creative_execution_rubric_v1'];
 const semanticMethod = semanticMethods[CATEGORY_KEYS.indexOf(key as typeof CATEGORY_KEYS[number])];
 const semantic = status === 'EXPERIMENTAL_SEMANTIC_SCORE' && !!semanticMethod && (method === semanticMethod || method === 'gemini_six_dimension_rubric_v1')
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
 const physical = obj(raw.section_c_physical_signals);
 const cards = {...obj(physical.scorecard), ...obj(semantic.scorecard)};
 return {
  categories: CATEGORY_KEYS.map(key => rating(cards[key] ?? semantic[key], semantic, key)),
  overall: {score:null,status:'NOT_YET_ASSESSED',provenance:''},
 };
}
export const EMPTY_RATINGS:Ratings={categories:CATEGORY_KEYS.map(()=>({score:null,status:'NOT_YET_ASSESSED',provenance:''})),overall:{score:null,status:'NOT_YET_ASSESSED',provenance:''}};
const DEMO_SCORES = [6.9,5.17,7.17,4.79,3.14,8.12];
export const DEMO_RATINGS: Ratings = {
 categories: DEMO_SCORES.map(score => ({score,status:'DEMO',provenance:'Synthetic visual-review fixture'})),
 overall: {
  score: Math.round(DEMO_SCORES.reduce((sum, score) => sum + score, 0) / DEMO_SCORES.length * 100) / 100,
  status:'DEMO',provenance:'Equal-weight mean of six synthetic scores',
 },
};
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
