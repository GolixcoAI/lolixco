/** A registration is a generation-safe lease. Mounted players do not own playback. */
export type PlaybackLease = (() => void) & {
  playing: () => boolean;
  paused: () => void;
  canPlay: () => boolean;
};
type Player = { pause: () => void; scope?: string };
class PlaybackCoordinator {
  private activePlayerId: string | null = null;
  private players = new Map<string, Player>();
  private overlays: string[] = [];

  registerPlayer(id: string, pause: () => void, scope?: string): PlaybackLease {
    const previous = this.players.get(id);
    if (previous) this.pause(previous);
    const player = { pause, scope };
    this.players.set(id, player);
    if (this.activePlayerId === id) this.activePlayerId = null;
    const current = () => this.players.get(id) === player;
    const dispose = (() => {
      // An old cleanup must never remove or pause its replacement.
      if (!current()) return;
      this.players.delete(id);
      if (this.activePlayerId === id) this.activePlayerId = null;
      this.pause(player);
    }) as PlaybackLease;
    dispose.canPlay = () => current() && this.allowed(player);
    dispose.playing = () => current() && this.notifyPlaying(id);
    dispose.paused = () => {
      if (current()) this.notifyPaused(id);
    };
    return dispose;
  }

  private pause(player: Player) {
    try {
      player.pause();
    } catch {
      /* A dismantled player cannot break coordination. */
    }
  }
  private allowed(player: Player) {
    return this.overlays.length === 0 || player.scope === this.overlays.at(-1);
  }

  notifyPlaying(id: string): boolean {
    const player = this.players.get(id);
    if (!player) return false;
    if (!this.allowed(player)) {
      this.pause(player);
      return false;
    }
    // Set ownership before pausing: synchronous old pause events cannot clear it.
    this.activePlayerId = id;
    // Cancel pending starts too, including players that have not reached PLAYING.
    for (const [otherId, other] of this.players) {
      if (otherId !== id) this.pause(other);
    }
    return true;
  }
  notifyPaused(id: string): void {
    if (this.activePlayerId === id) this.activePlayerId = null;
  }
  pauseAll(): void {
    this.activePlayerId = null;
    for (const player of this.players.values()) this.pause(player);
  }
  /** Modal ownership blocks delayed background playback without claiming active audio. */
  acquireOverlay(scope: string): () => void {
    this.overlays.push(scope);
    this.pauseAll();
    return () => {
      const index = this.overlays.lastIndexOf(scope);
      if (index === -1) return;
      this.overlays.splice(index, 1);
      for (const [id, player] of this.players) {
        if (player.scope === scope) {
          this.notifyPaused(id);
          this.pause(player);
        }
      }
    };
  }
  getActivePlayerId(): string | null {
    return this.activePlayerId;
  }
  reset(): void {
    this.pauseAll();
    this.players.clear();
    this.overlays = [];
  }
}
export const playbackCoordinator = new PlaybackCoordinator();
