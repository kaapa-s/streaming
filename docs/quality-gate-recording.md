# Deterministic recording diagnostics

The quality gate records three different quantities. They must not be compared as
if they were the same counter:

- **Source canvas counter** (`source-frame-counters.json`): the number rendered by
the Alice/Bob browser fixture before each canvas draw. The burned-in `frame N`
label is scoped to this counter. It is configured at 30 draws/sec, but it is not
an encoded-frame or playback counter.
- **Encoded frame count** (`media-validation.json`, from `ffprobe -show_frames`):
the number of video packets/frames in the saved output. Its timestamps are the
objective playback timeline.
- **Decoded/seek position**: VLC may decode ahead after a seek and display a
later decoded frame. A burned-in source label can therefore jump forward in the
UI, without changing the file's encoded frame count or timestamps.

## Staged recording contract

The recording is 17 seconds nominally: a 1 second lead-in, followed by three
5-second phases and a 1 second stop/encoder margin. The visual-only cues are
exactly `BOB SOLO`, `ALICE SOLO`, and `BOB + ALICE`. The deterministic tones remain
audible and are 660 Hz for Bob and 440 Hz for Alice. Audio validation samples a
1.5-second interior window for each phase, searches startup offsets, and checks
presence/absence and order rather than relying on a whole-file midpoint.

## Cadence and VLC evidence

The gate reports `video.cadence` from encoded timestamp deltas (median interval,
measured FPS, min/max interval, and sample count). It deliberately does **not**
require or normalize compositor output to 30 fps: the compositor's actual cadence
is whatever the artifact reports. The stable invariants are present monotonic
video timestamps, sufficient duration/frame count, and cadence reported beside
that count.

In addition to phase cue frames, `frame-change-diagnostics.json` extracts decoded
frames at t=1, 4.5, 7.5, and 10 seconds and records their byte counts and SHA-256
hashes. The latest inspected run showed burned-in labels updating and different
hashes at all of those timestamps. This is objective evidence that the saved file
contains changing content; a VLC symptom where labels appear stale or jump after
seeking is therefore more likely playback/seek rendering than missing frame data.
The diagnostic requires more than one distinct decoded hash but does not use OCR
or pixel-perfect screenshots as the quality oracle.

The source counter artifact, frame-change diagnostic, ffprobe JSON, and
timestamp-derived cadence are the reproducible diagnostics.

The live 5-second-phase run at
`e2e/e2e-artifacts/2026-09-16T08-39-11-864Z-56828-378a2bf3` reported four distinct
hashes for the requested frames: `f014ceed...02d94` (1s),
`f2801b23...00320` (4.5s), `5736b232...72245` (7.5s), and
`7fe09797...3b468` (10s). The full hashes are in
`frame-change-diagnostics.json`; the phase PNGs visibly contain the expected
burned-in labels.
