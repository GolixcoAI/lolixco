/** Browser verification against the running local Creator Studio. Uses synthetic ratings only. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const modules = process.env.RUNTIME_MODULES;
if (!modules) throw Error('Set RUNTIME_MODULES to an installed directory containing Playwright.');
const { chromium } = createRequire(resolve(modules, 'package.json'))('playwright');
const origin = 'http://127.0.0.1:5173';
const output = resolve(process.env.VERIFY_OUTPUT_DIR || '../lolixco-stage15c-evidence');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
const errors = [];

function fixture(scores, overall = null) {
 return {
  categories: scores.map(score => ({ score, status: 'DEMO', provenance: 'Synthetic animation verification' })),
  overall: { score: overall, status: overall === null ? 'NOT_YET_ASSESSED' : 'DEMO', provenance: 'Synthetic animation verification' },
 };
}

async function context(options = {}) {
 const value = await browser.newContext(options);
 await value.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
 const page = await value.newPage();
 page.on('pageerror', error => errors.push(error.message));
 return { context: value, page };
}

async function harness(page) {
 await page.goto(origin + '/tests/browser/rating-ux.html');
 await page.waitForFunction(() => window.renderRating);
}

async function capture(page, props, { rerender = false, alreadyStarted = false } = {}) {
 return page.evaluate(({ props, rerender, alreadyStarted }) => new Promise((resolve, reject) => {
  if (!alreadyStarted) window.renderRating(props);
  const start = performance.now();
  const frames = [];
  const checkpoints = new Map();
  const checkpointOrder = [];
  let didRerender = false;
  function sample(now) {
   const root = document.querySelector('.rating-reveal');
   const index = Number(root.dataset.checkpoint);
   const phase = root.dataset.phase;
   if (phase === 'checkpoint' && !checkpoints.has(index)) {
    checkpoints.set(index, {
     index, reaction: document.querySelector('.rpm-reaction')?.textContent || '',
     scored: root.dataset.checkpointScored === 'true',
    });
    checkpointOrder.push(index);
   }
   const entries = [...document.querySelectorAll('.rating-category')].flatMap((row, dimension) => {
    const score = row.querySelector('.rating-score-chip');
    const bar = row.querySelector('.rating-track > div');
    if (!score || !bar) return [];
    const text = score.textContent;
    const value = Number.parseFloat(text);
    const fill = Number(bar.style.getPropertyValue('--rating-fill'));
    const track = bar.parentElement;
    const geometry = bar.getBoundingClientRect().width / track.getBoundingClientRect().width;
    return [{dimension, text, value, fill, geometry}];
   });
   frames.push({time: now - start, phase, index, entries, needle: document.querySelector('.rpm-needle')?.getAttribute('transform')});
   if (rerender && !didRerender && now - start > 180) {
    didRerender = true;
    window.renderRating({...props, ratings: {...props.ratings, categories: props.ratings.categories.map(item => ({...item, explanation: 'Unrelated updated evidence copy'}))}});
   }
   if (phase === 'complete') resolve({frames, checkpoints: [...checkpoints.values()], checkpointOrder});
   else if (now - start > 12000) reject(Error('Presentation did not finish.'));
   else requestAnimationFrame(sample);
  }
  requestAnimationFrame(sample);
 }), { props, rerender, alreadyStarted });
}

function validateFrames(label, result, targets, hasOverall) {
 assert.deepEqual(result.checkpointOrder, [0,1,2,3,4,5,6], label + ' presents all seven checkpoints once');
 assert.equal(new Set(result.checkpoints.map(step => step.reaction)).size, 7, label + ' has seven distinct reactions');
 assert.ok(result.checkpoints.every(step => step.reaction && step.reaction !== 'FINAL VERDICT!'));
 let interpolated = 0;
 for (const frame of result.frames) {
  for (const entry of frame.entries) {
   assert.match(entry.text, /^\d+\.\d{2}\/10$/);
   assert.ok(Math.abs(entry.value / 10 - entry.fill) < 1e-12, label + ' text and bar share a value');
   assert.ok(Math.abs(entry.geometry - entry.fill) < .002, label + ' painted geometry matches displayed value');
   assert.ok(entry.value >= 0 && entry.value <= targets[entry.dimension] + 1e-9);
   if (entry.value > 0 && entry.value < targets[entry.dimension]) interpolated++;
  }
 }
 assert.ok(interpolated > 10, label + ' contains real intermediate frames');
 const final = result.frames.at(-1);
 for (const entry of final.entries) assert.equal(entry.value, targets[entry.dimension]);
 assert.ok(new Set(result.frames.map(frame => frame.needle)).size > 20, label + ' needle moves');
 results.push({label, frames:result.frames.length, checkpoints:result.checkpoints, interpolated, hasOverall});
}

try {
 const { context: desktop, page } = await context({ viewport: {width:1100,height:1000} });
 await harness(page);
 let all = null;
 for (const [label, targets, overall] of [
  ['one score', [8.12,null,null,null,null,null,null], null],
  ['four scores', [0,9.99,8.12,3.14,null,null,null], null],
  ['seven scores', [0,9.99,8.12,3.14,6.53,7.36,5.42], 6.78],
 ]) {
  const props = {ratings:fixture(targets,overall), synthetic:true, localResult:true, analysisComplete:true, receivedResultId:label};
  const captured = await capture(page,props,{rerender:true});
  validateFrames(label,captured,targets,overall !== null);
  assert.equal(await page.getByText('FINAL VERDICT!',{exact:true}).count(),overall === null ? 0 : 1);
  if (label === 'seven scores') {
   all = captured;
   await page.screenshot({path:join(output,'desktop-seven-score-settle.png')});
   await page.getByRole('button',{name:'Replay',exact:true}).click();
   const replay = await capture(page,props,{alreadyStarted:true});
   validateFrames('replay',replay,targets,true);
   assert.deepEqual(replay.checkpoints,captured.checkpoints,'Replay retains the same session selection');
  }
 }
 const rerolled = await capture(page,{
  ratings:fixture([0,9.99,8.12,3.14,6.53,7.36,5.42],6.78), synthetic:true,
  localResult:true, analysisComplete:true, receivedResultId:'new analysis identity',
 });
 assert.notDeepEqual(rerolled.checkpoints.map(step=>step.reaction),all.checkpoints.map(step=>step.reaction));
 results.push({label:'new session rerolls reactions',pass:true});

 await page.evaluate(ratings=>window.renderRating({ratings,synthetic:true,localResult:true,analysisComplete:true,receivedResultId:'skip'}),fixture([8.12,9.99,3.14,7.2,null,null,null]));
 await page.waitForSelector('.rating-reveal[data-phase="checkpoint"]');
 await page.getByRole('button',{name:'Skip animation',exact:true}).click();
 assert.equal(await page.locator('.rating-reveal').getAttribute('data-phase'),'complete');
 assert.deepEqual(await page.locator('.rating-score-chip').allTextContents(),['8.12/10','9.99/10','3.14/10','7.20/10']);
 assert.equal(await page.getByText('FINAL VERDICT!',{exact:true}).count(),0);
 results.push({label:'skip settles actual scores',pass:true});

 await page.evaluate(()=>window.renderRating({localResult:true,processing:true,receivedResultId:'dots'}));
 const dotResult = await page.evaluate(()=>new Promise(resolve=>{
  const label=document.querySelector('.processing-label');
  const dots=[...label.querySelectorAll('.processing-dots > span')];
  const start=performance.now(); const samples=[];
  function sample(now){
   samples.push({time:now-start,width:label.getBoundingClientRect().width,opacities:dots.map(dot=>+getComputedStyle(dot).opacity)});
   if(now-start>2100)resolve({samples,sameNodes:dots.every((dot,i)=>label.querySelectorAll('.processing-dots > span')[i]===dot)});
   else requestAnimationFrame(sample);
  } requestAnimationFrame(sample);
 }));
 assert.equal(dotResult.sameNodes,true);
 assert.ok(Math.max(...dotResult.samples.map(sample=>sample.width))-Math.min(...dotResult.samples.map(sample=>sample.width)) < .01);
 const peaks=[0,1,2].map(index=>dotResult.samples.find(sample=>sample.opacities[index]>.85)?.time);
 assert.ok(peaks[0]<peaks[1]&&peaks[1]<peaks[2],'dots appear left to right');
 assert.ok(dotResult.samples.some(sample=>sample.opacities.some(opacity=>opacity>.25&&opacity<.75)),'dot opacity changes gradually');
 await page.screenshot({path:join(output,'desktop-analysing-dots.png')});
 await page.evaluate(()=>window.renderRating({localResult:true,processing:false,receivedResultId:'dots'}));
 assert.equal(await page.locator('.processing-dots').count(),0);
 const stoppedNeedle=await page.locator('.rpm-needle').getAttribute('transform');
 await page.waitForTimeout(200);
 assert.equal(await page.locator('.rpm-needle').getAttribute('transform'),stoppedNeedle);
 results.push({label:'dot opacity wave, reserved width, and cancellation',peaks,samples:dotResult.samples.length,pass:true});
 await desktop.close();

 const { context: quietContext, page: quiet }=await context({viewport:{width:320,height:740},reducedMotion:'reduce',isMobile:true,hasTouch:true});
 await harness(quiet);
 await quiet.evaluate(ratings=>window.renderRating({ratings,synthetic:true,receivedResultId:'reduced'}),fixture([0,9.99,8.12,3.14,6.53,7.36,5.42],6.78));
 await quiet.waitForSelector('.rating-reveal[data-phase="complete"]');
 assert.deepEqual(await quiet.locator('.rating-score-chip').allTextContents(),['0.00/10','9.99/10','8.12/10','3.14/10','6.53/10','7.36/10','5.42/10']);
 assert.equal(await quiet.locator('.rpm-reaction').evaluate(element=>getComputedStyle(element).animationName),'none');
 await quiet.evaluate(()=>window.renderRating({localResult:true,processing:true,receivedResultId:'reduced-dots'}));
 assert.ok((await quiet.locator('.processing-dots > span').evaluateAll(dots=>dots.every(dot=>getComputedStyle(dot).animationName==='none'))));
 await quiet.screenshot({path:join(output,'mobile-reduced-motion.png')});
 await quietContext.close();
 results.push({label:'reduced motion settles scores and static dots',pass:true});

 const {context: mobile, page: studio}=await context({viewport:{width:390,height:860},isMobile:true,hasTouch:true,recordVideo:{dir:output,size:{width:390,height:860}}});
 await studio.goto(origin+'/?view=studio');
 await studio.getByText('Local analyzer · Connected',{exact:true}).waitFor();
 await studio.getByText('Developer animation previews',{exact:true}).tap();
 await studio.getByRole('button',{name:'Play seven-score fixture',exact:true}).tap();
 await studio.locator('.rpm-instrument').scrollIntoViewIfNeeded();
 await studio.waitForSelector('.rating-reveal[data-checkpoint="0"][data-phase="checkpoint"]');
 await studio.waitForTimeout(160);
 await studio.screenshot({path:join(output,'mobile-countup-checkpoint.png')});
 await studio.getByText('FINAL VERDICT!',{exact:true}).waitFor();
 assert.equal(await studio.getByText('FINAL VERDICT!',{exact:true}).count(),1);
 assert.equal(await studio.locator('.rating-track[role=meter]').count(),7);
 await studio.getByLabel('Preview comic reaction').selectOption('SHUT UP!');
 await studio.waitForTimeout(300);
 assert.equal(await studio.locator('.rpm-reaction').getAttribute('data-reaction'),'SHUT UP!');
 await studio.screenshot({path:join(output,'mobile-shut-up.png')});
 await mobile.close();
 await studio.video().saveAs(join(output,'mobile-score-countup.webm'));
 rmSync(await studio.video().path(), { force: true });
 results.push({label:'actual Studio fixture, mobile touch, one final verdict and SHUT UP!',pass:true});
 assert.deepEqual(errors,[]);
 writeFileSync(join(output,'animation-verification.json'),JSON.stringify({results,errors},null,2));
 console.log(JSON.stringify({results,errors},null,2));
} finally {
 await browser.close();
}
