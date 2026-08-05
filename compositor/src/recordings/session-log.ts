import { createWriteStream, mkdirSync, type WriteStream } from 'fs';
import * as os from 'os';
import * as path from 'path';

export class SessionLog {
  readonly path: string;
  private readonly stream: WriteStream;
  private closed = false;
  private sampleTimer: ReturnType<typeof setInterval> | undefined;

  constructor(dir: string, roomSlug: string, stamp: string) {
    mkdirSync(dir, { recursive: true });
    this.path = path.join(dir, `${roomSlug}-${stamp}.session.log`);
    this.stream = createWriteStream(this.path, { flags: 'a' });
    this.write('session opened');
    this.write(`host=${os.hostname()} platform=${os.platform()} arch=${os.arch()} cpus=${os.cpus().length}`);
    this.write(`node=${process.version} pid=${process.pid}`);
    this.writeResources();
    this.sampleTimer = setInterval(() => this.writeResources(), 10_000);
    this.sampleTimer.unref?.();
  }

  write(message: string): void {
    if (this.closed) return;
    const line = `${new Date().toISOString()} ${message}`;
    this.stream.write(line + '\n');
  }

  writeResources(): void {
    const load = os.loadavg().map((n) => n.toFixed(2)).join(', ');
    const freeMb = (os.freemem() / 1e6).toFixed(0);
    const totalMb = (os.totalmem() / 1e6).toFixed(0);
    const mu = process.memoryUsage();
    this.write(
      `resources load=[${load}] mem_free_mb=${freeMb}/${totalMb} ` +
        `rss_mb=${(mu.rss / 1e6).toFixed(0)} heap_mb=${(mu.heapUsed / 1e6).toFixed(0)}`,
    );
  }

  close(summary?: string): void {
    if (this.closed) return;
    if (this.sampleTimer) clearInterval(this.sampleTimer);
    this.writeResources();
    if (summary) this.write(summary);
    this.write('session closed');
    this.closed = true;
    this.stream.end();
  }
}

export function sessionStamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}
