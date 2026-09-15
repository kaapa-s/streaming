/**
 * Short-lived, in-memory record of who the owner kicked and which rooms ended.
 *
 * The SFU has no database, so a join token stays a valid bearer credential for
 * its whole TTL — including for someone who was just removed. The API marks the
 * membership removed (durable), but a kicked user holding a still-valid token
 * could otherwise reconnect straight away. This covers exactly that window, so
 * entries only need to outlive a studio join token (600s).
 *
 * Entries are pruned lazily on read and by a periodic sweep, so the maps stay
 * bounded without a timer per entry.
 */
export const BAN_TTL_MS = 10 * 60 * 1000;
export const CLOSED_TTL_MS = 60 * 60 * 1000;

export class RoomBans {
  /** room → userId → expiry */
  private bans = new Map<string, Map<string, number>>();
  /** room → expiry */
  private closed = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  ban(room: string, userId: string, ttlMs = BAN_TTL_MS): void {
    const forRoom = this.bans.get(room) ?? new Map<string, number>();
    forRoom.set(userId, this.now() + ttlMs);
    this.bans.set(room, forRoom);
  }

  isBanned(room: string, userId: string): boolean {
    const forRoom = this.bans.get(room);
    if (!forRoom) return false;
    const expiry = forRoom.get(userId);
    if (expiry == null) return false;
    if (expiry <= this.now()) {
      forRoom.delete(userId);
      if (forRoom.size === 0) this.bans.delete(room);
      return false;
    }
    return true;
  }

  close(room: string, ttlMs = CLOSED_TTL_MS): void {
    this.closed.set(room, this.now() + ttlMs);
  }

  isClosed(room: string): boolean {
    const expiry = this.closed.get(room);
    if (expiry == null) return false;
    if (expiry <= this.now()) {
      this.closed.delete(room);
      return false;
    }
    return true;
  }

  /** Drops everything already expired. Cheap; safe to call on a timer. */
  prune(): void {
    const now = this.now();
    for (const [room, forRoom] of this.bans) {
      for (const [userId, expiry] of forRoom) {
        if (expiry <= now) forRoom.delete(userId);
      }
      if (forRoom.size === 0) this.bans.delete(room);
    }
    for (const [room, expiry] of this.closed) {
      if (expiry <= now) this.closed.delete(room);
    }
  }

  /** Test/diagnostic view. */
  size(): { bans: number; closed: number } {
    let bans = 0;
    for (const forRoom of this.bans.values()) bans += forRoom.size;
    return { bans, closed: this.closed.size };
  }
}
