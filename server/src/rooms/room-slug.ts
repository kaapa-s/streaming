import { randomBytes } from 'crypto';

/**
 * Room slugs are the invite link's only secret, so they must be unguessable.
 *
 * Lowercase hex, not base64url: RoomsService, the compositor's SessionsService
 * and CommentsService all normalize slugs with `.trim().toLowerCase()`, which
 * would silently fold a mixed-case slug into a different — and collision-prone
 * — string. Hex is already lowercase, so it survives that round trip.
 *
 * 12 bytes → 24 chars, 96 bits.
 */
export function randomRoomSlug(): string {
  return randomBytes(12).toString('hex');
}
