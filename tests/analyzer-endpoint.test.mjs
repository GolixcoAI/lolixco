import test from 'node:test';
import assert from 'node:assert/strict';
import {analysisFeatureEnabled, analyzerApiPath, developerAnalyzerToolsEnabled} from '../src/config/analyzerEndpoint.ts';

test('public analysis requires an explicit deployment flag and uses the same origin', () => {
 assert.equal(analysisFeatureEnabled({DEV:false}), false);
 assert.equal(analysisFeatureEnabled({DEV:false,VITE_ANALYSIS_ENABLED:'true'}), true);
 assert.equal(analysisFeatureEnabled({DEV:false,VITE_ANALYSIS_ENABLED:'https://remote.invalid'}), false);
 assert.equal(analysisFeatureEnabled({DEV:true}), true);
 assert.equal(analyzerApiPath('jobs/job_1794060190_cb6076/report/presentation'), '/api/v8/jobs/job_1794060190_cb6076/report/presentation');
 assert.equal(developerAnalyzerToolsEnabled(), false);
});

test('analysis paths cannot select a host or escape their API namespace', () => {
 for (const path of ['https://remote.invalid/health','//remote.invalid/health','/health','../health','jobs/../../admin','jobs/%2e%2e/admin','health?host=remote.invalid','health#fragment']) {
  assert.throws(() => analyzerApiPath(path), /unavailable/);
 }
});
