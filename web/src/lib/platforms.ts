export const PLATFORM_PROVIDERS = [
  'youtube',
  'facebook',
  'linkedin',
  'instagram',
  'x',
] as const;

export type PlatformProvider = (typeof PLATFORM_PROVIDERS)[number];

export type PlatformStatus = {
  connected: boolean;
  accountLabel?: string;
  externalAccountId?: string;
};

export type AllPlatformStatus = Record<PlatformProvider, PlatformStatus>;

export type OutboundDestination = {
  platform: PlatformProvider;
  streamKey: string;
};

export const PLATFORM_META: Record<
  PlatformProvider,
  {
    label: string;
    connectLabel: string;
    disconnectedHelp: string;
    connectedHelp: string;
    keyPlaceholder: string;
    accountFallback: string;
  }
> = {
  youtube: {
    label: 'YouTube',
    connectLabel: 'Connect YouTube',
    disconnectedHelp: 'Connect your channel to enable Go live (stream key and live chat).',
    connectedHelp: 'Saved for Go live — not used for local recording. Copy the key from YouTube Studio → Go live.',
    keyPlaceholder: 'rtmp://… / stream key',
    accountFallback: 'YouTube channel',
  },
  facebook: {
    label: 'Facebook',
    connectLabel: 'Connect Facebook',
    disconnectedHelp: 'Connect your Facebook account to enable Go live with a Live Producer stream key.',
    connectedHelp:
      'Copy the stream key from Meta Live Producer / Business Suite. Bare keys are sent to Facebook RTMPS ingest.',
    keyPlaceholder: 'rtmps://… / stream key',
    accountFallback: 'Facebook',
  },
  linkedin: {
    label: 'LinkedIn',
    connectLabel: 'Connect LinkedIn',
    disconnectedHelp: 'Connect LinkedIn. You must already have LinkedIn Live access to get an RTMP URL.',
    connectedHelp: 'Paste the full RTMP URL including stream key from LinkedIn Live.',
    keyPlaceholder: 'rtmp://…/your-stream-key',
    accountFallback: 'LinkedIn',
  },
  instagram: {
    label: 'Instagram',
    connectLabel: 'Connect Instagram',
    disconnectedHelp:
      'Connect an Instagram professional account. Live keys come from Instagram Live Producer, not the mobile Live button.',
    connectedHelp:
      'Copy the key from Instagram Live Producer in Meta Business Suite. Same RTMPS ingest as Facebook.',
    keyPlaceholder: 'rtmps://… / stream key',
    accountFallback: 'Instagram',
  },
  x: {
    label: 'X',
    connectLabel: 'Connect X',
    disconnectedHelp: 'Connect X. Copy the RTMP URL and key from X Media Studio / Live.',
    connectedHelp: 'Paste the full RTMP URL including stream key from X Media Studio.',
    keyPlaceholder: 'rtmp://…/your-stream-key',
    accountFallback: 'X',
  },
};

export const STREAM_KEY_STORAGE: Record<PlatformProvider, string> = {
  youtube: 'streaming-studio-yt-rtmp',
  facebook: 'streaming-studio-facebook-rtmp',
  linkedin: 'streaming-studio-linkedin-rtmp',
  instagram: 'streaming-studio-instagram-rtmp',
  x: 'streaming-studio-x-rtmp',
};

export function emptyPlatformStatus(): AllPlatformStatus {
  return {
    youtube: { connected: false },
    facebook: { connected: false },
    linkedin: { connected: false },
    instagram: { connected: false },
    x: { connected: false },
  };
}

export function formatLiveInfo(destinations: PlatformProvider[]): string {
  const labels = destinations.map((id) => PLATFORM_META[id].label);
  return `Live on ${labels.join(', ')} @ 1080p60`;
}
