export const RAW_VIDEO = 1;
export const RAW_AUDIO = 2;

export type RawKind = 'video' | 'audio';

export interface RawPacket {
  kind: RawKind;
  payload: Buffer;
}

export function i420FrameSize(width: number, height: number): number {
  return (width * height * 3) / 2;
}

export function parseRawPacket(buf: Buffer): RawPacket | undefined {
  if (buf.length < 2) return undefined;
  const kindByte = buf[0];
  const payload = buf.subarray(1);
  if (kindByte === RAW_VIDEO) return { kind: 'video', payload };
  if (kindByte === RAW_AUDIO) return { kind: 'audio', payload };
  return undefined;
}
