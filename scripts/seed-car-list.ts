// Seeds monitors from config/car-list.json so they're ready for check_monitors
// without having to call monitor_search by hand for every vehicle.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addMonitor, loadMonitors, deleteMonitor } from "../src/storage/monitors.js";
import {
  addAutoDevMonitor,
  loadAutoDevMonitors,
} from "../src/storage/autodev-monitors.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, "..", "config", "car-list.json");

interface CarListConfig {
  location: {
    label: string;
    latitude: number;
    longitude: number;
    radius_km: number;
  };
  vehicles: Array<{
    monitor: string;
    query: string;
    class: string;
    min_price?: number;
    max_price?: number;
  }>;
  autodev?: {
    zip: string;
    distance_miles: number;
    vehicles: Array<{
      monitor: string;
      make: string;
      model: string;
      class: string;
    }>;
  };
}

function main() {
  const config: CarListConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
  const existing = new Set(loadMonitors().map((m) => m.name));

  console.log(`Seeding car list monitors near ${config.location.label}\n`);

  for (const vehicle of config.vehicles) {
    if (existing.has(vehicle.monitor)) {
      console.log(`skip  ${vehicle.monitor.padEnd(18)} (monitor already exists)`);
      continue;
    }

    addMonitor(vehicle.monitor, {
      query: vehicle.query,
      latitude: config.location.latitude,
      longitude: config.location.longitude,
      radiusKm: config.location.radius_km,
      minPrice: vehicle.min_price,
      maxPrice: vehicle.max_price,
      limit: 24,
    });

    console.log(`added ${vehicle.monitor.padEnd(18)} "${vehicle.query}" (${vehicle.class})`);
  }

  const wantedFb = new Set(config.vehicles.map((v) => v.monitor));
  for (const name of existing) {
    if (!wantedFb.has(name)) {
      deleteMonitor(name);
      console.log(`removed ${name.padEnd(17)} (no longer in car-list.json)`);
    }
  }

  if (config.autodev) {
    const existingAutoDev = loadAutoDevMonitors();

    // Auto.dev searches are managed live from the web UI's "Manage
    // searches" panel (add-car/remove-car), and persisted on the volume —
    // once there's at least one, this config file is no longer the source
    // of truth, so don't add-missing or prune-extra against it (that would
    // silently undo whatever the user configured through the UI on every
    // redeploy). Only bootstrap from it on a genuinely empty volume.
    if (existingAutoDev.length > 0) {
      console.log(
        `\nAuto.dev already has ${existingAutoDev.length} monitor(s) saved — skipping ` +
          `config/car-list.json seeding (manage searches from the web UI instead).`
      );
    } else {
      console.log(`\nSeeding Auto.dev monitors near ${config.autodev.zip}\n`);
      for (const vehicle of config.autodev.vehicles) {
        addAutoDevMonitor(vehicle.monitor, {
          make: vehicle.make,
          model: vehicle.model,
          zip: config.autodev.zip,
          distanceMiles: config.autodev.distance_miles,
        });

        console.log(
          `added ${vehicle.monitor.padEnd(18)} "${vehicle.make} ${vehicle.model}" (${vehicle.class})`
        );
      }
    }
  }

  console.log("\nDone. Use check_monitors (or list_monitors) via the MCP to see results.");
}

main();
