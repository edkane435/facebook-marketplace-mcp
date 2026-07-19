import fs from "node:fs";
import path from "node:path";
import { getStorageDir } from "../storage/storage-dir.js";

// Prevents two overlapping daily-check runs (e.g. a manual "Run now" fired
// while the scheduled cron run — or another manual trigger — is still mid-run)
// from racing on the same monitors.json/autodev-monitors.json files, which
// silently corrupts state (one run's writes clobber the other's).
const STALE_MS = 15 * 60 * 1000; // assume a crashed run past this age, not a live one

function getLockFile(): string {
  return path.join(getStorageDir(), "daily-check.lock");
}

export function acquireLock(): boolean {
  const lockFile = getLockFile();
  const dir = path.dirname(lockFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (fs.existsSync(lockFile)) {
    const age = Date.now() - fs.statSync(lockFile).mtimeMs;
    if (age < STALE_MS) {
      return false;
    }
    // Older than STALE_MS — treat as an abandoned lock from a crashed run.
  }

  fs.writeFileSync(
    lockFile,
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })
  );
  return true;
}

export function releaseLock(): void {
  try {
    fs.unlinkSync(getLockFile());
  } catch {
    // already gone — fine
  }
}
