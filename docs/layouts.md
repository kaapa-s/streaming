# Streaming layouts

Status: **plan** — implement against this doc.

Live program is a 1080p canvas (studio preview + headless recorder). Later we will collect each speaker’s camera and screen files and **restitch** the same session at higher quality. Layouts must therefore be a serializable scene, not only `drawImage` calls against live WebRTC frames.

## Goals

- Honor the existing Scene-strip buttons: `focus`, `pip-left`, `pip-right`, `grid`.
- Keep today’s **presentation** look while a screen is **on the scene** (not a fifth button).
- Same picture on studio preview and recorded/YouTube output.
- Click a **camera** source to choose who is featured.
- Structure the solver so an offline renderer can reuse it with ISO files.

## Non-goals (this pass)

- Per-speaker local ISO capture, upload, clock sync, or ffmpeg restitch.
- A fifth Scene-strip button for presentation.
- Host picking which screen wins if two people share.
- Drag-to-reorder tiles.
- Guests controlling program layout.
- Changing comment overlay behavior.

## Live policy (Option A)

The four buttons only arrange **cameras**. A screen on the scene **overrides** the selected camera preset.

| Host control | Stored | Effective preset |
|--------------|--------|------------------|
| Layout buttons | `cameraPreset` | used when no screen is on the scene |
| Click camera tile | `featuredId` (`{peerId}:camera`) | focus / pip main; first in presentation strip |
| Share screen / window | sources only | tile stays in Sources; program unchanged |
| Click screen tile | `sceneScreenIds` | on-scene screen → `presentation`; none → restore `cameraPreset` |

Preview and recorder derive `presentation` from a **live** screen whose id is in `sceneScreenIds`. Synced host state is `{ cameraPreset, featuredId, sceneScreenIds }`. Sharing never auto-presents.

Default: `cameraPreset = 'focus'`. Default featured: the room owner’s camera. If that peer leaves, keep `featuredId` if it still exists, else the first remaining camera (stable `sourceId` order).

Layout is **owner-only**, same as pinning a comment. Guests see the selected buttons but cannot change them.

---

## Scenes

Featured camera is `YOU`. Other cameras are `G1`, `G2`. Screen is `SCREEN`. PiP tiles sit **on top of** the featured video (true picture-in-picture). Presentation reserves a left column.

### focus

One person on program. Everyone else is off-canvas. Alone, pip looks the same.

```
┌──────────────────────────────────────────────┐
│                                              │
│                                              │
│                                              │
│                     YOU                      │
│                                              │
│                                              │
│                                              │
└──────────────────────────────────────────────┘
```

### pip L

**2 people**

```
┌──────────────────────────────────────────────┐
│                                              │
│  ┌────┐                                      │
│  │ G1 │                                      │
│  └────┘              YOU                     │
│                                              │
│                                              │
│                                              │
└──────────────────────────────────────────────┘
```

**3+ people** — stacked, top-to-bottom

```
┌──────────────────────────────────────────────┐
│  ┌────┐                                      │
│  │ G1 │                                      │
│  └────┘                                      │
│  ┌────┐              YOU                     │
│  │ G2 │                                      │
│  └────┘                                      │
│  ┌────┐                                      │
│  │ G3 │                                      │
│  └────┘                                      │
└──────────────────────────────────────────────┘
```

### pip R

**2 people**

```
┌──────────────────────────────────────────────┐
│                                              │
│                                      ┌────┐  │
│                                      │ G1 │  │
│                     YOU              └────┘  │
│                                              │
│                                              │
│                                              │
└──────────────────────────────────────────────┘
```

**3+ people**

```
┌──────────────────────────────────────────────┐
│                                      ┌────┐  │
│                                      │ G1 │  │
│                                      └────┘  │
│                     YOU              ┌────┐  │
│                                      │ G2 │  │
│                                      └────┘  │
│                                      ┌────┐  │
│                                      │ G3 │  │
│                                      └────┘  │
└──────────────────────────────────────────────┘
```

### grid

Equal tiles, cover-fit, 8px gaps. Column count is unchanged: `n <= 2 → n` columns, else `ceil(sqrt(n))`.

**1** — full frame (same box as focus).

**2**

```
┌─────────────────────┬────────────────────────┐
│                     │                        │
│        YOU          │          G1            │
│                     │                        │
└─────────────────────┴────────────────────────┘
```

**3** — 2×2 with an empty cell

```
┌─────────────────────┬────────────────────────┐
│        YOU          │          G1            │
├─────────────────────┼────────────────────────┤
│         G2          │                        │
└─────────────────────┴────────────────────────┘
```

**4**

```
┌─────────────────────┬────────────────────────┐
│        YOU          │          G1            │
├─────────────────────┼────────────────────────┤
│         G2          │          G3            │
└─────────────────────┴────────────────────────┘
```

### presentation (while a screen is on the scene)

Not a Scene-strip button. Left strip ~14% (today’s `SPEAKER_STRIP_RATIO`), 9:16-ish camera tiles, cover-fit. Main area: screen **contain-fit** (letterbox if needed).

**1 camera + screen**

```
┌────────┬─────────────────────────────────────┐
│        │                                     │
│  YOU   │              SCREEN                 │
│        │                                     │
└────────┴─────────────────────────────────────┘
```

**2 cameras + screen**

```
┌────────┬─────────────────────────────────────┐
│  YOU   │                                     │
│        │              SCREEN                 │
│  G1    │                                     │
└────────┴─────────────────────────────────────┘
```

**3 cameras + screen**

```
┌────────┬─────────────────────────────────────┐
│  YOU   │                                     │
│  G1    │              SCREEN                 │
│  G2    │                                     │
└────────┴─────────────────────────────────────┘
```

If two screens are live, the first screen in stable `sourceId` order is main. No picker this pass.

### empty

No cameras and no screen — keep the existing waiting card, any preset.

```
┌──────────────────────────────────────────────┐
│           Waiting for speakers…              │
└──────────────────────────────────────────────┘
```

Name labels stay on tiles (existing style). Comment overlay stays a lower-third on top of whatever scene is up.

---

## Architecture

Live canvas is a **renderer** of a layout, not the layout itself. Offline restitch will call the same solver with file-backed sources and a larger output size (e.g. 4K).

```
Studio owner
  cameraPreset + featuredId + sceneScreenIds
        │
        ├─► preview compositor.setLayout()
        └─► POST /api/rooms/:slug/layout
                  └─► compositor __setLayout()
                            └─► recorder compositor.setLayout()

Peers + screen tracks ──► setPeers() on both compositors
                              │
                    layoutSolve(scene, outputSize)
                              │
                    placements[]  ─ live: canvas
                                  ─ later: ffmpeg / file renderer
```

### Solver vs renderer

| Piece | Owns | Must not |
|-------|------|----------|
| `layoutSolve` | preset, source list, featured id, canvas size → rects + `cover`/`contain` | DOM, `MediaStream`, hardcoded 1920×1080 |
| Live compositor | bind tracks, draw placements, mix audio, overlay | infer layout from Map insertion except via the solver |
| Studio controller | Option A: buttons, featured click, owner-only POST | draw pixels |

`presentation` is an **effective preset** the solver understands. Membership is policy in `effectivePreset()` (`sceneScreenIds` ∩ live screens), not an `if (screenStream)` buried in `draw()`.

### Source ids

Stable ids, same on preview and recorder:

```text
{peerId}:camera
{peerId}:screen
```

Stop using compositor peer id `'local'`. Preview must pass the host’s `SfuClient.peerId` so `featuredId` matches the recorder’s SFU ids.

Sort sources by `id` when the solver needs a deterministic order (grid leftover cells, two screens, featured fallback).

### Serializable types

Live in `@streaming/canvas-compositor` (imported by web, compositor page, and tests). Suggested shape:

```ts
export type CameraPreset = 'focus' | 'pip-left' | 'pip-right' | 'grid';
export type LayoutPreset = CameraPreset | 'presentation';

export type SourceKind = 'camera' | 'screen';

export interface LayoutSource {
  id: string;       // `${peerId}:${kind}`
  peerId: string;
  kind: SourceKind;
  name: string;
  aspectRatio?: number; // width/height when known; solver falls back per kind
}

export interface LayoutState {
  cameraPreset: CameraPreset;
  featuredId: string | null; // camera source id
  sceneScreenIds: string[]; // `${peerId}:screen` on program
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

export function sourceId(peerId: string, kind: SourceKind): string;
export function effectivePreset(state: LayoutState, sources: LayoutSource[]): LayoutPreset;
export function layoutSolve(
  state: LayoutState,
  sources: LayoutSource[],
  width: number,
  height: number,
): Placement[];
```

`layoutSolve` uses `effectivePreset` internally. Output size is an argument so restitch can run at 3840×2160 later without changing the scene.

### Compositor API additions

Keep `setPeers` / `setOverlay` / `resize`. Add:

```ts
setLayout(state: LayoutState): void;
```

Each draw: build `LayoutSource[]` from current peers (including `screenStream` → `:screen`), call `layoutSolve`, paint each placement. Do not branch on screen inside `draw()` except through the solver.

### Geometry (lock these unless product revises)

| Preset | Rules |
|--------|--------|
| focus | Featured camera cover-fit, full canvas. No other cameras. |
| pip L/R | Featured cover-fit full canvas. Other **cameras** as 16:9 cover-fit tiles, width = 18% of canvas, 24px inset from the chosen edge and from top/bottom, 8px gap, stack vertically **centered** as a group. Alone → same as focus. Screens are not PiP tiles (on-scene screens trigger presentation). |
| grid | Existing algorithm, cameras only, cover-fit, 8px gap. Featured is first tile, then remaining cameras by `id`. |
| presentation | Existing strip: `SPEAKER_STRIP_RATIO = 0.14`, cameras stacked left (tile height `min(tileW * 9/16, available / n)`), featured first. Main: first screen contain-fit. |

---

## Studio wiring

1. Move `LayoutPreset` / `CameraPreset` out of `SceneStrip.tsx` into `@streaming/canvas-compositor`.
2. Lift `{ cameraPreset, featuredId, sceneScreenIds, setLayout }` into `StudioValue` / `useStudioController` (not local `useState` in the strip).
3. `SceneStrip`: layout buttons call `setLayout`; highlight `cameraPreset`. While a screen is on the scene, still show the last camera preset as selected (presentation is not a button).
4. Camera `VideoTile`s are clickable for the owner; featured tile gets the selected treatment (reuse accent border). Screen tiles stay in Sources while sharing; owner click toggles `sceneScreenIds`. Local screen has a remove control (stop capture).
5. `useProgramPreview` calls `setLayout` whenever layout state changes; `setPeers` uses `localPeerId` instead of `'local'`.
6. Owner `setLayout` also `POST /api/rooms/:slug/layout` (mirror overlay). Apply locally first so preview does not wait on the recorder.
7. Non-owners: buttons and tile-promote disabled.

Plumb `sfu.peerId` from `useStudioSession` into preview + featured default.

---

## Recorder sync

Copy the overlay path:

```
POST /api/rooms/:slug/layout     (JWT, owner)
  → server requireOwner + CompositorClient.setLayout
      → POST /internal/rooms/:slug/layout
          → page.evaluate(__setLayout)
```

Compositor page:

```ts
window.__setLayout = (state) => compositor.setLayout(state);
```

If the recorder is not warm yet, follow overlay: log/warn; layout can retry on next owner click. A live screen track does not enter presentation until `sceneScreenIds` is synced.

On **go-live / start recording**, write a scene snapshot to the existing session log, and write again on each `__setLayout` while recording, e.g.

```text
2026-09-12T16:00:00.000Z scene {"cameraPreset":"pip-right","featuredId":"p1:camera","sceneScreenIds":["p1:screen"],"effective":"presentation","sources":["p1:camera","p2:camera","p1:screen"]}
```

That log is the restitch timeline. Do not invent a new store this pass.

Warmup: recorder starts at default `focus` until the first owner POST. After join, studio should POST the current layout once so a warm tab matches preview before record starts (same idea as overlay only existing after pin — here we should push on join + on every change).

---

## Implementation order

1. **`layoutSolve` + unit tests** in `shared/canvas-compositor` (no canvas). Cover 0–5 cameras, pip L/R, grid 1–4, presentation 1–3 cameras + screen, featured fallback, two screens.
2. **Compositor renderer** uses placements; keep overlay + audio mix. Extend `/compositor-dev` with the four buttons, featured picker, and screen toggle.
3. **Studio**: lift state, wire preview, click-to-feature, owner-only.
4. **API + `__setLayout`** so recording/YouTube match preview.
5. **Session-log scene lines** on record start and layout change.

## Files (expected)

| Area | Path |
|------|------|
| Solver | `shared/canvas-compositor/src/layout.ts` |
| Tests | `shared/canvas-compositor/src/layout.test.ts` |
| Draw | `shared/canvas-compositor/src/index.ts` |
| Playground | `web/src/pages/CompositorDev.tsx` |
| Scene UI | `web/src/components/studio/SceneStrip.tsx` |
| Preview | `web/src/hooks/useProgramPreview.ts` |
| Studio state | `web/src/studio/studioHandle.ts`, `useStudioController.ts`, `useStudioSession.ts` |
| API | `server/src/rooms/` or comments-adjacent layout route; `CompositorClient` |
| Recorder page | `compositor/page/src/CompositorPage.tsx` + globals |
| Puppeteer | `compositor/src/sessions/sessions.service.ts` |

## Later (restitch)

Not in this pass, but the above is the contract:

- Each speaker uploads camera ISO + optional screen ISO keyed by `{peerId}:camera` / `{peerId}:screen`.
- Parse `scene {…}` lines (or a future JSONL sidecar) for `cameraPreset` / `featuredId` over time.
- Call `layoutSolve` at the master resolution and composite files into those rects.
- Re-edit = rewrite the scene timeline and run the solver again; no need to reverse-engineer the live `.webm`.
