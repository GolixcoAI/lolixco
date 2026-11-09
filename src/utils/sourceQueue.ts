import type {Edit} from '../data/edits';

const unavailable = new Map<number, number>();
export function markUnavailable(edit: Edit) {unavailable.set(edit.id, Date.now() + 10 * 60_000);}
export function playbackEligible(edit: Edit) {return (unavailable.get(edit.id) ?? 0) <= Date.now();}
export function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296;};
}

/** Weighted draws without replacement; cap source streaks while alternatives exist.
 * Candidates must already satisfy the caller's category/orientation/relevance filter.
 */
export function sourceQueue(candidates: readonly Edit[], random = Math.random, history: readonly Edit[] = []): Edit[] {
  const pool = [...new Map(candidates.filter(playbackEligible).map(edit => [edit.id, edit])).values()];
  const result: Edit[] = [];
  const tail = [...history.slice(-2)];
  while (pool.length) {
    const last = tail.at(-1);
    const streak = tail.length > 1 && tail.at(-2)?.sourceType === last?.sourceType;
    let eligible = pool.map((edit,index)=>({edit,index}));
    const different = eligible.filter(x => x.edit.sourceType !== last?.sourceType);
    if (streak && different.length) eligible = different;
    const notRepeated = eligible.filter(x=>x.edit.id !== last?.id);
    if (notRepeated.length) eligible = notRepeated;
    const chosen = eligible[Math.min(eligible.length-1, Math.floor(random()*eligible.length))];
    pool.splice(chosen.index,1);
    result.push(chosen.edit); tail.push(chosen.edit);
    if (tail.length>2) tail.shift();
  }
  return result;
}
