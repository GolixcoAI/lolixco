import test from 'node:test';
import assert from 'node:assert/strict';
import {ASSESSMENT_IDS,parsePresentation,phase9Presentation} from '../src/components/studio/presentationV7.ts';
import {adaptStudioReport} from '../src/components/studio/studioAdapter.ts';
import {applyAnalysisEvent,INITIAL_ANALYSIS,progressPresentation} from '../src/components/studio/analysisProgress.ts';

const section = (id,score=null) => ({
 section_id:id,score_0_10:score,evidence_status:score===null?'NOT_YET_ASSESSED':'EVALUATED_SEMANTIC',
 method_version:'synthetic_test',timestamps:[1.25],creator_explanation:'Synthetic explanation',
});
const fixture = () => ({
 schema_version:'8.0.0-presentation',is_synthetic_fixture:true,
 assessment_sections:ASSESSMENT_IDS.map(id=>section(id,5.17)),
 overall_score_0_10:5.17,overall_score_status:'CALCULATED_EXPERIMENTAL_SIX',overall_score_method:'synthetic_six_test',
 context_evidence:{music_recognition:{status:'CONFLICT'}},
});

test('current presentation retains six ordered assessments and genuine overall provenance',()=>{
 const raw=fixture();raw.assessment_sections.reverse();
 const report=adaptStudioReport(raw);
 assert.equal(report.synthetic,true);
 assert.equal(report.ratings.categories.length,6);
 assert.equal(report.ratings.categories[0].explanation,'Synthetic explanation');
 assert.deepEqual(report.ratings.categories[0].timestamps,[1.25]);
 assert.equal(report.ratings.overall.score,5.17);
 assert.equal(report.music.status,'CONFLICT');
 assert.deepEqual(parsePresentation(raw).assessment_sections.map(item=>item.section_id),[...ASSESSMENT_IDS]);
});

test('historical seven-section reports hide owner fit and withhold the former composite',()=>{
 const historical=fixture();
 historical.schema_version='7.0.0-presentation';
 historical.assessment_sections.push(section('personalized_owner_fit',9.9));
 historical.context_evidence.media_notes=['Owner fit used an old model.','Video was inspected.'];
 const before=structuredClone(historical);
 const report=adaptStudioReport(historical);
 assert.equal(report.ratings.categories.length,6);
 assert.equal(report.ratings.overall.score,null);
 assert.deepEqual(report.mediaNotes,['Video was inspected.']);
 assert.ok(!JSON.stringify(report).toLowerCase().includes('owner fit'));
 assert.deepEqual(historical,before,'import preserves the underlying historical payload');
});

test('invalid, duplicate and unprovenanced overall ratings fail closed',()=>{
 const duplicate=fixture();duplicate.assessment_sections[1]=duplicate.assessment_sections[0];
 assert.throws(()=>parsePresentation(duplicate));
 const invalid=fixture();invalid.assessment_sections[0].score_0_10=92;
 assert.throws(()=>parsePresentation(invalid));
 const partial=fixture();partial.assessment_sections[5]=section(ASSESSMENT_IDS[5]);
 assert.throws(()=>parsePresentation(partial));
 partial.overall_score_0_10=null;partial.overall_score_status='NOT_YET_ASSESSED';
 assert.equal(parsePresentation(partial).ratings.overall.score,null);
 const unprovenanced=fixture();delete unprovenanced.overall_score_method;
 assert.throws(()=>parsePresentation(unprovenanced));
});

test('progressive evidence retains supported scores and ignores historical owner checkpoints',()=>{
 let state=applyAnalysisEvent(INITIAL_ANALYSIS,{job_id:'test',type:'QUEUED'});
 state=applyAnalysisEvent(state,{job_id:'test',type:'RUNNING'});
 state=applyAnalysisEvent(state,{job_id:'test',type:'SECTION_COMPLETED',section:section(ASSESSMENT_IDS[0],6.9)});
 const report=adaptStudioReport(progressPresentation(state));
 assert.equal(report.ratings.categories.filter(item=>item.score!==null).length,1);
 assert.equal(report.ratings.overall.score,null);
 const same=applyAnalysisEvent(state,{job_id:'test',type:'SECTION_UNASSESSED',section:section('personalized_owner_fit')});
 assert.deepEqual(same,state);
 assert.throws(()=>applyAnalysisEvent(state,{job_id:'other',type:'RUNNING'}));
 state=applyAnalysisEvent(state,{job_id:'test',type:'COMPLETE',report:fixture()});
 assert.throws(()=>applyAnalysisEvent(state,{job_id:'test',type:'RUNNING'}));
});

test('failure, cancellation and new job states cannot contaminate later media',()=>{
 const observed=applyAnalysisEvent(INITIAL_ANALYSIS,{job_id:'old',type:'SECTION_COMPLETED',section:section(ASSESSMENT_IDS[0],4.21)});
 const cancelled=applyAnalysisEvent(observed,{job_id:'old',type:'CANCELLED',message:'Cancelled'});
 assert.equal(adaptStudioReport(progressPresentation(cancelled)).ratings.overall.score,null);
 const next=applyAnalysisEvent(cancelled,{job_id:'new',type:'QUEUED'});
 assert.deepEqual(next.sections,{});
 assert.equal(next.report,null);
 const failed=applyAnalysisEvent(next,{job_id:'new',type:'FAILED',message:'Service failed'});
 assert.equal(failed.status,'FAILED');
});

test('legacy Phase9 proxy normalization preserves measurements while withholding artistic numbers',()=>{
 const raw=fixture();raw.schema_version='7.0.0-presentation';
 raw.assessment_sections.push(section('personalized_owner_fit',5.17));
 raw.overall_score_status='CALCULATED_EXPERIMENTAL_V9';
 raw.assessment_sections.forEach((item,index)=>{item.evidence_status=index<4?'MEASURED_SIGNAL':'EVALUATED_SEMANTIC_EXPERIMENTAL';});
 raw.assessment_sections[0].evidence_refs={primary_grid_tight_percent:95,observed_multi_sync_percent:56.5,z_score_significance:1.5,
  circular_shift_control:{diagnostic_label:'spacing_preserving_circular_shift',draw_count:500}};
 raw.assessment_sections[5].evidence_refs={shot_duration_entropy_bits:2.12};
 const result=adaptStudioReport(raw);
 assert.deepEqual(result.ratings.categories.map(item=>item.score),[5.17,5.17,5.17,5.17,null,null]);
 assert.deepEqual(result.ratings.categories[0].measurements,{observed_multi_sync_percent:56.5,
  circular_shift_control:{diagnostic_label:'spacing_preserving_circular_shift',draw_count:500}});
 assert.equal(result.ratings.categories[5].measurements.shot_duration_entropy_bits,2.12);
 assert.equal(result.ratings.overall.score,null);
});

test('current semantic rubrics work in all six dimensions without invented waveform precision',()=>{
 const methods=['gemini_audiovisual_rhythm_rubric_v1','gemini_transition_rubric_v1','gemini_pacing_rubric_v1',
  'gemini_visual_craft_rubric_v1','gemini_storytelling_rubric_v1','gemini_creative_execution_rubric_v1'];
 const raw=fixture();
 raw.assessment_sections.forEach((item,index)=>Object.assign(item,{
  evidence_status:'EXPERIMENTAL_SEMANTIC_SCORE',method_version:methods[index],
  evidence_refs:{provider_model:'fixture-model',assessment_scope:'Reviewed excerpt',supported_criteria:4},
 }));
 const result=parsePresentation(raw);
 assert.equal(result.experimental,true);
 assert.equal(result.ratings.categories.filter(item=>item.score!==null).length,6);
 let state=applyAnalysisEvent(INITIAL_ANALYSIS,{job_id:'semantic',type:'SECTION_COMPLETED',section:raw.assessment_sections[0]});
 assert.equal(adaptStudioReport(progressPresentation(state)).ratings.categories[0].score,5.17);
 raw.assessment_sections[0].method_version='unsupported';
 assert.throws(()=>parsePresentation(raw));
});

test('current v8 hybrid scores and overall survive final report adaptation',()=>{
 const raw=fixture();raw.experimental_phase9=true;
 const result=parsePresentation(phase9Presentation(raw));
 assert.equal(result.ratings.categories.length,6);
 assert.equal(result.ratings.overall.score,5.17);
});
