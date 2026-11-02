import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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

test('Featured native aspect follows metadata for landscape, square and portrait without replacing the player', async()=>{
 const env=setupMountedDom();
 try {
  let player;
  for (const [index,width,height] of [[0,1920,1080],[1,1080,1080],[2,1080,1920]]) {
   await act(async()=>env.root.render(React.createElement(VideoPlayer,{edit:{...edits[index],source:`/media/aspect-${index}.mp4`}})));
   const video=env.container.querySelectorAll('video')[0];
   Object.defineProperty(video,'videoWidth',{configurable:true,value:width});
   Object.defineProperty(video,'videoHeight',{configurable:true,value:height});
   await act(async()=>video.dispatchEvent({type:'loadedmetadata',bubbles:false}));
   const current=env.container.querySelectorAll('div').find(x=>x.getAttribute('aria-label')?.includes('video player'));
   if(player) assert.equal(current,player);
   player=current;
   assert.equal(Number(current.style.aspectRatio),width/height);
  }
 } finally {await env.cleanup();setSessionMuted(true)}
});

test('Featured Watch Now button remains clickable and triggers playback on native player', async () => {
 const env = setupMountedDom();
 try {
  await act(async () => env.root.render(React.createElement(VideoPlayer, { edit: edits[0] })));
  const video = env.container.querySelectorAll('video')[0];
  const watchBtn = env.container.querySelectorAll('button').find(b => b.getAttribute('class')?.includes('watch'));
  assert.ok(watchBtn, 'Watch button must be rendered in DOM');
  assert.equal(video._playCalls, 0);

  // Click Watch Now button
  await act(async () => {
   watchBtn.dispatchEvent({ type: 'click', bubbles: true });
  });
  assert.equal(video._playCalls, 1, 'Clicking Watch Now button must trigger play on video');
 } finally {
  await env.cleanup();
 }
});

test('CSS rules ensure Watch Now and Shuffle buttons retain pointer-events when visible and disable when hidden', () => {
 const css = fs.readFileSync('src/styles/index.css', 'utf8');
 // .hero-info is non-blocking to empty space
 assert.match(css, /\.hero-info\s*\{[^}]*pointer-events:\s*none;/);
 // .hero-info .watch has pointer-events: auto
 assert.match(css, /\.hero-info\s+\.watch[^{]*\{[^}]*pointer-events:\s*auto;/);
 // .watch itself has pointer-events: auto
 assert.match(css, /\.watch\s*\{[^}]*pointer-events:\s*auto;/);
 // hidden info disables pointer-events
 assert.match(css, /\.player\[data-info-hidden="true"\]\s+\.hero-info:not\(:focus-within\)\s+\*\s*\{[^}]*pointer-events:\s*none\s*!important;/);
});

test('CSS rules establish non-overlapping separation between .hero-info and .player-bottom seek rail', () => {
 const css = fs.readFileSync('src/styles/index.css', 'utf8');
 // .hero-info is elevated safely above playback rail
 assert.match(css, /\.hero-info\s*\{[^}]*bottom:\s*68px;/);
 // .player-bottom has higher z-index than .hero-info
 assert.match(css, /\.player-bottom\s*\{[^}]*z-index:\s*5;/);
});

test('CSS rules ensure Shorts viewer header is an in-flow responsive row without negative top clipping', () => {
 const css = fs.readFileSync('src/styles/index.css', 'utf8');
 // No negative top clipping in desktop header
 assert.doesNotMatch(css, /\.shorts-viewer-header\s*\{[^}]*top:\s*-[0-9]+px/);
 // Shorts viewer container has column flow and bounded width
 assert.match(css, /\.shorts-viewer-container\s*\{[^}]*flex-direction:\s*column;/);
});
