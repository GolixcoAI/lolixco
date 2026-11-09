import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { resolveAppView, parseUrlParams, syncUrl } from '../src/App.tsx';
import Sidebar from '../src/components/layout/Sidebar.tsx';
import Header from '../src/components/layout/Header.tsx';
import HelpSupport from '../src/components/help/HelpSupport.tsx';
import { SUPPORT_CONTACT } from '../src/config/support.ts';
import { setupMountedDom } from './mounted-dom.mjs';

test('known deep links resolve while unknown paths and retired settings get a 404 surface', () => {
 assert.equal(resolveAppView('/', ''), 'Home');
 assert.equal(resolveAppView('/studio', ''), 'Creator Studio');
 assert.equal(resolveAppView('/help/', ''), 'Help & Support');
 assert.equal(resolveAppView('/', 'HELP'), 'Help & Support');
 assert.equal(resolveAppView('/lolixco/shorts', '', '/lolixco/'), 'Shorts');
 for (const [path,view] of [['/missing',''],['/missing','studio'],['/','settings'],['/settings','']]) {
  assert.equal(resolveAppView(path,view), 'Not Found');
 }
});

test('Studio normalization preserves an explicit privacy request and report identity', async () => {
 const env=setupMountedDom('http://127.0.0.1:5173/studio?analysisJob=job_123_abcdef&privacy=processing');
 try {
  assert.equal(parseUrlParams().view,'Creator Studio');
  syncUrl('All','','','Creator Studio',null,false);
  assert.equal(env.historyState.pathname,'/');
  assert.equal(env.historyState.search,'?view=studio&analysisJob=job_123_abcdef&privacy=processing');
  syncUrl('All','','','Help & Support',null,true);
  assert.equal(env.historyState.search,'?view=help');
 } finally { await env.cleanup(); }
});

test('product navigation has beta branding, real support and no Settings placeholder', () => {
 const nav=renderToStaticMarkup(React.createElement(Sidebar,{active:'Home',onSelect:()=>{}}));
 assert.ok(nav.includes('Help &amp; Support'));
 assert.ok(!nav.includes('Settings'));
 const header=renderToStaticMarkup(React.createElement(Header,{expanded:false,toggle:()=>{},query:'',setQuery:()=>{},onHome:()=>{},open:()=>{}}));
 assert.equal((header.match(/class="brand-beta"/g)||[]).length,1);
 assert.ok(!header.includes('aria-label="Help &amp; Support"'));
 assert.ok(nav.includes('aria-label="Help &amp; Support"'));
});

test('Help states exact limits, incomplete-score policy and provider terms with owner-verified support contact', () => {
 const html=renderToStaticMarkup(React.createElement(HelpSupport));
 assert.ok(html.includes('100 MiB (104,857,600 bytes)'));
 assert.ok(html.includes('Missing scores are not zeroes'));
 assert.ok(html.includes('https://ai.google.dev/gemini-api/terms'));
 assert.ok(html.includes('?view=studio&amp;privacy=processing'));
 assert.ok(!("active" in SUPPORT_CONTACT));
 assert.ok(html.includes('href="mailto:support@golixco.com"'));
 assert.equal((html.match(/<dt>/g)||[]).length,6);
});
