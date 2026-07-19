// Standalone runner for scheduled (cron/Routine) use — no MCP client needed.
// Checks every saved monitor (Facebook + Auto.dev), persists new listings to
// cars.csv, and emails a digest if anything new turned up.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "../src/utils/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnvFile(path.join(__dirname, "..", ".env"));

import { FacebookClient } from "../src/facebook/client.js";
import { loadMonitors, updateMonitorSeenIds } from "../src/storage/monitors.js";
import {
  loadAutoDevMonitors,
  updateAutoDevMonitorSeenVins,
} from "../src/storage/autodev-monitors.js";
import { searchAutoDevListings } from "../src/autodev/client.js";
import { appendFoundCars } from "../src/storage/found-cars.js";
import { loadEmailConfigFromEnv, sendDigestEmail } from "../src/email/send.js";
import type { MarketplaceListing } from "../src/facebook/types.js";

async function runFacebookChecks(): Promise<Map<string, MarketplaceListing[]>> {
  const client = new FacebookClient({ maxRequestsPerMinute: 3 });
  const monitors = loadMonitors();
  const newByMonitor = new Map<string, MarketplaceListing[]>();

  if (monitors.length === 0) {
    console.log("No Facebook monitors saved — skipping Facebook check.");
    return newByMonitor;
  }

  for (const monitor of monitors) {
    const result = await client.searchListings(monitor.params);
    const newListings = result.listings.filter(
      (l) => !monitor.seenIds.includes(l.id)
    );

    if (newListings.length > 0) {
      updateMonitorSeenIds(
        monitor.name,
        newListings.map((l) => l.id)
      );
      appendFoundCars(monitor.name, newListings);
      newByMonitor.set(monitor.name, newListings);
    } else {
      updateMonitorSeenIds(monitor.name, []);
    }
  }

  return newByMonitor;
}

async function runAutoDevChecks(): Promise<Map<string, MarketplaceListing[]>> {
  const newByMonitor = new Map<string, MarketplaceListing[]>();
  const apiKey = process.env.AUTODEV_API_KEY;

  if (!apiKey) {
    console.log("AUTODEV_API_KEY not set — skipping Auto.dev check.");
    return newByMonitor;
  }

  const monitors = loadAutoDevMonitors();
  if (monitors.length === 0) {
    console.log("No Auto.dev monitors saved — skipping Auto.dev check.");
    return newByMonitor;
  }

  for (const monitor of monitors) {
    const listings = await searchAutoDevListings({ apiKey, ...monitor.params });
    const newListings = listings.filter(
      (l) => l.vin && !monitor.seenVins.includes(l.vin)
    );

    if (newListings.length > 0) {
      updateAutoDevMonitorSeenVins(
        monitor.name,
        newListings.map((l) => l.vin)
      );

      const asListings: MarketplaceListing[] = newListings.map((l) => ({
        id: l.vin,
        title: `${l.title} — ${l.mileage}`,
        price: l.price,
        location: l.location,
        imageUrl: "",
        sellerName: l.dealer,
        postedDate: "",
        url: l.url,
        isPending: false,
      }));

      appendFoundCars(monitor.name, asListings);
      newByMonitor.set(monitor.name, asListings);
    } else {
      updateAutoDevMonitorSeenVins(monitor.name, []);
    }
  }

  return newByMonitor;
}

async function runChecks(): Promise<{
  newByMonitor: Map<string, MarketplaceListing[]>;
  warnings: string[];
}> {
  const newByMonitor = await runFacebookChecks();
  const warnings: string[] = [];

  // Auto.dev is a secondary source — a failure here shouldn't block a
  // successful Facebook digest, just get surfaced as a warning instead.
  try {
    const autodev = await runAutoDevChecks();
    for (const [monitor, listings] of autodev) {
      newByMonitor.set(monitor, listings);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Auto.dev check failed:", message);
    warnings.push(`Auto.dev check failed: ${message}`);
  }

  return { newByMonitor, warnings };
}

function formatDigest(newByMonitor: Map<string, MarketplaceListing[]>): string {
  const sections = [...newByMonitor.entries()].map(([monitor, listings]) => {
    const lines = listings.map(
      (l) => `- ${l.title} — ${l.price}\n  ${l.location}\n  ${l.url}`
    );
    return `${monitor} (${listings.length} new)\n${lines.join("\n")}`;
  });
  return sections.join("\n\n");
}

async function main() {
  const emailConfig = loadEmailConfigFromEnv();

  try {
    const { newByMonitor, warnings } = await runChecks();
    const totalNew = [...newByMonitor.values()].reduce(
      (sum, l) => sum + l.length,
      0
    );

    if (totalNew === 0 && warnings.length === 0) {
      console.log("No new listings today.");
      return;
    }

    const digest = totalNew > 0 ? formatDigest(newByMonitor) : "No new listings today.";
    const fullText = warnings.length
      ? `${digest}\n\n${warnings.join("\n")}`
      : digest;
    console.log(fullText);

    if (emailConfig) {
      await sendDigestEmail(
        emailConfig,
        `Car watch: ${totalNew} new listing(s)`,
        fullText
      );
      console.log(`\nEmailed digest to ${emailConfig.to}.`);
    } else {
      console.log(
        "\nRESEND_API_KEY/EMAIL_TO not set in .env — skipped email, printed digest above instead."
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Car check failed:", message);

    if (emailConfig) {
      await sendDigestEmail(
        emailConfig,
        "Car watch: check failed",
        `The daily car check failed and needs attention:\n\n${message}\n\n` +
          "This is usually an expired FB_COOKIE_HEADER — grab a fresh one from " +
          "Chrome DevTools and update .env."
      ).catch((emailError) => {
        console.error("Also failed to send failure alert email:", emailError);
      });
    }

    process.exitCode = 1;
  }
}

main();
