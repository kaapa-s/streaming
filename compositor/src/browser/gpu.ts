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

export type ChromeGpuBackend = 'gl' | 'vulkan';

const VAAPI_FEATURES =
  'VaapiVideoDecoder,VaapiVideoEncoder,VaapiIgnoreDriverChecks,AcceleratedVideoDecodeLinuxGL,AcceleratedVideoEncoder,CanvasOopRasterization';

/** Chromium flags so ANGLE uses the host GPU instead of SwiftShader. */
export function chromeGpuArgs(
  enabled: boolean,
  backend: ChromeGpuBackend = 'gl',
): string[] {
  if (!enabled) return [];
  const angle =
    backend === 'vulkan'
      ? ['--use-gl=angle', '--use-angle=vulkan', '--disable-vulkan-surface']
      : ['--use-gl=angle', '--use-angle=gl'];
  const features =
    backend === 'vulkan'
      ? `Vulkan,DefaultANGLEVulkan,VulkanFromANGLE,${VAAPI_FEATURES}`
      : VAAPI_FEATURES;
  return [
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--enable-zero-copy',
    '--enable-accelerated-2d-canvas',
    '--enable-accelerated-video-decode',
    '--enable-accelerated-video-encode',
    ...angle,
    `--enable-features=${features}`,
    '--disable-features=UseChromeOSDirectVideoDecoder',
  ];
}

export function isSwiftShaderRenderer(renderer: string): boolean {
  return /swiftshader|llvmpipe|softpipe|microsoft basic render/i.test(renderer);
}

interface PageCanvas {
  getContext(type: string): PageGl | null;
}

interface PageGl {
  RENDERER: number;
  getExtension(name: string): { UNMASKED_VENDOR_WEBGL: number; UNMASKED_RENDERER_WEBGL: number } | null;
  getParameter(pname: number): unknown;
}

/**
 * Runs inside Chromium via `page.evaluate`. Must stay serializable (no Node closures).
 */
export function probeGpuRendererInPage(): string {
  const doc = (globalThis as { document?: { createElement: (tag: string) => PageCanvas } }).document;
  if (!doc) return 'no-document';
  const canvas = doc.createElement('canvas');
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  if (!gl) return 'no-webgl';
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  if (!ext) return String(gl.getParameter(gl.RENDERER));
  const vendor = String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL));
  const renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
  return `${vendor} / ${renderer}`;
}

/** Runs on chrome://gpu via page.evaluate. Keep free of Node closures. */
export function summarizeChromeGpuPage(): string {
  const text =
    (globalThis as { document?: { body?: { innerText?: string } } }).document?.body
      ?.innerText ?? '';
  if (!text.trim()) return 'chrome://gpu empty';
  const interesting =
    /GL_RENDERER|GL_VENDOR|GL_VERSION|Canvas|Rasterization|Video Decode|Video Encode|WebGL|Vulkan|SwiftShader|NVIDIA|ANGLE|Software only|Hardware accelerated|Display type|GPU0/i;
  const lines = text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0 && interesting.test(line));
  return lines.slice(0, 50).join(' || ') || `unparsed (${text.length} chars)`;
}
