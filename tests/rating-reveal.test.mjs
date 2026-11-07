import test from 'node:test';
import assert from 'node:assert/strict';
import {
 adaptRatings, CATEGORY_LABELS, CHECKPOINT_MS, checkpointValue, sampleReactions, scoreAtCheckpoint, REACTION_POOL,
} from '../src/components/studio/ratingModel.ts';

const grade = score => ({score, status:'EVALUATED_SEMANTIC', provenance:'Synthetic test fixture'});
const report = {
 section_d_semantic_evaluation: {scorecard:{beat_synchronization:grade(6.9),transitions:grade(0),pacing:grade(10)}},
 section_e_personalized_model: {provenance:'test_fixture', overall_prediction:{predicted_score:5.17,status:'PERSONALIZED_ESTIMATE'}},
};

test('exact seven categories and supported 0–10 endpoints with two decimal presentation', () => {
 const ratings = adaptRatings(report);
 assert.equal(CATEGORY_LABELS.length, 7);
 assert.deepEqual(ratings.categories.slice(0, 3).map(item => item.score), [6.9, 0, 10]);
 assert.equal(ratings.overall.score.toFixed(2), '5.17');
});

test('missing, conflict, unsupported, out-of-range and unprovenanced grades are withheld', () => {
 assert.equal(adaptRatings({}).overall.score, null);
 for (const pacing of [grade(92),grade(NaN),{score:7,status:'CONFLICT',provenance:'test'},
  {score:7,status:'NOT_YET_ASSESSED',provenance:'test'},{score:7,status:'EVALUATED_SEMANTIC'}]) {
  assert.equal(adaptRatings({section_d_semantic_evaluation:{scorecard:{pacing}}}).categories[2].score, null);
 }
});

test('checkpoints ease to the true value on rising and falling needle motion', () => {
 let last = 8.5;
 for (let time = 0; time <= CHECKPOINT_MS; time += 10) {
  const value = checkpointValue(8.5, 4.79, time);
  assert.ok(value <= last && value >= 4.79);
  last = value;
 }
 assert.equal(last, 4.79);
 assert.equal(checkpointValue(4.79, 9.62, CHECKPOINT_MS), 9.62);
});

test('score readouts and fills share one bounded hundredth through the entire easing curve', () => {
 for (const target of [0, .01, 3.14, 8.12, 9.99, 10]) {
  let previous = 0;
  for (let elapsed = 0; elapsed <= CHECKPOINT_MS; elapsed += 1) {
   const score = scoreAtCheckpoint(target, elapsed);
   const text = score.toFixed(2);
   const fill = score / 10;
   assert.ok(score >= previous && score <= target);
   assert.ok(Math.abs(Number(text) / 10 - fill) < 1e-12);
   previous = score;
  }
  assert.equal(scoreAtCheckpoint(target, 0), 0);
  assert.equal(scoreAtCheckpoint(target, CHECKPOINT_MS), target);
 }
 const beginning = scoreAtCheckpoint(8.12, 80) - scoreAtCheckpoint(8.12, 20);
 const end = scoreAtCheckpoint(8.12, 530) - scoreAtCheckpoint(8.12, 470);
 assert.ok(beginning > end * 5, 'count-up slows as it approaches the actual score');
});

test('each reaction plan has seven distinct phrases and keeps the special verdict separate', () => {
 assert.equal(new Set(REACTION_POOL).size, 29);
 assert.ok(REACTION_POOL.includes("YOU'RE COOKING!"));
 assert.ok(REACTION_POOL.includes('SHUT UP!'));
 const strong = sampleReactions(Array(7).fill(9), () => .99);
 const weak = sampleReactions(Array(7).fill(2), () => .99);
 const unknown = sampleReactions(Array(7).fill(null), () => 0);
 for (const plan of [strong, weak, unknown]) {
  assert.equal(plan.length, 7);
  assert.equal(new Set(plan).size, 7);
  assert.ok(plan.every(word => REACTION_POOL.includes(word)));
 }
 assert.ok(strong.includes('SHUT UP!'));
 assert.ok(!strong.includes('COOKED!'));
 assert.ok(weak.includes('COOKED!'));
 assert.ok(!weak.includes('COOKING!'));
 assert.ok(!weak.includes('CLEAN!') && !weak.includes('HARD!'));
 for (let index = 0; index < 20; index++) {
  assert.ok(sampleReactions(Array(7).fill(0), () => index / 20).every(word => !['CLEAN!', 'HARD!', 'THAT HIT!', 'COOKING!', 'SHUT UP!'].includes(word)));
 }
 assert.ok(!REACTION_POOL.includes('FINAL VERDICT!'));
});

test('subsequent reaction plans vary while the whole library remains reachable', () => {
 let seed = 47;
 const random = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
 };
 const plans = Array.from({length: 100}, () => sampleReactions(Array(7).fill(5), random));
 assert.equal(new Set(plans.map(plan => plan.join('|'))).size, 100);
 assert.deepEqual(new Set(plans.flat()), new Set(REACTION_POOL));
});
