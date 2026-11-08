import test from 'node:test';
import assert from 'node:assert/strict';
import {youtubePlaybackIssue, youtubeReferenceId, youtubeWatchUrl} from '../src/components/studio/youtubeReference.ts';

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

test('YouTube fallback distinguishes playback policy, video availability, and player identity', () => {
 assert.equal(youtubePlaybackIssue(101), youtubePlaybackIssue(150));
 assert.match(youtubePlaybackIssue(150), /owner has disabled/);
 assert.match(youtubePlaybackIssue(100), /unavailable or private/);
 assert.match(youtubePlaybackIssue(153), /referrer/);
 assert.match(youtubePlaybackIssue(0), /could not load/);
 assert.equal(youtubeWatchUrl('M7lc1UVf-VE'), 'https://www.youtube.com/watch?v=M7lc1UVf-VE');
});
