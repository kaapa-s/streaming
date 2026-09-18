export type CameraPreset = 'focus' | 'pip-left' | 'pip-right' | 'grid';
export type LayoutPreset = CameraPreset | 'presentation';
export type SourceKind = 'camera' | 'screen';

export interface LayoutSource {
  id: string;
  peerId: string;
  kind: SourceKind;
  name: string;
  /** width/height when known; unused by the live solver (renderer applies fit). */
  aspectRatio?: number;
}

export interface LayoutState {
  cameraPreset: CameraPreset;
  featuredId: string | null;
  /** `${peerId}:screen` ids on program. Live screens not listed stay in Sources only. */
  sceneScreenIds: string[];
  /**
   * `${peerId}:camera` ids on program. Live cameras not listed stay in Sources
   * only. When `undefined` every live camera is on program (legacy stored
   * layouts); when defined (including `[]`) only the listed cameras are.
   */
  sceneCameraIds?: string[];
}

export interface Placement {
  sourceId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fit: 'cover' | 'contain';
  label?: string;
}

export interface LayoutSnapshot {
  cameraPreset: CameraPreset;
  featuredId: string | null;
  sceneScreenIds: string[];
  /** Program cameras; omitted when the layout predates scene-camera gating. */
  sceneCameraIds?: string[];
  effective: LayoutPreset;
  sources: string[];
  /** Camera sources whose peer audio is included in the program mix. */
  audioSourceIds: string[];
}

export const SPEAKER_STRIP_RATIO = 0.14;

const GAP = 8;
const PIP_WIDTH_RATIO = 0.18;
const PIP_INSET = 24;

export function sourceId(peerId: string, kind: SourceKind): string {
  return `${peerId}:${kind}`;
}

function sceneScreensOf(state: LayoutState, sources: LayoutSource[]): LayoutSource[] {
  const onScene = new Set(state.sceneScreenIds);
  return screensOf(sources).filter((source) => onScene.has(source.id));
}

export function effectivePreset(state: LayoutState, sources: LayoutSource[]): LayoutPreset {
  if (sceneScreensOf(state, sources).length > 0) return 'presentation';
  return state.cameraPreset;
}

function byId(a: LayoutSource, b: LayoutSource): number {
  return a.id.localeCompare(b.id);
}

function camerasOf(sources: LayoutSource[]): LayoutSource[] {
  return sources.filter((source) => source.kind === 'camera');
}

/**
 * Live cameras allowed on program. Legacy layouts (no `sceneCameraIds`) keep
 * composing every connected camera; once the owner has set scene membership
 * (`sceneCameraIds` defined, including `[]`) off-scene cameras stay in Sources.
 */
function programCamerasOf(state: LayoutState, sources: LayoutSource[]): LayoutSource[] {
  const cameras = camerasOf(sources);
  if (state.sceneCameraIds === undefined) return cameras;
  const onScene = new Set(state.sceneCameraIds);
  return cameras.filter((source) => onScene.has(source.id));
}

function screensOf(sources: LayoutSource[]): LayoutSource[] {
  return sources.filter((source) => source.kind === 'screen').sort(byId);
}

function resolveFeatured(state: LayoutState, cameras: LayoutSource[]): LayoutSource | undefined {
  if (state.featuredId) {
    const found = cameras.find((camera) => camera.id === state.featuredId);
    if (found) return found;
  }
  return [...cameras].sort(byId)[0];
}

function otherCameras(cameras: LayoutSource[], featured: LayoutSource): LayoutSource[] {
  return cameras.filter((camera) => camera.id !== featured.id).sort(byId);
}

function orderedCameras(cameras: LayoutSource[], featured: LayoutSource | undefined): LayoutSource[] {
  if (!featured) return [...cameras].sort(byId);
  return [featured, ...otherCameras(cameras, featured)];
}

function px(x: number, y: number, w: number, h: number): { x: number; y: number; w: number; h: number } {
  return {
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(w),
    h: Math.round(h),
  };
}

function cameraTile(
  source: LayoutSource,
  x: number,
  y: number,
  w: number,
  h: number,
  fit: 'cover' | 'contain' = 'cover',
): Placement {
  const box = px(x, y, w, h);
  return {
    sourceId: source.id,
    ...box,
    fit,
    label: source.name,
  };
}

function screenTile(source: LayoutSource, x: number, y: number, w: number, h: number): Placement {
  const box = px(x, y, w, h);
  return {
    sourceId: source.id,
    ...box,
    fit: 'contain',
  };
}

function solveFocus(featured: LayoutSource | undefined, width: number, height: number): Placement[] {
  if (!featured) return [];
  return [cameraTile(featured, 0, 0, width, height)];
}

function solvePip(
  featured: LayoutSource | undefined,
  rest: LayoutSource[],
  width: number,
  height: number,
  side: 'left' | 'right',
): Placement[] {
  if (!featured) return [];
  const placements = solveFocus(featured, width, height);
  if (rest.length === 0) return placements;

  const tileW = Math.round(width * PIP_WIDTH_RATIO);
  const tileH = Math.round(tileW * (9 / 16));
  const n = rest.length;
  const totalH = n * tileH + (n - 1) * GAP;
  const minY = PIP_INSET;
  const maxY = height - PIP_INSET - totalH;
  let y0 = Math.round((height - totalH) / 2);
  if (maxY >= minY) {
    y0 = Math.max(minY, Math.min(y0, maxY));
  } else {
    y0 = minY;
  }
  const x = side === 'left' ? PIP_INSET : width - PIP_INSET - tileW;

  rest.forEach((source, i) => {
    placements.push(cameraTile(source, x, y0 + i * (tileH + GAP), tileW, tileH));
  });
  return placements;
}

function solveGrid(
  featured: LayoutSource | undefined,
  cameras: LayoutSource[],
  width: number,
  height: number,
): Placement[] {
  const ordered = orderedCameras(cameras, featured);
  if (ordered.length === 0) return [];
  if (ordered.length === 1) return solveFocus(ordered[0], width, height);

  const n = ordered.length;
  const cols = n <= 2 ? n : Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const tileW = (width - GAP * (cols + 1)) / cols;
  const tileH = (height - GAP * (rows + 1)) / rows;

  return ordered.map((source, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return cameraTile(source, GAP + col * (tileW + GAP), GAP + row * (tileH + GAP), tileW, tileH);
  });
}

function solvePresentation(
  featured: LayoutSource | undefined,
  cameras: LayoutSource[],
  screens: LayoutSource[],
  width: number,
  height: number,
): Placement[] {
  const placements: Placement[] = [];
  const ordered = orderedCameras(cameras, featured);
  const stripW = Math.floor(width * SPEAKER_STRIP_RATIO);
  const mainX = stripW + GAP;
  const mainW = width - mainX - GAP;
  const mainY = GAP;
  const mainH = height - GAP * 2;

  if (ordered.length > 0) {
    const tileW = stripW - GAP;
    const tileH = Math.round(
      Math.min(
        tileW * (9 / 16),
        (height - GAP * (ordered.length + 1)) / ordered.length,
      ),
    );
    const totalH = ordered.length * tileH + (ordered.length - 1) * GAP;
    let y = Math.round(Math.max(GAP, (height - totalH) / 2));
    for (const camera of ordered) {
      placements.push(cameraTile(camera, GAP, y, tileW, tileH));
      y += tileH + GAP;
    }
  }

  const screen = screens[0];
  if (screen) {
    placements.push(screenTile(screen, mainX, mainY, mainW, mainH));
  }
  return placements;
}

export function layoutSolve(
  state: LayoutState,
  sources: LayoutSource[],
  width: number,
  height: number,
): Placement[] {
  const preset = effectivePreset(state, sources);
  const cameras = programCamerasOf(state, sources);
  const screens = sceneScreensOf(state, sources);
  const featured = resolveFeatured(state, cameras);

  switch (preset) {
    case 'focus':
      return solveFocus(featured, width, height);
    case 'pip-left':
      return solvePip(featured, featured ? otherCameras(cameras, featured) : [], width, height, 'left');
    case 'pip-right':
      return solvePip(featured, featured ? otherCameras(cameras, featured) : [], width, height, 'right');
    case 'grid':
      return solveGrid(featured, cameras, width, height);
    case 'presentation':
      return solvePresentation(featured, cameras, screens, width, height);
    default: {
      const _exhaustive: never = preset;
      return _exhaustive;
    }
  }
}
