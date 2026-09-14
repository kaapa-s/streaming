import { BadRequestException } from '@nestjs/common';
import { isPlatformProvider, PLATFORM_LABELS, type PlatformProvider } from '../platforms/platform-ids';

export type OutboundDestinationInput = {
  platform: PlatformProvider;
  streamKey: string;
};

export function resolveDestinations(body: {
  destinations?: Array<{ platform?: string; streamKey?: string }>;
  rtmpUrl?: string;
}): OutboundDestinationInput[] {
  if (body.destinations && body.destinations.length > 0) {
    const seen = new Set<PlatformProvider>();
    const out: OutboundDestinationInput[] = [];
    for (const raw of body.destinations) {
      const platform = raw.platform?.trim() ?? '';
      if (!isPlatformProvider(platform)) {
        throw new BadRequestException(`unknown destination ${platform || '(empty)'}`);
      }
      if (seen.has(platform)) {
        throw new BadRequestException(`duplicate destination ${PLATFORM_LABELS[platform]}`);
      }
      const streamKey = raw.streamKey?.trim() ?? '';
      if (!streamKey) {
        throw new BadRequestException(`stream key required for ${PLATFORM_LABELS[platform]}`);
      }
      seen.add(platform);
      out.push({ platform, streamKey });
    }
    return out;
  }

  const legacy = body.rtmpUrl?.trim();
  if (legacy) return [{ platform: 'youtube', streamKey: legacy }];
  return [];
}
