import test from 'node:test';
import assert from 'node:assert/strict';
import React, {act} from 'react';
import {setupMountedDom} from './mounted-dom.mjs';
import VideoPlayer from '../src/components/video/VideoPlayer.tsx';
import {edits} from '../src/data/edits.ts';
import {setSessionMuted, useSessionAudio} from '../src/hooks/useSessionAudio.ts';

test('Shuffle source changes retain the native element and container while clearing media markers', async()=>{
 const env=setupMountedDom();setSessionMuted(true);
 try{
 await act(async()=>env.root.render(React.createElement(VideoPlayer,{edit:edits[0]})));
 const video=env.container.querySelectorAll('video')[0];const player=env.container.querySelectorAll('div').find(x=>x.getAttribute('aria-label')?.includes('video player'));
 await act(async()=>{setSessionMuted(false)});
 await act(async()=>env.root.render(React.createElement(VideoPlayer,{edit:{...edits[1],source:'/media/another.webm'}})));
 assert.equal(env.container.querySelectorAll('video')[0],video);
 assert.equal(env.container.querySelectorAll('div').find(x=>x.getAttribute('aria-label')?.includes('video player')),player);
 assert.equal(video.muted,false);
 }finally{await env.cleanup();setSessionMuted(true)}
});

test('Session audio subscribers inherit explicit preference and manual mute across remounts',async()=>{
 const env=setupMountedDom();setSessionMuted(true);const seen=[];
 function Probe(){const [muted]=useSessionAudio();seen.push(muted);return null}
 try{
 await act(async()=>env.root.render(React.createElement(Probe)));
 assert.equal(seen.at(-1),true);
 await act(async()=>setSessionMuted(false));assert.equal(seen.at(-1),false);
 await act(async()=>env.root.render(null));await act(async()=>env.root.render(React.createElement(Probe)));assert.equal(seen.at(-1),false);
 await act(async()=>setSessionMuted(true));assert.equal(seen.at(-1),true);
 }finally{await env.cleanup();setSessionMuted(true)}
});
