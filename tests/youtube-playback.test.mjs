import test from "node:test";
import assert from "node:assert/strict";

import { playbackCoordinator } from "../src/utils/playbackCoordinator.ts";
import { isYouTubeEmbed, isLocalDemo, getCanonicalSourceUrl } from "../src/data/edits.ts";

test("PLAYBACK ARCHITECTURE: source-aware player helper functions", () => {
  const localDemo = {
    id: 0,
    title: "Into the Light",
    category: "Cinematic",
    tags: ["demo"],
    description: "Demo",
    creator: "Creator",
    poster: "poster.jpg",
    source: "media.mp4",
    duration: "0:30",
    trending: true,
    sourceType: "local_demo",
    format: "video",
  };

  const youtubeVideo = {
    id: 100,
    title: "Valorant Radiant ACE",
    category: "Gaming",
    tags: ["valorant"],
    description: "Gaming edit",
    creator: "Editor",
    poster: "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
    source: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    duration: "1:45",
    trending: true,
    sourceType: "youtube_embed",
    youtubeVideoId: "dQw4w9WgXcQ",
    format: "video",
  };

  const youtubeShort = {
    id: 200,
    title: "Demon Slayer Quick Slash",
    category: "Anime",
    tags: ["demonslayer"],
    description: "Anime short",
    creator: "Editor",
    poster: "https://i.ytimg.com/vi/7wtfhZwyrcc/hqdefault.jpg",
    source: "https://www.youtube.com/shorts/7wtfhZwyrcc",
    duration: "0:25",
    trending: false,
    sourceType: "youtube_embed",
    youtubeVideoId: "7wtfhZwyrcc",
    format: "short",
  };

  assert.equal(isLocalDemo(localDemo), true);
  assert.equal(isYouTubeEmbed(localDemo), false);
  assert.equal(getCanonicalSourceUrl(localDemo), "media.mp4");

  assert.equal(isLocalDemo(youtubeVideo), false);
  assert.equal(isYouTubeEmbed(youtubeVideo), true);
  assert.equal(getCanonicalSourceUrl(youtubeVideo), "https://www.youtube.com/watch?v=dQw4w9WgXcQ");

  assert.equal(isLocalDemo(youtubeShort), false);
  assert.equal(isYouTubeEmbed(youtubeShort), true);
  assert.equal(getCanonicalSourceUrl(youtubeShort), "https://www.youtube.com/watch?v=7wtfhZwyrcc");
});

test("PLAYBACK COORDINATOR: single-active player enforcement and audio isolation", () => {
  let playerAPaused = false;
  let playerBPaused = false;
  let playerCPaused = false;

  const unregisterA = playbackCoordinator.registerPlayer("player-a", () => {
    playerAPaused = true;
  });
  const unregisterB = playbackCoordinator.registerPlayer("player-b", () => {
    playerBPaused = true;
  });
  const unregisterC = playbackCoordinator.registerPlayer("player-c", () => {
    playerCPaused = true;
  });

  // Player A starts playing
  playbackCoordinator.notifyPlaying("player-a");
  assert.equal(playbackCoordinator.getActivePlayerId(), "player-a");
  assert.equal(playerAPaused, false);
  assert.equal(playerBPaused, true, "Pending starts are cancelled even before PLAYING");
  assert.equal(playerCPaused, true, "Pending starts are cancelled even before PLAYING");

  // Player B starts playing -> Player A must be immediately paused
  playbackCoordinator.notifyPlaying("player-b");
  assert.equal(playbackCoordinator.getActivePlayerId(), "player-b");
  assert.equal(playerAPaused, true, "Player A must be paused when Player B plays");
  assert.equal(playerBPaused, true, "Pending starts are cancelled even before PLAYING");

  // Player C starts playing (e.g. Immersion Mode) -> Player B must be paused
  playbackCoordinator.notifyPlaying("player-c");
  assert.equal(playbackCoordinator.getActivePlayerId(), "player-c");
  assert.equal(playerBPaused, true, "Player B must be paused when Player C plays");

  // Pause all (e.g. modal overlay or tab hidden)
  playbackCoordinator.pauseAll();
  assert.equal(playbackCoordinator.getActivePlayerId(), null);
  assert.equal(playerCPaused, true, "Player C must be paused when pauseAll is called");

  // Clean up
  unregisterA();
  unregisterB();
  unregisterC();
});

test("PLAYBACK COORDINATOR: unregistering active player resets active state safely", () => {
  let playerPaused = false;
  const unregister = playbackCoordinator.registerPlayer("temporary-player", () => {
    playerPaused = true;
  });

  playbackCoordinator.notifyPlaying("temporary-player");
  assert.equal(playbackCoordinator.getActivePlayerId(), "temporary-player");

  unregister();
  assert.equal(playbackCoordinator.getActivePlayerId(), null, "Unregistering active player must clear active ID");
});
