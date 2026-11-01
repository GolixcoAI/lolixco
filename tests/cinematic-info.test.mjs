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
