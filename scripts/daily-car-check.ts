// Standalone runner for scheduled (cron/Routine) use — no MCP client needed.
// Checks every saved monitor, persists new listings to cars.csv, and emails
// a digest if anything new turned up.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "../src/utils/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnvFile(path.join(__dirname, "..", ".env"));

import { FacebookClient } from "../src/facebook/client.js";
import { loadMonitors, updateMonitorSeenIds } from "../src/storage/monitors.js";
import { appendFoundCars } from "../src/storage/found-cars.js";
import { loadEmailConfigFromEnv, sendDigestEmail } from "../src/email/send.js";
import type { MarketplaceListing } from "../src/facebook/types.js";

async function runChecks(): Promise<Map<string, MarketplaceListing[]>> {
  const client = new FacebookClient({ maxRequestsPerMinute: 3 });
  const monitors = loadMonitors();

  if (monitors.length === 0) {
    throw new Error(
      "No monitors saved. Run `npm run seed-car-list` first."
    );
  }

  const newByMonitor = new Map<string, MarketplaceListing[]>();

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
    const newByMonitor = await runChecks();
    const totalNew = [...newByMonitor.values()].reduce(
      (sum, l) => sum + l.length,
      0
    );

    if (totalNew === 0) {
      console.log("No new listings today.");
      return;
    }

    const digest = formatDigest(newByMonitor);
    console.log(digest);

    if (emailConfig) {
      await sendDigestEmail(
        emailConfig,
        `Car watch: ${totalNew} new listing(s)`,
        digest
      );
      console.log(`\nEmailed digest to ${emailConfig.to}.`);
    } else {
      console.log(
        "\nSMTP_USER/SMTP_APP_PASSWORD not set in .env — skipped email, printed digest above instead."
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
