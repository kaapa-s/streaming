export const PLATFORM_PROVIDERS = [
  'youtube',
  'facebook',
  'linkedin',
  'instagram',
  'x',
] as const;

export type PlatformProvider = (typeof PLATFORM_PROVIDERS)[number];

export const PLATFORM_LABELS: Record<PlatformProvider, string> = {
  youtube: 'YouTube',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  x: 'X',
};

export function isPlatformProvider(value: string): value is PlatformProvider {
  return (PLATFORM_PROVIDERS as readonly string[]).includes(value);
}
