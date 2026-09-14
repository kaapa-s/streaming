import { existsSync } from 'fs';

export interface GpuDetection {
  enabled: boolean;
  reason: string;
}

export type DeviceExists = (path: string) => boolean;

/**
 * Decide whether this process should ask Chromium for a real GPU.
 *
 * Docker without GPU passthrough has no /dev/nvidia* or /dev/dri — Chrome then
 * uses SwiftShader (CPU) and nvidia-smi on the host stays at 0%.
 *
 * COMPOSITOR_GPU=0/1 overrides autodetection.
 */
export function detectGpu(
  env: NodeJS.Dict<string> = process.env,
  deviceExists: DeviceExists = existsSync,
): GpuDetection {
  if (env.COMPOSITOR_GPU === '0') {
    return { enabled: false, reason: 'COMPOSITOR_GPU=0' };
  }
  if (env.COMPOSITOR_GPU === '1') {
    return { enabled: true, reason: 'COMPOSITOR_GPU=1' };
  }

  const nvidiaVisible = env.NVIDIA_VISIBLE_DEVICES?.trim();
  if (nvidiaVisible && nvidiaVisible !== 'void') {
    return { enabled: true, reason: `NVIDIA_VISIBLE_DEVICES=${nvidiaVisible}` };
  }

  if (deviceExists('/dev/nvidia0')) {
    return { enabled: true, reason: '/dev/nvidia0' };
  }
  if (deviceExists('/dev/dri/renderD128')) {
    return { enabled: true, reason: '/dev/dri/renderD128' };
  }

  return { enabled: false, reason: 'no GPU device in container' };
}

/** Chromium flags so ANGLE uses the host GPU instead of SwiftShader. */
export function chromeGpuArgs(enabled: boolean): string[] {
  if (!enabled) return [];
  return [
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--enable-zero-copy',
    '--enable-accelerated-2d-canvas',
    '--enable-accelerated-video-decode',
    '--enable-accelerated-video-encode',
    '--use-gl=angle',
    '--use-angle=gl',
    '--enable-features=VaapiVideoDecoder,VaapiVideoEncoder,VaapiIgnoreDriverChecks,AcceleratedVideoDecodeLinuxGL,AcceleratedVideoEncoder,CanvasOopRasterization',
    '--disable-features=UseChromeOSDirectVideoDecoder',
  ];
}

export function isSwiftShaderRenderer(renderer: string): boolean {
  return /swiftshader|llvmpipe|softpipe|microsoft basic render/i.test(renderer);
}
