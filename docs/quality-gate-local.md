# Deterministic local quality gate

This is the reproducible, local-only gate for the streaming stack. It creates two
synthetic speakers in Chromium, publishes deterministic audio/video through the
local API and SFU, records with the local compositor, and validates the saved
media plus a loopback RTMP copy.

## Scope and exclusions

The gate validates only the local development stack:

- API, SFU, compositor, web, and the local Postgres service are reachable.
- Two deterministic browser speakers publish one audio and one video track each.
- Remote audio has the expected 440/660 Hz tones and no measurable self-feedback.
- The compositor visits the expected camera/screen scenes and writes local media.
- The recording has usable audio/video, dimensions, duration, timestamps, keyframes,
  staged phase tones, non-black frames, and changing decoded-frame hashes.
- The RTMP check publishes to a one-shot receiver on `127.0.0.1` and validates the
  captured H.264/AAC payload. It does not contact an RTMP provider.

This is **not** AI review, an overnight or soak test, a production deployment
test, or a test of AWS/S3, YouTube, Facebook, Instagram, LinkedIn, X, or any
other external destination. It does not validate OAuth, platform APIs, external
network ICE, GPU performance, or long-running resource behavior. Do not provide
external destination keys or AWS credentials for this gate.

## Prerequisites

- macOS or Linux
- Node.js 22 or newer and npm
- Docker Desktop/Engine with the Compose plugin; the current user must be able
  to run `docker compose`
- `ffmpeg` **and** `ffprobe` on `PATH` (or set `FFMPEG_PATH` and `FFPROBE_PATH`)
- Enough local disk for Chromium and a short recording (the gate retains its
  diagnostics)

For example, on macOS: `brew install node ffmpeg docker` and start Docker Desktop.
The repository's compositor install downloads its Puppeteer-managed Chrome; no
system Chrome is required.

## Start the local stack

From the repository root, on a clean checkout:

```bash
npm run setup
```

The setup command creates missing `server/.env`, `sfu/.env`, and `compositor/.env`
from their examples, starts the development Postgres container, installs all
workspace dependencies, runs migrations, installs Puppeteer Chrome, and then
keeps API (`3000`), SFU (`3001`), compositor (`3002`), and web (`5173`) running.
It is a foreground command. Leave it running and use a second terminal for the
gate. The generated example secrets already match where required for local use;
no AWS, OAuth, or destination configuration is needed.

If the dependencies and env files already exist, `npm run dev` is sufficient after
confirming Postgres is running with:

```bash
docker compose -f server/docker-compose.yml up -d
npm run dev
```

## Run the gate

In a second repository-root terminal, run the one command:

```bash
npm run quality-gate
```

The command is bounded (150 seconds by default) and uses only the local origins:
API `http://localhost:3000/api`, web `https://localhost:5173`, SFU
`http://localhost:3001`, and compositor `http://localhost:3002`. Override an origin
only when deliberately running the same local stack on different ports. The gate
starts its own loopback RTMP receiver; no RTMP server or external service is
required. The receiver uses the same `/quality-gate` stream path for listening and
publishing so normal publisher disconnects close the captured FLV without a misleading
path error.

A passing run ends with `Quality gate PASS` and exits 0. To emit the complete report as one JSON line, use `QUALITY_GATE_JSON=1 npm run quality-gate`.
For a targeted reproduction, use `npm run quality-gate -- --only=<check-id>`. It evaluates only the requested preflight, or the requested product check plus the preflights and harness required to evaluate it; unrelated checks are skipped. The default command still runs the complete deterministic gate. Failed checks include a `reproduce` command and `diagnostic` field.

The report schema is `quality-gate/v1`. Its stable check catalog is `quality-gate/checks-v1`; IDs and meanings are:

| ID | Meaning |
| --- | --- |
| `preflight.api` | API service is reachable |
| `preflight.web` | Web application is reachable |
| `preflight.sfu` | SFU service is reachable |
| `preflight.compositor` | Compositor service is reachable |
| `preflight.ffmpeg` | ffmpeg is available |
| `preflight.ffprobe` | ffprobe is available |
| `preflight.node` | Node.js is available |
| `infra.harness-timeout` | Browser harness completes within its bounded timeout |
| `browser.publish` | Two speakers publish audio and video |
| `studio.remote-audio` | Remote audio is bidirectional without self-feedback |
| `compositor.scenes` | Compositor scenes and screen transition satisfy the layout contract |
| `recording.output` | Local recording satisfies the media contract |
| `recording.rtmp` | Loopback RTMP satisfies the H.264/AAC contract |

Each report check contains its measured values, threshold, status, artifact paths, and reproduction command. `artifacts.readable` lists the JSON, table, and log files intended for automated diagnosis; binary recordings and screenshots are retained only as supporting evidence.

## Artifacts

Every invocation gets a unique directory under:

```text
e2e/e2e-artifacts/<UTC-timestamp>-<pid>-<id>/
```

`report.json` is the summary. It records each check, measured values, thresholds,
service origins, outcome, and artifact paths. Useful files include `browser.log`,
`browser.error.log`, `compositor.session.log`, `layout-frames.json` and its
`layout-*.png` human-facing layout evidence (including
`layout-grid-side-by-side.png`), `ffprobe.json`, `media-validation.json`,
`audio-analysis.json`, `phase-analysis.json`,
`phase-frames.json`, `frame-change-diagnostics.json`, the timestamp/phase PNGs,
`source-frame-counters.json`, and `rtmp/rtmp-validation.json` with its captured
`rtmp-received.flv`. Failure runs also retain `run.json`, browser screenshots,
and HTML where available. Artifacts are intentionally retained for diagnosis;
remove an old run directory manually when it is no longer needed.

The temporary compositor `.webm` and session log are removed from
`compositor/recordings` by the harness after the run. The diagnostic copy of the
session log remains in the artifact directory.

## Failure meanings and recovery

- `preflight.*`: a local service or required executable is unavailable. Start
  the stack, check its terminal logs, or install `ffmpeg`/`ffprobe`.
- `infra.harness-timeout`: the browser run exceeded the bounded timeout; inspect
  the retained browser and compositor logs before retrying.
- `browser.publish` / `studio.remote-audio`: browser join, media publication,
  or local signaling/audio failed; check matching local secrets and service logs.
- `compositor.scenes` / `recording.output`: the compositor scene or saved media
  contract failed; inspect the session log, `ffprobe.json`, and media analysis.
- `recording.rtmp`: the loopback copy failed; inspect `rtmp/rtmp-receiver.log`
  and verify the installed ffmpeg supports RTMP.
- A report with `passed: false` is a failed gate even if some checks passed.
  Re-run after fixing the first infrastructure failure; do not interpret a
  blocked check as a product pass.

## Cleanup and no-leak behavior

The gate does not stop the development services or Postgres because they are the
local stack shared by the developer. Stop them explicitly when finished:

```bash
# stop the foreground npm run setup/npm run dev with Ctrl-C
# then, if Postgres is no longer needed:
docker compose -f server/docker-compose.yml down
```

The harness always attempts, including on failure, to stop the recording, stop
synthetic media tracks and audio contexts, close both browser pages and the
Puppeteer browser, remove the temporary compositor recording/session log, and
stop the loopback RTMP receiver. A failed cleanup is printed to the gate output;
retain the artifacts and inspect for a leftover `node`, Chromium, or `ffmpeg`
process before retrying. The gate does not delete diagnostic artifacts.

No command in this workflow invokes production Compose, deployment scripts,
AWS, OAuth, YouTube, or an external destination.

## On-demand verification agent

The optional agent wrapper runs the deterministic gate, sends the JSON report and
readable artifacts to OpenRouter for bounded diagnosis, and reruns the gate after
a product-only patch when the model returns a valid patch:

```bash
OPENROUTER_API_KEY=... npm run quality-agent
```

Set `OPENROUTER_MODEL` and `QUALITY_AGENT_MAX_RUNS` (default `3`) to configure the
model and retry budget. The wrapper never edits `scripts/quality-gate.mjs`, `e2e/`,
tests, or files outside `server/`, `sfu/`, `web/`, `compositor/`, `shared/`, and
`scripts/`; it never commits or closes Beads issues. Every run retains
`report.json`, `agent.log`, gate attempt directories, and `applied.patch` under
`e2e/quality-agent-artifacts/`. Missing credentials, rejected patches, suspected
test issues, infrastructure failures, and exhausted retries remain failed runs for
human review.

For durable escalation, provide the triggering Beads issue with
`QUALITY_AGENT_TRIGGER_ISSUE=<issue-id>` or `npm run quality-agent -- --issue=<issue-id>`.
A failed product-bug or flake run creates one `[agent]` bug bead with labels
`agent-filed`, `triage`, and `quality-gate`; its description includes the run ID,
failing check IDs, measured values and thresholds, artifact directory, hypotheses,
attempted actions, and a reproduction command. The agent comments the triggering
issue with the same summary and does not close any issue. A `suspected-test-issue`
result only comments the triggering issue and records the classification in the
`quality-agent/v1` report; it never edits tests or gate code. If no triggering issue
is supplied, the report still records the escalation status and retained artifacts
for a human to attach to the appropriate bead.
