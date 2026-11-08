import test from 'node:test';
import assert from 'node:assert/strict';
import React, {act} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {setupMountedDom} from './mounted-dom.mjs';
import LoadingRing from '../src/components/ui/LoadingRing.tsx';
import PosterImage from '../src/components/ui/PosterImage.tsx';
import YouTubePlayer from '../src/components/video/YouTubePlayer.tsx';
import VideoPlayer from '../src/components/video/VideoPlayer.tsx';
import {ShortsViewer} from '../src/components/shorts/ShortsViewer.tsx';
import {edits} from '../src/data/edits.ts';
import {playbackCoordinator} from '../src/utils/playbackCoordinator.ts';

const nodes=(env,tag)=>env.container.querySelectorAll(tag);
const hasClass=(env,value)=>nodes(env,'*').some(node=>(node.getAttribute('class')||'').split(' ').includes(value));

function installYouTube(){
 const players=[];
 globalThis.YT={Player:class{
  constructor(_,config){this.events=config.events;this.destroyCalls=0;players.push(this)}
  playVideo(){} pauseVideo(){} stopVideo(){} mute(){} unMute(){} isMuted(){return true}
  destroy(){this.destroyCalls++}
 }};
 return players;
}

test('thumbnail skeleton follows image load, failure and a replacement source',async()=>{
 const env=setupMountedDom();
 try{
  await act(async()=>env.root.render(React.createElement(PosterImage,{src:'/first.jpg',title:'First edit'})));
  assert.equal(hasClass(env,'poster-image--loading'),true);
  await act(async()=>nodes(env,'img')[0].dispatchEvent({type:'load'}));
  assert.equal(hasClass(env,'poster-image--ready'),true);
  assert.equal(hasClass(env,'poster-image__skeleton'),false);
  await act(async()=>env.root.render(React.createElement(PosterImage,{src:'/next.jpg',title:'Next edit'})));
  assert.equal(hasClass(env,'poster-image--loading'),true,'a completed old poster cannot hide a pending new request');
  await act(async()=>nodes(env,'img')[0].dispatchEvent({type:'error'}));
  assert.equal(hasClass(env,'poster-image--unavailable'),true);
  assert.equal(hasClass(env,'poster-image__skeleton'),false,'failure settles instead of shimmering forever');
  assert.match(env.container.textContent,/Thumbnail unavailable/);
 }finally{await env.cleanup()}
});

test('loading marks have unique gradient IDs and one accessible status',()=>{
 const html=renderToStaticMarkup(React.createElement('div',null,
  React.createElement(LoadingRing,{label:'Preparing your edit'}),React.createElement(LoadingRing,{label:''})));
 const ids=[...html.matchAll(/id="(loading-gold-[^"]+)"/g)].map(match=>match[1]);
 assert.equal(ids.length,2);assert.equal(new Set(ids).size,2);
 assert.equal((html.match(/role="status"/g)||[]).length,1);
 assert.equal((html.match(/Preparing your edit/g)||[]).length,1);
});

test('unavailable YouTube playback offers its supported escape and ignores late readiness',async()=>{
 const env=setupMountedDom();const players=installYouTube();let ready=0;
 try{
  await act(async()=>env.root.render(React.createElement(YouTubePlayer,{videoId:'aaaaaaaaaaa',onReady:()=>ready++})));
  const original=players[0];
  await act(async()=>original.events.onError({data:150}));
  assert.equal(hasClass(env,'media-loading'),false);
  assert.match(env.container.textContent,/can't play here/);
  assert.equal(nodes(env,'button').some(button=>button.textContent==='Retry playback'),false,'a permanent embed restriction does not suggest a meaningless retry');
  assert.equal(nodes(env,'a').some(link=>link.textContent.includes('Watch on YouTube')),true);
  await act(async()=>original.events.onReady());
  assert.equal(ready,0);assert.equal(original.destroyCalls,1);
  assert.equal(hasClass(env,'media-loading'),false,'a late iframe must not revive a failed request');
 }finally{await env.cleanup();delete globalThis.YT;playbackCoordinator.reset()}
});

test('temporary YouTube failure can be retried without reusing a failed player',async()=>{
 const env=setupMountedDom();const players=installYouTube();
 try{
  await act(async()=>env.root.render(React.createElement(YouTubePlayer,{videoId:'aaaaaaaaaaa'})));
  await act(async()=>players[0].events.onError({data:5}));
  const retry=nodes(env,'button').find(button=>button.textContent==='Retry playback');assert.ok(retry);
  await act(async()=>retry.dispatchEvent({type:'click',bubbles:true}));
  assert.equal(players.length,2);assert.equal(players[0].destroyCalls,1);
  assert.equal(hasClass(env,'media-loading'),true);
  await act(async()=>players[1].events.onReady());
  assert.equal(hasClass(env,'media-loading'),false);
 }finally{await env.cleanup();delete globalThis.YT;playbackCoordinator.reset()}
});

test('stalled native playback pauses before offering retry in player and Shorts',async()=>{
 const native={...edits[0],id:987,title:'Generated loading test',source:'/media/motion-study.webm'};
 for(const component of [React.createElement(VideoPlayer,{edit:native}),React.createElement(ShortsViewer,{shorts:[{...native,format:'short'}],onClose:()=>{}})]){
  const env=setupMountedDom();const originalTimeout=globalThis.setTimeout;let expire;
  globalThis.setTimeout=(callback,delay,...args)=>delay===20000?(expire=callback,0):originalTimeout(callback,delay,...args);
  try{
   await act(async()=>env.root.render(component));
   const video=nodes(env,'video')[0];assert.ok(video);
   await act(async()=>video.dispatchEvent({type:'waiting'}));
   assert.equal(hasClass(env,'media-loading'),true);assert.ok(expire);
   const pauses=video._pauseCalls;
   await act(async()=>expire());
   assert.ok(video._pauseCalls>pauses,'timeout cancels pending playback, so a late response cannot start sound');
   assert.equal(hasClass(env,'media-loading'),false);
   assert.match(env.container.textContent,/Retry/);
  }finally{globalThis.setTimeout=originalTimeout;await env.cleanup();playbackCoordinator.reset()}
 }
});
