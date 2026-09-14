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

/**
 * ANGLE backend for Linux Chromium.
 *
 * `gl-egl` binds EGL surfacelessly, so ozone-headless gets a hardware output
 * surface with no X server. `gl` (the old default) means GLX, which needs a
 * DISPLAY that containers do not have — it yields no-webgl and software
 * compositing. Measured on a Tesla T4: gl-egl gives gpu_compositing=enabled,
 * gl gives disabled_software.
 *
 * COMPOSITOR_ANGLE overrides it (gl-egl, gles-egl, vulkan, swiftshader).
 */
export const DEFAULT_ANGLE_BACKEND = 'gl-egl';

export function resolveAngleBackend(env: NodeJS.Dict<string> = process.env): string {
  return env.COMPOSITOR_ANGLE?.trim() || DEFAULT_ANGLE_BACKEND;
}

/** A failed GPU verdict kills the container only when this is set. */
export function isGpuStrict(env: NodeJS.Dict<string> = process.env): boolean {
  return env.COMPOSITOR_GPU_STRICT === '1';
}

/** Chromium flags so ANGLE uses the host GPU instead of SwiftShader. */
export function chromeGpuArgs(
  enabled: boolean,
  platform: NodeJS.Platform = process.platform,
  angle: string = resolveAngleBackend(),
): string[] {
  if (!enabled) return [];
  // macOS: default Metal. NVIDIA ANGLE/Vulkan flags crash or disable the GPU process.
  if (platform === 'darwin') {
    return [
      '--enable-gpu',
      '--ignore-gpu-blocklist',
      '--enable-gpu-rasterization',
      '--enable-accelerated-2d-canvas',
    ];
  }
  // No --disable-software-rasterizer: it turns every GPU init failure into a
  // bare "no-webgl" instead of a renderer string that names SwiftShader.
  // assertHardwareGpuRenderer already refuses CPU rendering, and readably.
  //
  // No Vulkan feature flags either. DefaultANGLEVulkan/VulkanFromANGLE move viz
  // itself onto Vulkan, which then needs a real window surface — that is what
  // produced gpu_compositing=disabled_software. ANGLE over EGL needs none.
  return [
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--enable-zero-copy',
    '--enable-accelerated-2d-canvas',
    '--disable-gpu-sandbox',
    '--use-gl=angle',
    `--use-angle=${angle}`,
    '--use-cmd-decoder=passthrough',
  ];
}

export function isSwiftShaderRenderer(renderer: string): boolean {
  return /swiftshader|llvmpipe|softpipe|microsoft basic render/i.test(renderer);
}

/** True when Chromium did not attach a real GPU (CPU / probe failure). */
export function isSoftwareGpuRenderer(renderer: string): boolean {
  if (isSwiftShaderRenderer(renderer)) return true;
  return /no-webgl|no-document|probe-failed/i.test(renderer);
}

export function hardwareGpuRequiredError(
  gpu: GpuDetection,
  renderer: string,
  angle: string,
): Error {
  return new Error(
    `Chromium must run on the GPU (${gpu.reason}, ANGLE ${angle}) but renderer is ${renderer}. ` +
      'Refusing CPU/SwiftShader. Run ./scripts/verify-compositor-gpu.sh',
  );
}

export function assertHardwareGpuRenderer(
  gpu: GpuDetection,
  renderer: string,
  angle: string,
): void {
  if (!gpu.enabled) return;
  if (isSoftwareGpuRenderer(renderer)) {
    throw hardwareGpuRequiredError(gpu, renderer, angle);
  }
}

export type GpuEncodeMode = 'nvenc' | 'mediarecorder';

/** CDP `SystemInfo.getInfo` gpu.featureStatus (chrome://gpu Feature Status). */
export type GpuFeatureStatus = Record<string, string>;

export function isGpuCompositingEnabled(status: string | undefined): boolean {
  return typeof status === 'string' && status.startsWith('enabled');
}

export function softwareCompositingError(
  gpu: GpuDetection,
  angle: string,
  compositing: string | undefined,
): Error {
  return new Error(
    `Chromium gpu_compositing=${compositing ?? 'unknown'} (${gpu.reason}, ANGLE ${angle}). ` +
      'Need enabled (not disabled_software) or Blink rasterizes the 2D canvas on CPU. ' +
      'Try COMPOSITOR_ANGLE=gl-egl and run ./scripts/verify-compositor-gpu.sh',
  );
}

export function assertHardwareGpuCompositing(
  gpu: GpuDetection,
  angle: string,
  featureStatus: GpuFeatureStatus,
): void {
  if (!gpu.enabled) return;
  const compositing = featureStatus.gpu_compositing;
  if (isGpuCompositingEnabled(compositing)) return;
  if (featureStatus.probe_error) {
    throw new Error(
      `Chromium GPU compositing probe failed (${gpu.reason}, ANGLE ${angle}): ${featureStatus.probe_error}`,
    );
  }
  throw softwareCompositingError(gpu, angle, compositing);
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
