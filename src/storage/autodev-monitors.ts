import fs from "node:fs";
import path from "node:path";
import { getStorageDir } from "./storage-dir.js";

export interface AutoDevMonitorParams {
  make: string;
  model: string;
  zip: string;
  distanceMiles: number;
}

export interface SavedAutoDevMonitor {
  name: string;
  params: AutoDevMonitorParams;
  seenVins: string[];
  lastChecked: string | null;
}

function getFile(): string {
  return path.join(getStorageDir(), "autodev-monitors.json");
}

function ensureStorageDir() {
  const dir = getStorageDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function loadAutoDevMonitors(): SavedAutoDevMonitor[] {
  ensureStorageDir();
  const file = getFile();
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return [];
  }
}

function saveAutoDevMonitors(monitors: SavedAutoDevMonitor[]) {
  ensureStorageDir();
  fs.writeFileSync(getFile(), JSON.stringify(monitors, null, 2));
}

export function addAutoDevMonitor(
  name: string,
  params: AutoDevMonitorParams
): SavedAutoDevMonitor {
  const monitors = loadAutoDevMonitors();
  if (monitors.find((m) => m.name === name)) {
    throw new Error(`Auto.dev monitor "${name}" already exists.`);
  }

  const monitor: SavedAutoDevMonitor = {
    name,
    params,
    seenVins: [],
    lastChecked: null,
  };
  monitors.push(monitor);
  saveAutoDevMonitors(monitors);
  return monitor;
}

export function updateAutoDevMonitorSeenVins(name: string, newVins: string[]): void {
  const monitors = loadAutoDevMonitors();
  const monitor = monitors.find((m) => m.name === name);
  if (!monitor) return;

  const combined = [...new Set([...monitor.seenVins, ...newVins])];
  monitor.seenVins = combined.slice(-500);
  monitor.lastChecked = new Date().toISOString();
  saveAutoDevMonitors(monitors);
}

export function deleteAutoDevMonitor(name: string): boolean {
  const monitors = loadAutoDevMonitors();
  const idx = monitors.findIndex((m) => m.name === name);
  if (idx === -1) return false;
  monitors.splice(idx, 1);
  saveAutoDevMonitors(monitors);
  return true;
}

// Clears seenVins on every saved monitor (keeps the monitors themselves —
// make/model/zip/distance — intact) so the next check reports everything
// currently matching as "new", as if running for the first time.
export function resetAllSeenVins(): void {
  const monitors = loadAutoDevMonitors();
  for (const monitor of monitors) {
    monitor.seenVins = [];
  }
  saveAutoDevMonitors(monitors);
}
