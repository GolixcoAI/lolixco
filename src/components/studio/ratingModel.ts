export const CATEGORY_KEYS = ['beat_synchronization','transitions','pacing','visual_quality','storytelling_emotion','originality_creativity','owner_fit'] as const;
export const CATEGORY_LABELS = ['Beat synchronization','Cuts & transitions','Pacing','Visual measurements','Storytelling interpretation','Originality / creative execution','Personalized owner fit'];
export type Rating = {score:number|null;status:string;provenance:string;explanation?:string;limitations?:string[];timestamps?:number[];measurements?:Record<string,unknown>};
export type Ratings = {categories:Rating[];overall:Rating};
const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
function rating(v:unknown,parent:Record<string,unknown>):Rating{const f=obj(v);const status=typeof f.status==='string'?f.status:'NOT_YET_ASSESSED';const provenance=typeof f.provenance==='string'?f.provenance:typeof parent.provenance==='string'?parent.provenance:'';const score=f.score??f.predicted_score;return {score:typeof score==='number'&&Number.isFinite(score)&&score>=0&&score<=10&&['EVALUATED_SEMANTIC','PERSONALIZED_ESTIMATE','MEASURED_SIGNAL'].includes(status)&&!!provenance?score:null,status,provenance};}
export function adaptRatings(input:unknown):Ratings{const r=obj(input);const d=obj(r.section_d_semantic_evaluation);const e=obj(r.section_e_personalized_model);const c=obj(r.section_c_physical_signals);const cards={...obj(c.scorecard),...obj(d.scorecard),...obj(e.scorecard)};return{categories:CATEGORY_KEYS.map(k=>rating(k==='owner_fit'?e.owner_fit:cards[k]??d[k],k==='owner_fit'?e:d)),overall:rating(e.overall_prediction??d.overall_prediction,e.overall_prediction?e:d)};}
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
const STRONG_REACTIONS = new Set(['COOKING!', "YOU'RE COOKING!", 'FIREEE!', 'TOO CLEAN!', 'SHUT UP!']);

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
   : score < 4 ? !STRONG_REACTIONS.has(word) : true);
  const pool = eligible.length ? eligible : remaining;
  const index = Math.min(pool.length - 1, Math.floor(Math.max(0, random()) * pool.length));
  const word = pool[index];
  remaining.splice(remaining.indexOf(word), 1);
  return word;
 });
}
