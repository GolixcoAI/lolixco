import test from 'node:test';
import assert from 'node:assert/strict';
import {readAnalysisPrivacy, saveAnalysisPrivacy, DEFAULT_ANALYSIS_PRIVACY, ANALYSIS_PRIVACY_KEY} from '../src/components/studio/analysisPrivacy.ts';
import {analysisFailure, analysisStage} from '../src/components/studio/analysisMessages.ts';

test('missing, obsolete and invalid permissions require a new choice',()=>{
 for(const value of [null,'invalid','{}',JSON.stringify({version:0,files:'allow',youtube:'allow'}),JSON.stringify({version:1,files:'yes',youtube:'allow'})]){
  assert.deepEqual(readAnalysisPrivacy({getItem:()=>value}),DEFAULT_ANALYSIS_PRIVACY);
 }
});

test('public-link permission does not authorize files, and withdrawal is remembered',()=>{
 let stored=null;
 const storage={getItem:()=>stored,setItem:(key,value)=>{assert.equal(key,ANALYSIS_PRIVACY_KEY);stored=value;}};
 saveAnalysisPrivacy({version:1,files:'ask',youtube:'allow'},storage);
 assert.equal(readAnalysisPrivacy(storage).files,'ask');
 assert.equal(readAnalysisPrivacy(storage).youtube,'allow');
 saveAnalysisPrivacy({...readAnalysisPrivacy(storage),files:'decline'},storage);
 assert.equal(readAnalysisPrivacy(storage).files,'decline');
 assert.equal(readAnalysisPrivacy(storage).youtube,'allow');
});

test('blocked browser storage fails safely without inventing permission',()=>{
 assert.deepEqual(readAnalysisPrivacy({getItem:()=>{throw Error('blocked');}}),DEFAULT_ANALYSIS_PRIVACY);
 assert.doesNotThrow(()=>saveAnalysisPrivacy({version:1,files:'decline',youtube:'ask'},{setItem:()=>{throw Error('blocked');}}));
});

test('service diagnostics never become public filesystem paths or provider bodies',()=>{
 const privateDiagnostic='Traceback /home/private/secret.py API_KEY_INVALID sensitive-body';
 for(const [status,path]of[[500,'health'],[404,'jobs/job_1/report'],[422,'media'],[401,'youtube/start'],[429,'youtube/start']]){
  const message=analysisFailure('authentication_failed',privateDiagnostic,status,path);
  assert.ok(!message.includes('/home/')&&!message.includes('sensitive-body')&&!message.includes('API_KEY'));
 }
 assert.match(analysisFailure('',privateDiagnostic,404,'jobs/job_1'),/report isn't available/);
 assert.match(analysisFailure('video_unavailable'),/YouTube video isn't available/);
 assert.match(analysisFailure('', '',413,'media'),/100 MiB/);
 assert.match(analysisFailure('media_too_long'),/two minutes/);
 assert.doesNotMatch(analysisFailure('duration_limit','Duration must be between 0 and 120 seconds.'),/longer than/);
});

test('visible progress describes the work without exposing research or provider setup',()=>{
 assert.equal(analysisStage('Preparing analysis rendition','RUNNING'),'Preparing your video');
 assert.equal(analysisStage('Reviewing consented audiovisual rhythm','RUNNING'),'Reviewing rhythm');
 assert.equal(analysisStage('Analysis complete with partial evidence','COMPLETE'),'Your feedback is ready');
 assert.equal(analysisStage('Phase 9 internal worker step','RUNNING'),'Analyzing your edit');
});
