import test from 'node:test';
import assert from 'node:assert/strict';
import {
 adaptRatings, CATEGORY_LABELS, CHECKPOINT_MS, checkpointValue, pickReaction, REACTION_POOL,
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

test('comic pool preserves the prior reactions and supports seven distinct checkpoints', () => {
 assert.equal(new Set(REACTION_POOL).size, 29);
 assert.ok(REACTION_POOL.includes("YOU'RE COOKING!"));
 const strong = new Set(), weak = new Set();
 for (let i = 0; i < 7; i++) {
  pickReaction(9, strong, () => .99);
  pickReaction(2, weak, () => .99);
 }
 assert.equal(strong.size, 7);
 assert.equal(weak.size, 7);
 assert.ok(strong.has('SHUT UP!'));
 assert.ok(!strong.has('COOKED!'));
 assert.ok(weak.has('COOKED!'));
 assert.ok(!weak.has('COOKING!'));
 assert.ok(!REACTION_POOL.includes('FINAL VERDICT'));
});
