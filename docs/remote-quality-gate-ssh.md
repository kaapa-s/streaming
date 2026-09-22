# Remote quality-gate run over SSH

This runbook provisions and operates the deterministic quality gate on a separate macOS host. The host name, user, SSH key, and checkout location are intentionally operator-provided; do not put them in this repository.

## Access model

The primary machine connects as the operator's normal account through an SSH alias already present in `~/.ssh/config`:

```bash
ssh <herdr-ssh-alias>
```

The alias must identify the separate MacBook and use key-based authentication. The operator who owns that SSH key is responsible for access.

All provisioning and runs happen on the MacBook. The primary machine only retrieves the retained artifact directory with `rsync` after the run.

## Provision the MacBook

Run these commands in an SSH session on the MacBook:

```bash
mkdir -p "$HOME/src" "$HOME/.cache/streaming-quality-gate"
brew install node ffmpeg docker
```

Start Docker Desktop and ensure the Compose plugin is available, then verify every required executable:

```bash
node --version
npm --version
ffmpeg -version
ffprobe -version
docker version
docker compose version
```

Node.js 22 or newer is required. The current user must be able to run `docker compose` without `sudo`.

Check out the repository into the operator-owned path. Use the repository's approved Git remote rather than copying credentials into the checkout:

```bash
cd "$HOME/src"
git clone <repository-url> streaming
cd streaming
git checkout <revision-or-branch>
```

If the checkout already exists, update it using the normal project workflow and confirm the intended revision before running the gate:

```bash
cd "$HOME/src/streaming"
git status --short --branch
git rev-parse --short HEAD
```

Install the project and browser dependencies with the repository bootstrap. This creates local example environment files, starts development Postgres, runs migrations, installs workspace dependencies, and installs Puppeteer-managed Chrome:

```bash
npm run setup
```

`npm run setup` is a foreground command and starts the local API, SFU, compositor, and web processes. For a first provisioning run, let it finish its install and startup output. Stop it with `Ctrl-C` after confirming that the stack starts, then use the headless invocation below for verification runs.

## Start, invoke, and stop headlessly

From the repository root, create a per-run artifact directory and start the local stack in the background:

```bash
cd "$HOME/src/streaming"
export QUALITY_GATE_ARTIFACT_DIR="$HOME/.cache/streaming-quality-gate/$(date -u +%Y%m%dT%H%M%S)Z"
mkdir -p "$QUALITY_GATE_ARTIFACT_DIR"
nohup npm run setup >"$QUALITY_GATE_ARTIFACT_DIR/stack.log" 2>&1 &
export STREAMING_SETUP_PID=$!
```

Wait for the stack startup output to settle, then run the deterministic gate in a second SSH command or shell on the same MacBook:

```bash
cd "$HOME/src/streaming"
export QUALITY_GATE_ARTIFACT_DIR='<the-artifact-directory-created-above>'
QUALITY_GATE_JSON=1 npm run quality-gate
```

A successful gate run exits zero and reports `passed: true` in the JSON report. A failed run exits nonzero and retains diagnostics for review.

Stop the processes only after the run and artifact retrieval have completed:

```bash
if [[ -n "${STREAMING_SETUP_PID:-}" ]]; then
  kill "$STREAMING_SETUP_PID" 2>/dev/null || true
fi
docker compose -f server/docker-compose.yml down
```

If the SSH session that started the stack has ended, identify only the processes started for this run from `stack.log` and the recorded PID before stopping them. Do not kill unrelated developer services.

## Artifact retention and retrieval

The remote retention root is `$HOME/.cache/streaming-quality-gate`. Keep each run directory until the report has been reviewed and copied to the primary machine. Remove runs older than the agreed operational retention period manually; no automatic deletion is performed because artifacts are needed to diagnose failures.

The gate's report and artifacts are under the configured run directory. Before retrieval, record the report outcome and list the directory:

```bash
cd "$HOME/src/streaming"
node -e "const r=require(process.argv[1]); console.log(JSON.stringify({passed:r.passed,artifacts:r.artifacts}, null, 2))" "$QUALITY_GATE_ARTIFACT_DIR/report.json"
find "$QUALITY_GATE_ARTIFACT_DIR" -type f -print
```

From the primary machine, retrieve the complete run directory through the configured SSH alias:

```bash
mkdir -p ./e2e/remote-quality-gate-artifacts
rsync -az --protect-args \
  <herdr-ssh-alias>:<remote-artifact-directory>/ \
  ./e2e/remote-quality-gate-artifacts/<run-id>/
```

Use the copied `report.json`, readable logs, and media diagnostics for review. Do not retrieve or print credentials.

## Verification status

This worker has no separate MacBook identity, SSH alias, SSH key, or live SSH session available. Therefore the end-to-end acceptance run cannot be executed or claimed from this checkout. The operator must substitute the real SSH alias, repository URL, revision, artifact directory, and retention period, then run the commands above and attach the resulting report and artifact path to the issue.
