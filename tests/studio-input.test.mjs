import test from 'node:test';
import assert from 'node:assert/strict';
import {youtubeReferenceId} from '../src/components/studio/youtubeReference.ts';

test('YouTube references accept public video URL forms and reject foreign origins and non-video routes', () => {
 const id='aR-KAldshAE';
 for (const url of [
  `https://www.youtube.com/watch?v=${id}&t=4`,
  `https://m.youtube.com/shorts/${id}`,
  `https://youtu.be/${id}`,
  `https://youtube.com/live/${id}`,
  `https://www.youtube-nocookie.com/embed/${id}`,
 ]) assert.equal(youtubeReferenceId(url),id);
 for (const url of [
  `https://youtube.com.example/watch?v=${id}`,
  `https://youtube.com@127.0.0.1/watch?v=${id}`,
  `https://youtube.com:444/watch?v=${id}`,
  `https://youtube.com/channel?v=${id}`,
  `http://youtu.be/${id}`,
 ]) assert.equal(youtubeReferenceId(url),null);
});
