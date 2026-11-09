// Actual CDN decoding and seeking; Playwright is supplied by the local QA tools.
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PATH);
const origin=process.argv[2];
const destination=process.argv[3];
const manifest=JSON.parse(fs.readFileSync('public/media-manifest.json','utf8'));
const override=process.env.LOLIXCO_DNS_OVERRIDE;
if(override&&!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(override))throw Error('Use an explicit IPv4 edge address for pre-DNS verification');
const browser=await chromium.launch({headless:true,args:override?[`--host-resolver-rules=MAP ${new URL(origin).hostname} ${override}, EXCLUDE localhost`]:[]});
const context=await browser.newContext();
const page=await context.newPage();
await page.goto(origin,{waitUntil:'domcontentloaded'});
const results=[];
try {
 for(const item of manifest.items) {
  let result;
  try {result=await page.evaluate(async ({item,origin})=>{
   const poster=await fetch(origin+item.poster.path);
   if(!poster.ok || !poster.headers.get('content-type')?.includes('image/webp'))throw Error('Poster response failed');
   const range=await fetch(origin+item.video.path,{headers:{Range:'bytes=0-1023'}});
   if(range.status!==206 || !(range.headers.get('content-range')||'').startsWith('bytes 0-1023/'))throw Error('Range response failed');
   await range.arrayBuffer();
   const video=document.createElement('video');
   video.muted=true;video.playsInline=true;video.preload='auto';video.style.width='160px';
   document.body.append(video);
   const event=(type)=>new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error(type+' timeout')),25000);
    video.addEventListener(type,()=>{clearTimeout(timer);resolve();},{once:true});
    video.addEventListener('error',()=>{clearTimeout(timer);reject(Error('decode '+video.error?.code+' '+video.error?.message));},{once:true});
   });
   try {
    const ready=event('loadedmetadata');video.src=origin+item.video.path;await ready;
    if(Math.abs(video.duration-item.durationSeconds)>.25 || video.videoWidth!==item.width || video.videoHeight!==item.height)throw Error('Metadata mismatch');
    const playing=event('timeupdate');await video.play();await playing;
    if(video.currentTime<=0)throw Error('Playback did not advance');
    const seeking=event('seeked');video.currentTime=video.duration*.8;await seeking;
    if(Math.abs(video.currentTime-video.duration*.8)>1)throw Error('Seek mismatch');
    return {id:item.id,poster:poster.status,range:range.status,decoded:true,seek:true,duration:video.duration,width:video.videoWidth,height:video.videoHeight};
   }finally{video.pause();video.removeAttribute('src');video.load();video.remove();}
  },{item,origin});}catch(error){result={id:item.id,error:error.message.slice(0,800)};}
  results.push(result);console.log(JSON.stringify(result));
 }
 fs.writeFileSync(destination,JSON.stringify({origin,dnsOverride:!!override,checked:results.length,results},null,2));
 if(results.some(x=>x.error))process.exitCode=1;
}finally{await browser.close();}
