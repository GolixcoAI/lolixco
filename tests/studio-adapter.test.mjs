import test from 'node:test';import assert from 'node:assert/strict';import{adaptStudioReport,evidenceStatus}from'../src/components/studio/studioAdapter.ts';
const base={schema_version:'6.0.0',section_a_visual_recognition:{status:'UNKNOWN',provenance:'matcher'},section_b_music_recognition:{status:'CONFLICT',matched_track:{title:'Unverified guess'},provenance:'resolver'},section_c_physical_signals:{provenance:'measured_signal',duration_sec:12,cut_timestamps:[2,5,-1,'fake']},section_d_semantic_evaluation:{status:'NOT_YET_ASSESSED',provenance:'unassessed'},section_e_personalized_model:{status:'NOT_YET_ASSESSED',provenance:'personalized_estimate'}};
test('v6 adapter retains measured facts and does not reveal conflicting music as identification',()=>{const r=adaptStudioReport(base);assert.equal(r.music.status,'CONFLICT');assert.ok(!r.music.value.includes('Unverified guess'));assert.deepEqual(r.scenes.map(x=>x.time),[2,5]);assert.ok(r.evidence.some(x=>x.label==='duration sec'&&x.value==='12'&&x.status==='MEASURED'));});
test('missing grades stay unassessed and unsupported schemas fail closed',()=>{assert.ok(adaptStudioReport(base).evidence.some(x=>x.status==='NOT ASSESSED'));assert.throws(()=>adaptStudioReport({schema_version:'5'}));assert.equal(evidenceStatus('invented'),'UNKNOWN');});

test('canonical semantic rubric scores retain their evidence and method while other ratings stay empty', () => {
 const report = structuredClone(base);
 report.section_d_semantic_evaluation = {
  status:'EVALUATED_SEMANTIC_EXPERIMENTAL',provenance:'gemini_semantic_experimental',
  scorecard:{storytelling_emotion:{score:7.5,status:'EXPERIMENTAL_SEMANTIC_SCORE',
   method_version:'gemini_storytelling_rubric_v1',notes:'Synthetic timestamped narrative cue',timestamps:[2,8],
   metric_details:{supported_criteria:4,provider_model:'fixture-model',assessment_scope:'Reviewed excerpt'},
  }},
 };
 const result = adaptStudioReport(report);
 assert.equal(result.ratings.categories[4].score,7.5);
 assert.equal(result.ratings.categories[4].provenance,'gemini_storytelling_rubric_v1');
 assert.deepEqual(result.ratings.categories[4].timestamps,[2,8]);
 assert.equal(result.ratings.overall.score,null);
 report.section_d_semantic_evaluation.scorecard.storytelling_emotion.method_version='unsupported';
 assert.equal(adaptStudioReport(report).ratings.categories[4].score,null);
});
