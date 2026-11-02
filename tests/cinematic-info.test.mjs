import test from 'node:test';
import assert from 'node:assert/strict';
import React, {act} from 'react';
import {setupMountedDom} from './mounted-dom.mjs';
import {useCinematicInfo} from '../src/hooks/useCinematicInfo.ts';

test('Cinematic information waits three seconds, renews on interaction and resets on pause/source change', async(t)=>{
 const env=setupMountedDom();t.mock.timers.enable({apis:['setTimeout']});let state;
 function Probe(props){state=useCinematicInfo(props.playing,props.identity);return null}
 const render=async(playing,identity)=>act(async()=>env.root.render(React.createElement(Probe,{playing,identity})));
 try {
  await render(true,'first');assert.equal(state.visible,true);
  await act(async()=>t.mock.timers.tick(2999));assert.equal(state.visible,true);
  await act(async()=>t.mock.timers.tick(1));assert.equal(state.visible,false);
  await act(async()=>state.reveal());assert.equal(state.visible,true);
  await act(async()=>t.mock.timers.tick(2500));assert.equal(state.visible,true);
  await act(async()=>state.reveal());await act(async()=>t.mock.timers.tick(2500));assert.equal(state.visible,true);
  await act(async()=>t.mock.timers.tick(500));assert.equal(state.visible,false);
  await render(false,'first');assert.equal(state.visible,true);
  await act(async()=>t.mock.timers.tick(10000));assert.equal(state.visible,true);
  await render(true,'first');await act(async()=>t.mock.timers.tick(3000));assert.equal(state.visible,false);
  await render(true,'second');assert.equal(state.visible,true);
  await act(async()=>t.mock.timers.tick(2999));assert.equal(state.visible,true);
  await act(async()=>t.mock.timers.tick(1));assert.equal(state.visible,false);
 } finally {await env.cleanup();t.mock.timers.reset()}
});

test('featured Shuffle shares the activity cycle, remains actionable, and reveals on pause', async (t) => {
 const {default: VideoPlayer} = await import('../src/components/video/VideoPlayer.tsx');
 const {edits} = await import('../src/data/edits.ts');
 const env=setupMountedDom();t.mock.timers.enable({apis:['setTimeout']});let shuffled=0;
 try {
  await act(async()=>env.root.render(React.createElement(VideoPlayer,{edit:edits[0],onShuffle:()=>shuffled++})));
  const player=env.container.querySelectorAll('div').find(e=>e.getAttribute('aria-label')?.includes('video player'));
  const video=env.container.querySelectorAll('video')[0];
  const shuffle=env.container.querySelectorAll('button').find(e=>e.getAttribute('aria-label')==='Shuffle Edit of the Moment');
  assert.ok(shuffle);
  const watch=env.container.querySelectorAll('button').find(e=>e.getAttribute('class')?.includes('watch'));
  await act(async()=>watch.dispatchEvent({type:'click',bubbles:true}));
  await act(async()=>video.dispatchEvent({type:'playing',bubbles:false}));
  await act(async()=>t.mock.timers.tick(3000));
  assert.equal(player.getAttribute('data-info-hidden'),'true');
  await act(async()=>player.dispatchEvent({type:'pointermove',bubbles:true}));
  assert.equal(player.getAttribute('data-info-hidden'),'false');
  await act(async()=>shuffle.dispatchEvent({type:'click',bubbles:true}));
  assert.equal(shuffled,1);
  await act(async()=>{video.pause();video.dispatchEvent({type:'pause',bubbles:false});});
  await act(async()=>t.mock.timers.tick(6000));
  assert.equal(player.getAttribute('data-info-hidden'),'false');
 } finally {await env.cleanup();t.mock.timers.reset();}
});
