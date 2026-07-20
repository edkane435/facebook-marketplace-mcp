// Core check logic — checks every saved monitor (Facebook + Auto.dev),
// persists new listings to cars.csv, and emails a digest if anything new
// turned up. Shared by the CLI entry point (scripts/daily-car-check.ts) and
// the web server's internal scheduler (src/web/server.ts).
import { FacebookClient } from "./facebook/client.js";
import { loadMonitors, updateMonitorSeenIds } from "./storage/monitors.js";
import {
  loadAutoDevMonitors,
  updateAutoDevMonitorSeenVins,
  resetAllSeenVins,
} from "./storage/autodev-monitors.js";
import { searchAutoDevListings } from "./autodev/client.js";
import { classifyByPrice } from "./autodev/deal-filter.js";
import { appendFoundCars, clearFoundCars } from "./storage/found-cars.js";
import { loadEmailConfigFromEnv, sendDigestEmail } from "./email/send.js";
import { acquireLock, releaseLock } from "./utils/lock.js";
import type { MarketplaceListing } from "./facebook/types.js";

// Temporary knob for testing — set MAX_MONITORS to check only the first N
// monitors of each source instead of the full list, so a debug run finishes
// in under a minute instead of several. Unset (or remove the var) to go
// back to checking everything.
function applyMonitorLimit<T>(monitors: T[]): T[] {
  const limit = process.env.MAX_MONITORS
    ? parseInt(process.env.MAX_MONITORS, 10)
    : null;
  return limit && limit > 0 ? monitors.slice(0, limit) : monitors;
}

async function runFacebookChecks(): Promise<Map<string, MarketplaceListing[]>> {
  const newByMonitor = new Map<string, MarketplaceListing[]>();

  if (process.env.SKIP_FACEBOOK === "true") {
    console.log("SKIP_FACEBOOK=true — skipping Facebook check.");
    return newByMonitor;
  }

  const client = new FacebookClient({ maxRequestsPerMinute: 3 });
  const monitors = applyMonitorLimit(loadMonitors());

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

  const monitors = applyMonitorLimit(loadAutoDevMonitors());
  if (monitors.length === 0) {
    console.log("No Auto.dev monitors saved — skipping Auto.dev check.");
    return newByMonitor;
  }

  for (const monitor of monitors) {
    const listings = await searchAutoDevListings({ apiKey, ...monitor.params });

    // Mark every VIN seen this run — including "bad" tier ones — so a
    // listing doesn't keep showing up as "noise" on every future run just
    // because it's still listed. (Tradeoff: if it later drops in price
    // into a better tier, it won't re-surface since it's already marked
    // seen — same limitation the Facebook side has; no price-history
    // tracking here yet.)
    const allVins = listings.map((l) => l.vin).filter(Boolean);

    const classified = classifyByPrice(listings);
    const newListings = classified.filter(
      (l) => l.vin && !monitor.seenVins.includes(l.vin)
    );

    updateAutoDevMonitorSeenVins(monitor.name, allVins);

    if (newListings.length > 0) {
      const asListings: MarketplaceListing[] = newListings.map((l) => ({
        id: l.vin,
        title: `${l.title} — ${l.mileage}`,
        price: l.price,
        location: l.location,
        imageUrl: "",
        sellerName: l.dealer,
        postedDate: "",
        // " | " not "\n" — CSV storage collapses embedded newlines to
        // spaces (found-cars.ts's csvField), which would make the two URLs
        // indistinguishable once read back. This delimiter survives intact.
        url: l.carfaxUrl ? `${l.url} | Carfax: ${l.carfaxUrl}` : l.url,
        isPending: false,
        priceTier: l.priceTier,
      }));

      // Every classified listing (including "bad" tier) is stored so the
      // web UI shows the full picture — but the email digest below only
      // ever sees great/good tier entries via newByMonitor, so alerts stay
      // focused on things actually worth a look.
      appendFoundCars(monitor.name, asListings);

      const alertWorthy = asListings.filter((l) => l.priceTier !== "bad");
      if (alertWorthy.length > 0) {
        newByMonitor.set(monitor.name, alertWorthy);
      }
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

export async function runDailyCheck(): Promise<void> {
  if (!acquireLock()) {
    console.log(
      "Another daily-check run appears to still be in progress (lock file " +
        "younger than 15 min) — skipping this run rather than racing on the " +
        "same monitor state files. If you're sure nothing else is running, " +
        "this is a stale lock and will clear itself on the next attempt."
    );
    return;
  }

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
  } finally {
    releaseLock();
  }
}

// Wipes all found-car history and Auto.dev seen-state, so the next check
// re-reports every current match as new with none of the old history
// (including any stale pre-fix links) left behind. Used by the "Clear All"
// button in the web UI.
export function clearAllData(): void {
  resetAllSeenVins();
  clearFoundCars();
}
