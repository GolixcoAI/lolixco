import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceQueue, seededRandom, markUnavailable} from '../src/utils/sourceQueue.ts';
import {acquirePageLock} from '../src/utils/pageLock.ts';
import {createImmersionSession,advanceImmersionNext} from '../src/utils/immersionQueue.ts';

test('Immersion respects category and fandom together through queue refills', () => {
  const catalog = [
    {id:920001,category:'Gaming',fandomIds:['valorant'],sourceType:'youtube_embed'},
    {id:920002,category:'Gaming',fandomIds:['valorant'],sourceType:'licensed_local_media'},
    {id:920003,category:'Series',fandomIds:['valorant'],sourceType:'youtube_embed'},
  ];
  for(let seed=0;seed<100;seed++) {
    const session=createImmersionSession(catalog,{category:'Gaming',fandomId:'valorant',restrictToContext:true},seed);
    let state=session.state;
    assert.equal(session.currentEdit.category,'Gaming');
    for(let step=0;step<20;step++) {
      const next=advanceImmersionNext(catalog,state,seed+step);
      assert.equal(next.nextEdit.category,'Gaming');
      assert.notEqual(next.nextEdit.id,state.history[state.currentIndex].id);
      state=next.nextState;
    }
  }
});

test('source queues vary across 250 sessions and cap streaks while alternatives remain', () => {
  const candidates = Array.from({length: 24}, (_, id) => ({id, sourceType: id % 2 ? 'youtube_embed' : 'local'}));
  const orders = new Set();
  for (let seed = 1; seed <= 250; seed++) {
    const queue = sourceQueue(candidates, seededRandom(seed), [candidates[0], candidates[2]]);
    orders.add(queue.map(x => x.id).join(','));
    assert.equal(new Set(queue.map(x => x.id)).size, candidates.length);
    const remaining = [...candidates];
    const history = [candidates[0], candidates[2]];
    for (const chosen of queue) {
      const last = history.at(-1), prior = history.at(-2);
      if (last?.sourceType === prior?.sourceType && remaining.some(x => x.sourceType !== last.sourceType)) {
        assert.notEqual(chosen.sourceType, last.sourceType);
      }
      if (remaining.some(x => x.id !== last.id)) assert.notEqual(chosen.id, last.id);
      remaining.splice(remaining.findIndex(x => x.id === chosen.id), 1);
      history.push(chosen);
    }
  }
  assert.ok(orders.size > 240);
});

test('queues preserve caller eligibility and exclude failed and duplicate records', () => {
  const unavailable = {id: 910001, sourceType: 'local'};
  markUnavailable(unavailable);
  const eligible = [{id: 910002, sourceType: 'local'}, {id: 910003, sourceType: 'youtube_embed'}];
  const queue = sourceQueue([...eligible, eligible[0], unavailable], seededRandom(1));
  assert.deepEqual(new Set(queue.map(x => x.id)), new Set(eligible.map(x => x.id)));
});

test('overlapping document locks release in either order, exactly once, and restore route scroll', () => {
  const saved = {document:globalThis.document, window:globalThis.window, HTMLElement:globalThis.HTMLElement};
  class Element { constructor() {this.style = {}; this.children = []; this.inert = false;} }
  const body = new Element(), html = new Element(), menu = new Element(), player = new Element(), content = new Element();
  body.children = [menu,player,content];
  for (const el of body.children) el.parentElement = body;
  body.style.overflow = 'auto';
  const scroll = [];
  const location = {pathname:'/'};
  globalThis.document = {body, documentElement:html};
  globalThis.HTMLElement = Element;
  globalThis.window = {scrollX:0, scrollY:850, location, scrollTo: value => scroll.push(value)};
  try {
    for (const order of [[0,1], [1,0]]) {
      const releases = [acquirePageLock(menu), acquirePageLock(player)];
      assert.equal(body.style.position,'fixed');
      assert.equal(content.inert,true);
      releases[order[0]](); releases[order[0]]();
      assert.equal(body.style.overflow,'hidden');
      assert.equal(content.inert,true);
      releases[order[1]]();
      assert.equal(body.style.overflow,'auto');
      assert.equal(content.inert,false);
      assert.equal(scroll.at(-1).top,850);
    }
    const release = acquirePageLock(menu);
    location.pathname = '/studio';
    release();
    assert.equal(scroll.at(-1).top,0);
  } finally {
    for (const [name,value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[name]; else globalThis[name] = value;
    }
  }
});
