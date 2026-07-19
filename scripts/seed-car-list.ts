// Seeds monitors from config/car-list.json so they're ready for check_monitors
// without having to call monitor_search by hand for every vehicle.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addMonitor, loadMonitors } from "../src/storage/monitors.js";

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
}

function main() {
  const config: CarListConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
  const existing = new Set(loadMonitors().map((m) => m.name));

  console.log(`Seeding car list monitors near ${config.location.label}\n`);

  for (const vehicle of config.vehicles) {
    if (existing.has(vehicle.monitor)) {
      console.log(`skip  ${vehicle.monitor.padEnd(12)} (monitor already exists)`);
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

    console.log(`added ${vehicle.monitor.padEnd(12)} "${vehicle.query}" (${vehicle.class})`);
  }

  console.log("\nDone. Use check_monitors (or list_monitors) via the MCP to see results.");
}

main();
