import test from'node:test';import assert from'node:assert/strict';import{V7_IDS,parsePresentation}from'../src/components/studio/presentationV7.ts';import{adaptStudioReport}from'../src/components/studio/studioAdapter.ts';import{applyAnalysisEvent,INITIAL_ANALYSIS,progressPresentation}from'../src/components/studio/analysisProgress.ts';import{REACTION_POOL,selectReactions,DEMO_RATINGS}from'../src/components/studio/ratingModel.ts';
const section=(id,score=null)=>({section_id:id,score_0_10:score,evidence_status:score===null?'NOT_YET_ASSESSED':'EVALUATED_SEMANTIC',method_version:'synthetic_test',timestamps:[1.25],creator_explanation:'Synthetic explanation'});
const fixture=()=>({schema_version:'7.0.0-presentation',is_synthetic_fixture:true,assessment_sections:V7_IDS.map(id=>section(id,5.17)),overall_score_0_10:5.17,overall_score_status:'CALCULATED_SEMANTIC',overall_score_method:'synthetic_test',context_evidence:{music_recognition:{status:'CONFLICT'}}});
test('Phase7 retains exact dimension order, status, explanation, timestamps and synthetic labeling',()=>{const f=fixture();f.assessment_sections.reverse();const r=adaptStudioReport(f);assert.equal(r.synthetic,true);assert.equal(r.ratings.categories.length,7);assert.equal(r.ratings.categories[0].explanation,'Synthetic explanation');assert.deepEqual(r.ratings.categories[0].timestamps,[1.25]);assert.equal(r.ratings.overall.score,5.17);assert.equal(r.music.status,'CONFLICT');assert.deepEqual(parsePresentation(f).assessment_sections.map(s=>s.section_id),[...V7_IDS]);});
test('invalid and duplicate scores fail closed; unavailable overall remains null',()=>{const f=fixture();f.assessment_sections[1]=f.assessment_sections[0];assert.throws(()=>parsePresentation(f));const b=fixture();b.assessment_sections[0].score_0_10=92;assert.throws(()=>parsePresentation(b));const p=fixture();p.overall_score_0_10=null;p.overall_score_status='NOT_YET_ASSESSED';p.assessment_sections[6]=section('personalized_owner_fit');assert.equal(parsePresentation(p).ratings.overall.score,null);assert.equal(parsePresentation(p).ratings.categories[6].score,null);});
test('actual progressive events reveal partial evidence without inventing completion or overall score',()=>{let s=applyAnalysisEvent(INITIAL_ANALYSIS,{job_id:'test',type:'QUEUED'});s=applyAnalysisEvent(s,{job_id:'test',type:'RUNNING'});s=applyAnalysisEvent(s,{job_id:'test',type:'SECTION_COMPLETED',section:section(V7_IDS[0],6.9)});const r=adaptStudioReport(progressPresentation(s));assert.equal(r.ratings.categories.filter(x=>x.score!==null).length,1);assert.equal(r.ratings.overall.score,null);s=applyAnalysisEvent(s,{job_id:'test',type:'SECTION_UNASSESSED',section:section(V7_IDS[1])});assert.equal(s.status,'SECTION_UNASSESSED');assert.throws(()=>applyAnalysisEvent(s,{job_id:'other',type:'RUNNING'}));s=applyAnalysisEvent(s,{job_id:'test',type:'COMPLETE',report:fixture()});assert.equal(s.status,'COMPLETE');assert.throws(()=>applyAnalysisEvent(s,{job_id:'test',type:'RUNNING'}));});
test('28 unique reactions keep cooking positive and cooked weak',()=>{assert.equal(REACTION_POOL.length,28);assert.equal(new Set(REACTION_POOL).size,28);const strong={...DEMO_RATINGS,categories:DEMO_RATINGS.categories.map(x=>({...x,score:9}))};const weak={...strong,categories:strong.categories.map(x=>({...x,score:2}))};assert.ok(!selectReactions(strong,()=>.99).includes('COOKED!'));const words=selectReactions(weak,()=>.99);assert.equal(new Set(words).size,6);assert.ok(words.includes('COOKED!'));assert.ok(!words.includes('COOKING!')&&!words.includes("YOU'RE COOKING!"));});
test('failure events remain explicit and a newly queued job clears old findings',()=>{const running=applyAnalysisEvent(INITIAL_ANALYSIS,{job_id:'test',type:'RUNNING'});const failed=applyAnalysisEvent(running,{job_id:'test',type:'FAILED',message:'Supplied service failure'});assert.equal(failed.status,'FAILED');assert.equal(progressPresentation(failed),null);const fresh=applyAnalysisEvent(failed,{job_id:'next',type:'QUEUED'});assert.equal(fresh.jobId,'next');assert.deepEqual(fresh.sections,{});assert.equal(fresh.report,null);});
test('cancelled service jobs are terminal and retain already observed findings',()=>{const s=applyAnalysisEvent(INITIAL_ANALYSIS,{job_id:'cancel',type:'SECTION_COMPLETED',section:section(V7_IDS[0],4.21)});const end=applyAnalysisEvent(s,{job_id:'cancel',type:'CANCELLED',message:'Service acknowledged cancellation'});assert.equal(end.status,'CANCELLED');assert.equal(adaptStudioReport(progressPresentation(end)).ratings.overall.score,null);assert.throws(()=>applyAnalysisEvent(end,{job_id:'cancel',type:'RUNNING'}));});

test('Phase 9 exposes experimental proxies while withholding artistic and composite grades', () => {
 const raw = fixture();
 raw.overall_score_status = 'CALCULATED_EXPERIMENTAL_V9';
 raw.assessment_sections.forEach((s, index) => {
  s.evidence_status = index < 4 ? 'MEASURED_SIGNAL' : 'EVALUATED_SEMANTIC_EXPERIMENTAL';
  s.creator_explanation = 'Unsupported significance claim';
 });
 raw.assessment_sections[0].evidence_refs = {
  primary_grid_tight_percent: 95, observed_multi_sync_percent: 56.5, z_score_significance: 1.5,
 };
 raw.assessment_sections[0].best_synchronized_moments = [{timestamp_sec: 3.267}];
 const result = adaptStudioReport(raw);
 assert.equal(result.experimental, true);
 assert.deepEqual(result.ratings.categories.map(r => r.score), [5.17, 5.17, 5.17, 5.17, null, null, null]);
 assert.equal(result.ratings.categories[0].status, 'EXPERIMENTAL_PROXY');
 assert.deepEqual(result.ratings.categories[0].measurements, {observed_multi_sync_percent: 56.5});
 assert.deepEqual(result.ratings.categories[0].timestamps, [3.267, 1.25]);
 assert.doesNotMatch(result.ratings.categories[0].explanation, /Unsupported significance claim/);
 assert.equal(result.ratings.overall.score, null);
});

test('Phase 9 preserves entropy and circular-shift diagnostics as descriptive measurements', () => {
 const raw = fixture();
 raw.overall_score_status = 'CALCULATED_EXPERIMENTAL_V9';
 raw.assessment_sections[0].evidence_refs = {
  observed_multi_sync_percent: 56.5,
  circular_shift_control: {
   diagnostic_label: 'spacing_preserving_circular_shift',
   draw_count: 500,
   ties_or_exceedances: 55,
  },
 };
 raw.assessment_sections[5].evidence_refs = {
  shot_duration_entropy_bits: 2.12,
  max_possible_entropy_bits: 3.0,
  descriptor: 'Clustered duration distribution with accent holds',
 };
 const result = adaptStudioReport(raw);
 assert.deepEqual(result.ratings.categories[0].measurements, {
  observed_multi_sync_percent: 56.5,
  circular_shift_control: {
   diagnostic_label: 'spacing_preserving_circular_shift',
   draw_count: 500,
   ties_or_exceedances: 55,
  },
 });
 assert.deepEqual(result.ratings.categories[5].measurements, {
  shot_duration_entropy_bits: 2.12,
  max_possible_entropy_bits: 3.0,
  descriptor: 'Clustered duration distribution with accent holds',
 });
 const evidenceLabels = result.evidence.map(e => e.label);
 assert.ok(evidenceLabels.includes('diagnostic label'));
 assert.ok(evidenceLabels.includes('shot duration entropy bits'));
});
