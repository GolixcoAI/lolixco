import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {previewCatalog as catalog} from '../src/preview-catalog.ts';
import {selectEditOfTheMoment} from '../src/utils/editOfTheMoment.ts';
import {searchEdits} from '../src/data/searchEngine.ts';
import {renderPublicHtml} from '../scripts/public-pages.mjs';

test('release has exactly 57 unique public records and 30 integrity-bound media pairs',()=>{
 assert.equal(catalog.length,57);assert.equal(new Set(catalog.map(x=>x.id)).size,57);
 assert.equal(catalog.filter(x=>x.sourceType==='youtube_embed').length,27);
 const hosted=catalog.filter(x=>x.sourceType==='licensed_local_media');assert.equal(hosted.length,30);
 assert.equal(hosted.filter(x=>x.format==='short').length,10);
 for(const edit of hosted)assert.ok(edit.format==='short' ? edit.id>=400&&edit.id<500 : edit.id>=300&&edit.id<400);
 assert.ok(!catalog.some(x=>x.youtubeVideoId==='KY0xrjzfFLA'));
 const manifest=JSON.parse(readFileSync('public/media-manifest.json','utf8'));
 for(const edit of hosted){const item=manifest.items.find(x=>x.id===edit.id);assert.ok(item);assert.equal(edit.title,item.title);assert.equal(new URL(edit.source).pathname,item.video.path);assert.equal(new URL(edit.poster).pathname,item.poster.path);assert.match(item.video.sha256,/^[a-f0-9]{64}$/);assert.ok(edit.tags.length&&edit.description&&edit.duration);}
});
test('complete mixed rotation visits every edit once and remains stable within its UTC day',()=>{
 const date=new Date('2026-11-09T03:00:00Z');
 const cycle=Array.from({length:57},(_,i)=>selectEditOfTheMoment(catalog,date,i));
 assert.equal(new Set(cycle.map(x=>x.id)).size,57);
 assert.equal(selectEditOfTheMoment([...catalog].reverse(),date).id,cycle[0].id);
 let changes=0;for(let i=1;i<cycle.length;i++)if(cycle[i].sourceType!==cycle[i-1].sourceType)changes++;
 assert.ok(changes>=20,'Rotation must mix source types');
});
test('search indexes actual titles and hashtags from the unified catalogue',()=>{
 for(const edit of catalog){assert.ok(searchEdits(catalog,edit.title).some(x=>x.edit.id===edit.id),edit.title);}
 for(const edit of catalog.filter(x=>x.hashtags?.length)){assert.ok(searchEdits(catalog,edit.hashtags[0]).some(x=>x.edit.id===edit.id));}
});
test('initial HTML has working verified contacts while preview indexing remains disabled',()=>{
 const template='<html><head></head><body><div id="root"></div></body></html>';
 for(const [path,email] of [['/help','support'],['/rights','rights'],['/terms','hello']]){
  const html=renderPublicHtml(template,path,false);assert.ok(html.includes(`href="mailto:${email}@golixco.com"`));assert.match(html,/noindex,follow/);
 }
});
