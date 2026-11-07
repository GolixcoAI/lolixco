import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inspectReleaseBuild} from '../scripts/check-release-build.mjs';

test('production build inspection rejects local endpoints and secret values without echoing them', () => {
 const root=mkdtempSync(join(tmpdir(),'lolixco-build-check-'));
 try {
  writeFileSync(join(root,'index.html'),'<title>Lolixco</title><meta name="description" content="Discover edits.">');
  mkdirSync(join(root,'assets'));
  writeFileSync(join(root,'assets','app.js'),'fetch("/api/v8/health")');
  assert.deepEqual(inspectReleaseBuild(root).violations,[]);
  writeFileSync(join(root,'assets','bad.js'),'fetch("http://127.0.0.1:5055/api/v8"); const key="AIza'+'SYNTHETIC_SECRET_WITH_ENOUGH_CHARACTERS'+'";');
  const result=inspectReleaseBuild(root);
  assert.deepEqual(result.violations.map(item=>item.code),['loopback_url','google_api_key']);
  assert.ok(!JSON.stringify(result).includes('SYNTHETIC_SECRET'));
  symlinkSync(join(root,'index.html'),join(root,'unexpected.html'));
  assert.ok(inspectReleaseBuild(root).violations.some(item=>item.code==='unexpected_symlink'));
 } finally {rmSync(root,{recursive:true,force:true});}
});
