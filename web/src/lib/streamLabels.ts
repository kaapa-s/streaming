/**
 * Client-visible stream nomenclature. Backend/API types keep the legacy
 * room/recording names; this module is the single source of truth for the
 * user-facing labels so the studio reads as "streaming", not "recording".
 */
export type StreamStatus = 'created' | 'active' | 'finished';

export type MediaStatus =
  | 'starting'
  | 'recording'
  | 'stopping'
  | 'uploading'
  | 'finished'
  | 'failed';

/** Header status: distinguishes a private stream from a destination-backed LIVE. */
export function streamStatusLabel(
  status: StreamStatus | null,
  opts: { active: boolean; live: boolean } = { active: false, live: false },
): string {
  if (status === 'finished') return 'Stream completed';
  if (opts.active) return opts.live ? 'LIVE' : 'Streaming';
  if (status === 'created') return 'Stream not started';
  return 'Ready to stream';
}

/** Finished-page media chip label. */
export function mediaStatusLabel(status: MediaStatus): string {
  switch (status) {
    case 'starting':
      return 'Starting';
    case 'recording':
      return 'Streaming';
    case 'stopping':
      return 'Stopping';
    case 'uploading':
      return 'Processing';
    case 'finished':
      return 'Stream completed';
    case 'failed':
      return 'Failed';
  }
}

/** Sidebar list chip label for a stream row. */
export function sidebarStatusLabel(status: StreamStatus, mediaStatus: string | null | undefined): string {
  if (status === 'created') return 'Stream not started';
  if (mediaStatus === 'failed') return 'Failed';
  if (status === 'active') return 'Streaming';
  if (mediaStatus === 'uploading' || mediaStatus === 'stopping') return 'Processing';
  return 'Stream completed';
}
