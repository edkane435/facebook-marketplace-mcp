// Always-on web UI + internal daily-check scheduler, sharing the same
// process (and therefore the same mounted volume) rather than needing a
// second Railway service — Railway volumes are tied to one service, so
// this sidesteps needing to share one across two.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "../utils/env.js";
import type { FoundCar } from "../storage/found-cars.js";
import type { SavedAutoDevMonitor } from "../storage/autodev-monitors.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnvFile(path.join(__dirname, "..", "..", ".env"));

const { runDailyCheck, clearAllData } = await import("../check-runner.js");
const { loadFoundCars } = await import("../storage/found-cars.js");
const { loadAutoDevMonitors, addAutoDevMonitor, deleteAutoDevMonitor } =
  await import("../storage/autodev-monitors.js");
const { searchAutoDevListings } = await import("../autodev/client.js");
type AutoDevListing = Awaited<ReturnType<typeof searchAutoDevListings>>[number];

const PORT = Number(process.env.PORT) || 3000;
const CHECK_HOUR_UTC = Number(process.env.DAILY_CHECK_HOUR_UTC ?? 13);
const CHECK_MINUTE_UTC = Number(process.env.DAILY_CHECK_MINUTE_UTC ?? 0);

let lastRunDateKey: string | null = null;

function maybeRunScheduledCheck() {
  const now = new Date();
  const dateKey = now.toISOString().slice(0, 10);
  if (
    now.getUTCHours() === CHECK_HOUR_UTC &&
    now.getUTCMinutes() === CHECK_MINUTE_UTC &&
    lastRunDateKey !== dateKey
  ) {
    lastRunDateKey = dateKey;
    console.log(`Scheduled check firing for ${dateKey}`);
    runDailyCheck().catch((err) => console.error("Scheduled check failed:", err));
  }
}

setInterval(maybeRunScheduledCheck, 60_000);
console.log(
  `Scheduled to check daily at ${String(CHECK_HOUR_UTC).padStart(2, "0")}:` +
    `${String(CHECK_MINUTE_UTC).padStart(2, "0")} UTC.`
);

function readFormBody(req: http.IncomingMessage): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      // A form this small should never approach this — bail out rather
      // than let a misbehaving client buffer unbounded memory.
      if (body.length > 10_000) req.destroy();
    });
    req.on("end", () => resolve(new URLSearchParams(body)));
    req.on("error", reject);
  });
}

// "GMC" + "Yukon" -> "gmc-yukon-autodev". Matches the "-autodev" suffix the
// UI's type filter and dropdown already key off of.
function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildAutoDevMonitorName(make: string, model: string): string {
  return `${slugify(make)}-${slugify(model)}-autodev`;
}

// zip/distanceMiles for a newly-added car: reuse whatever an existing
// monitor already uses (so a new search stays consistent with the rest of
// the list), falling back to the config file's defaults only if every
// monitor has been removed and there's nothing left to copy from.
function getAutoDevSearchDefaults(monitors: SavedAutoDevMonitor[]): {
  zip: string;
  distanceMiles: number;
} {
  if (monitors.length > 0) {
    return { zip: monitors[0].params.zip, distanceMiles: monitors[0].params.distanceMiles };
  }
  try {
    const configPath = path.join(__dirname, "..", "..", "config", "car-list.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return {
      zip: config.autodev?.zip ?? "19382",
      distanceMiles: config.autodev?.distance_miles ?? 65,
    };
  } catch {
    return { zip: "19382", distanceMiles: 65 };
  }
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!
  );
}

function parsePriceValue(price: string): number | null {
  const num = Number(price.replace(/[^0-9.]/g, ""));
  return Number.isFinite(num) && price.trim() !== "" ? num : null;
}

interface Filters {
  minPrice?: number;
  maxPrice?: number;
  location: string;
  type: string;
  tier: string;
}

function parseFilters(url: URL): Filters {
  const minPriceRaw = url.searchParams.get("minPrice");
  const maxPriceRaw = url.searchParams.get("maxPrice");
  return {
    minPrice: minPriceRaw ? Number(minPriceRaw) : undefined,
    maxPrice: maxPriceRaw ? Number(maxPriceRaw) : undefined,
    location: url.searchParams.get("location")?.trim() ?? "",
    type: url.searchParams.get("type")?.trim() ?? "",
    tier: url.searchParams.get("tier")?.trim() ?? "",
  };
}

function applyFilters(cars: FoundCar[], filters: Filters): FoundCar[] {
  return cars.filter((c) => {
    if (filters.type && c.monitor !== filters.type) return false;
    if (filters.tier && c.priceTier !== filters.tier) return false;

    if (filters.location) {
      if (!c.location.toLowerCase().includes(filters.location.toLowerCase())) {
        return false;
      }
    }

    if (filters.minPrice != null || filters.maxPrice != null) {
      const priceValue = parsePriceValue(c.price);
      if (priceValue == null) return false;
      if (filters.minPrice != null && priceValue < filters.minPrice) return false;
      if (filters.maxPrice != null && priceValue > filters.maxPrice) return false;
    }

    return true;
  });
}

// Human label + CSS class for a stored price_tier value. Legacy rows (from
// before this column existed, or Facebook rows which never get one) are ""
// and just render with no badge at all.
function renderTierBadge(tier: string): string {
  if (tier === "great") return `<span class="tier tier-great">Great price</span>`;
  if (tier === "good") return `<span class="tier tier-good">Good price</span>`;
  if (tier === "bad") return `<span class="tier tier-bad">Bad price</span>`;
  return "";
}

// "f150-autodev" -> "F150" — the "-autodev" suffix is an internal
// implementation detail (all active searches are Auto.dev-sourced), not
// something worth showing. Just cosmetic — filtering still matches on the
// exact monitor name.
function prettyMonitorLabel(monitor: string): string {
  return monitor
    .replace(/-autodev$/, "")
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function renderLinks(url: string): string {
  // Auto.dev entries pack a second Carfax link into the same field,
  // separated by " | " (see check-runner.ts) — split it back out. Not a
  // newline: CSV storage collapses those to spaces, which would make the
  // two URLs indistinguishable once read back from cars.csv.
  return url
    .split(" | ")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\w[\w\s]*?):\s*(https?:\/\/\S+)$/);
      const [label, href] = match ? [match[1], match[2]] : ["view", line];
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`;
    })
    .join(" · ");
}

function renderFilterForm(allCars: FoundCar[], filters: Filters): string {
  // Facebook's disabled (SKIP_FACEBOOK=true) so its old monitor names
  // (no "-autodev" suffix) never get new rows — only offer the active
  // Auto.dev sources as filter options. Their historical rows can still
  // show up in the unfiltered table; just not worth offering as a type
  // to filter BY since selecting one only ever surfaces stale results.
  const types = [...new Set(allCars.map((c) => c.monitor))]
    .filter((t) => t.endsWith("-autodev"))
    .sort();
  const options = types
    .map(
      (t) =>
        `<option value="${escapeHtml(t)}" ${filters.type === t ? "selected" : ""}>${escapeHtml(prettyMonitorLabel(t))}</option>`
    )
    .join("");

  const tiers: Array<{ value: string; label: string }> = [
    { value: "great", label: "Great price" },
    { value: "good", label: "Good price" },
    { value: "bad", label: "Bad price" },
  ];
  const tierOptions = tiers
    .map(
      (t) =>
        `<option value="${t.value}" ${filters.tier === t.value ? "selected" : ""}>${t.label}</option>`
    )
    .join("");

  return `<form class="filters" method="get" action="/">
    <label>Min $ <input type="number" name="minPrice" value="${filters.minPrice ?? ""}" placeholder="0" inputmode="numeric"></label>
    <label>Max $ <input type="number" name="maxPrice" value="${filters.maxPrice ?? ""}" placeholder="any" inputmode="numeric"></label>
    <label>Location <input type="text" name="location" value="${escapeHtml(filters.location)}" placeholder="e.g. NJ"></label>
    <label>Type <select name="type"><option value="">All</option>${options}</select></label>
    <label>Price <select name="tier"><option value="">All</option>${tierOptions}</select></label>
    <button type="submit">Filter</button>
    <a class="clear" href="/">Clear</a>
  </form>`;
}

function renderManageSearches(monitors: SavedAutoDevMonitor[]): string {
  const rows = monitors
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(
      (m) => `
    <li>
      <span>${escapeHtml(m.params.make)} ${escapeHtml(m.params.model)}</span>
      <form method="post" action="/remove-car" onsubmit="return confirm('Stop searching for ${escapeHtml(m.params.make)} ${escapeHtml(m.params.model)}?');">
        <input type="hidden" name="monitor" value="${escapeHtml(m.name)}">
        <button class="remove-car" type="submit">Remove</button>
      </form>
    </li>`
    )
    .join("");

  return `<details class="manage">
    <summary>Manage searches (${monitors.length})</summary>
    <form class="add-car" method="get" action="/search-car">
      <label>Make <input type="text" name="make" placeholder="e.g. Honda" required></label>
      <label>Model <input type="text" name="model" placeholder="e.g. Pilot" required></label>
      <button type="submit">Search to add</button>
    </form>
    <ul class="monitor-list">${rows || "<li><em>No searches yet.</em></li>"}</ul>
  </details>`;
}

function renderSearchPage(
  make: string,
  model: string,
  defaults: { zip: string; distanceMiles: number },
  listings: AutoDevListing[],
  errorMessage: string | null
): string {
  const rows = listings
    .slice(0, 15)
    .map(
      (l) => `
    <tr>
      <td>${escapeHtml(l.title)}</td>
      <td class="nowrap">${escapeHtml(l.price)}</td>
      <td class="nowrap">${escapeHtml(l.mileage)}</td>
      <td>${escapeHtml(l.location)}</td>
      <td>${escapeHtml(l.dealer)}</td>
    </tr>`
    )
    .join("");

  const resultsHtml = errorMessage
    ? `<p class="notice notice-error">Couldn't search Auto.dev: ${escapeHtml(errorMessage)}. You can still add it below — it'll just start showing results once the next check runs.</p>`
    : listings.length === 0
      ? `<p class="notice notice-error">No current listings found for ${escapeHtml(make)} ${escapeHtml(model)} within ${defaults.distanceMiles} mi of ${escapeHtml(defaults.zip)}. Could just be low inventory right now — you can still add it below.</p>`
      : `<p class="preview-meta">${listings.length} current listing(s) found. Showing up to 15.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Title</th><th>Price</th><th>Mileage</th><th>Location</th><th>Dealer</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;

  return pageShell(
    `Search: ${make} ${model}`,
    `  <a class="back-link" href="/">&larr; Back to Car Watch</a>
  <h1>${escapeHtml(make)} ${escapeHtml(model)}</h1>
  ${resultsHtml}
  <form class="confirm-add" method="post" action="/add-car">
    <input type="hidden" name="make" value="${escapeHtml(make)}">
    <input type="hidden" name="model" value="${escapeHtml(model)}">
    <button type="submit">Add this search</button>
  </form>`
  );
}

const PAGE_STYLES = `
  :root { color-scheme: dark light; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    margin: 0; padding: 1rem 1rem 3rem;
    background: #0b0d12; color: #e8e8ea;
  }
  @media (prefers-color-scheme: light) {
    body { background: #fafafa; color: #16181d; }
    th { background: #fafafa !important; }
    a { color: #0369a1 !important; }
    td, th { border-bottom-color: #e2e2e2 !important; }
    .filters input, .filters select { background: #fff !important; color: #16181d !important; border-color: #ccc !important; }
    .filters button { background: #0369a1 !important; }
  }
  h1 { font-size: 1.15rem; margin: 0 0 0.25rem; }
  .meta { opacity: 0.65; font-size: 0.85rem; margin-bottom: 1rem; }
  .filters {
    display: flex; flex-wrap: wrap; gap: 0.6rem 1rem; align-items: end;
    margin-bottom: 1.25rem; padding: 0.75rem; border: 1px solid #2a2d35; border-radius: 8px;
  }
  .filters label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.75rem; opacity: 0.8; }
  .filters input, .filters select {
    background: #16181d; color: inherit; border: 1px solid #383b44; border-radius: 6px;
    padding: 0.4rem 0.5rem; font-size: 0.85rem;
  }
  .filters input[type="number"] { width: 6rem; }
  .filters button {
    background: #0284c7; color: #fff; border: none; border-radius: 6px;
    padding: 0.45rem 0.9rem; font-size: 0.85rem; cursor: pointer;
  }
  .filters .clear { align-self: center; font-size: 0.8rem; opacity: 0.8; }
  .actions { display: flex; gap: 0.6rem; margin-bottom: 1rem; }
  .actions button {
    border: none; border-radius: 6px; padding: 0.5rem 0.9rem; font-size: 0.85rem; cursor: pointer;
  }
  .actions .check-now { background: #16a34a; color: #fff; }
  .actions .clear-all { background: #b91c1c; color: #fff; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 0.82rem; min-width: 700px; }
  th, td { text-align: left; padding: 0.5rem 0.6rem; border-bottom: 1px solid #2a2d35; vertical-align: top; }
  th { position: sticky; top: 0; background: #0b0d12; font-weight: 600; }
  a { color: #7dd3fc; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .nowrap { white-space: nowrap; }
  .empty { opacity: 0.6; padding: 2rem 0; }
  .tier {
    display: inline-block; padding: 0.2rem 0.55rem; border-radius: 999px;
    font-size: 0.72rem; font-weight: 600; white-space: nowrap;
  }
  .tier-great { background: #14532d; color: #86efac; }
  .tier-good { background: #1e3a5f; color: #93c5fd; }
  .tier-bad { background: #3f3f46; color: #a1a1aa; }
  @media (prefers-color-scheme: light) {
    .tier-great { background: #dcfce7; color: #166534; }
    .tier-good { background: #dbeafe; color: #1e40af; }
    .tier-bad { background: #f4f4f5; color: #52525b; }
  }
  .notice { padding: 0.6rem 0.8rem; border-radius: 6px; font-size: 0.85rem; margin: 0 0 1rem; }
  .notice-ok { background: #14532d; color: #86efac; }
  .notice-error { background: #7f1d1d; color: #fecaca; }
  @media (prefers-color-scheme: light) {
    .notice-ok { background: #dcfce7; color: #166534; }
    .notice-error { background: #fee2e2; color: #991b1b; }
  }
  .manage {
    margin-bottom: 1.25rem; padding: 0.75rem; border: 1px solid #2a2d35; border-radius: 8px;
  }
  .manage summary { cursor: pointer; font-size: 0.85rem; font-weight: 600; }
  .add-car {
    display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: end; margin: 0.85rem 0 1rem;
  }
  .add-car label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.75rem; opacity: 0.8; }
  .add-car input {
    background: #16181d; color: inherit; border: 1px solid #383b44; border-radius: 6px;
    padding: 0.4rem 0.5rem; font-size: 0.85rem;
  }
  .add-car button {
    background: #0284c7; color: #fff; border: none; border-radius: 6px;
    padding: 0.45rem 0.9rem; font-size: 0.85rem; cursor: pointer;
  }
  .monitor-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
  .monitor-list li {
    display: flex; justify-content: space-between; align-items: center; gap: 0.75rem;
    padding: 0.4rem 0.6rem; border: 1px solid #2a2d35; border-radius: 6px; font-size: 0.82rem;
  }
  .monitor-list small { opacity: 0.6; }
  .remove-car {
    background: #b91c1c; color: #fff; border: none; border-radius: 6px;
    padding: 0.3rem 0.6rem; font-size: 0.75rem; cursor: pointer;
  }
  @media (prefers-color-scheme: light) {
    .add-car input { background: #fff !important; color: #16181d !important; border-color: #ccc !important; }
    .monitor-list li { border-color: #e2e2e2 !important; }
  }
  .back-link { display: inline-block; margin-bottom: 1rem; font-size: 0.85rem; }
  .preview-meta { opacity: 0.7; font-size: 0.85rem; margin-bottom: 1rem; }
  .confirm-add { margin-top: 1rem; }
  .confirm-add button {
    background: #16a34a; color: #fff; border: none; border-radius: 6px;
    padding: 0.5rem 0.9rem; font-size: 0.85rem; cursor: pointer;
  }
`;

function pageShell(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${PAGE_STYLES}</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

function renderPage(url: URL): string {
  const allCars = loadFoundCars().slice().reverse(); // newest first
  const filters = parseFilters(url);
  const cars = applyFilters(allCars, filters);
  const monitors = loadAutoDevMonitors();
  const notice = url.searchParams.get("notice")?.trim() ?? "";
  const error = url.searchParams.get("error")?.trim() ?? "";

  const rows = cars
    .map(
      (c) => `
    <tr>
      <td class="nowrap">${escapeHtml(c.dateFound.slice(0, 10))}</td>
      <td class="nowrap">${escapeHtml(prettyMonitorLabel(c.monitor))}</td>
      <td>${escapeHtml(c.title)}</td>
      <td class="nowrap">${escapeHtml(c.price)}</td>
      <td>${renderTierBadge(c.priceTier)}</td>
      <td>${escapeHtml(c.location)}</td>
      <td>${escapeHtml(c.seller)}</td>
      <td>${renderLinks(c.url)}</td>
    </tr>`
    )
    .join("");

  return pageShell(
    "Car Watch",
    `  <h1>Car Watch</h1>
  <p class="meta">${cars.length} of ${allCars.length} found · newest first · refresh anytime</p>
  ${notice ? `<p class="notice notice-ok">${escapeHtml(notice)}</p>` : ""}
  ${error ? `<p class="notice notice-error">${escapeHtml(error)}</p>` : ""}
  <div class="actions">
    <form method="post" action="/check-now"><button class="check-now" type="submit">Check now</button></form>
    <form method="post" action="/clear-all" onsubmit="return confirm('Clear all found cars and start fresh?');"><button class="clear-all" type="submit">Clear all &amp; start fresh</button></form>
  </div>
  ${renderManageSearches(monitors)}
  ${renderFilterForm(allCars, filters)}
  ${
    cars.length === 0
      ? `<p class="empty">${allCars.length === 0 ? "Nothing found yet — check back after the next scheduled run." : "No results match these filters."}</p>`
      : `<div class="table-wrap"><table>
    <thead><tr><th>Found</th><th>Search</th><th>Title</th><th>Price</th><th>Rating</th><th>Location</th><th>Seller</th><th>Links</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`
  }`
  );
}

const server = http.createServer(async (req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "POST" && url.pathname === "/check-now") {
    try {
      await runDailyCheck();
    } catch (err) {
      console.error("Manual check failed:", err);
    }
    res.writeHead(302, { Location: "/" });
    res.end();
    return;
  }

  if (req.method === "POST" && url.pathname === "/clear-all") {
    clearAllData();
    res.writeHead(302, { Location: "/" });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/search-car") {
    const make = url.searchParams.get("make")?.trim() ?? "";
    const model = url.searchParams.get("model")?.trim() ?? "";

    if (!make || !model) {
      res.writeHead(302, {
        Location: "/?" + new URLSearchParams({ error: "Make and model are required." }),
      });
      res.end();
      return;
    }

    const defaults = getAutoDevSearchDefaults(loadAutoDevMonitors());
    const apiKey = process.env.AUTODEV_API_KEY;

    let listings: AutoDevListing[] = [];
    let errorMessage: string | null = null;
    if (!apiKey) {
      errorMessage = "AUTODEV_API_KEY isn't set, so live listings can't be previewed";
    } else {
      try {
        listings = await searchAutoDevListings({ apiKey, make, model, ...defaults });
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : String(err);
      }
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderSearchPage(make, model, defaults, listings, errorMessage));
    return;
  }

  if (req.method === "POST" && url.pathname === "/add-car") {
    const form = await readFormBody(req);
    const make = form.get("make")?.trim() ?? "";
    const model = form.get("model")?.trim() ?? "";

    let redirect = "/";
    if (!make || !model) {
      redirect = "/?" + new URLSearchParams({ error: "Make and model are required." });
    } else {
      const name = buildAutoDevMonitorName(make, model);
      try {
        const defaults = getAutoDevSearchDefaults(loadAutoDevMonitors());
        addAutoDevMonitor(name, { make, model, ...defaults });
        redirect = "/?" + new URLSearchParams({ notice: `Added ${make} ${model} — it'll show up after the next check.` });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        redirect = "/?" + new URLSearchParams({ error: message });
      }
    }

    res.writeHead(302, { Location: redirect });
    res.end();
    return;
  }

  if (req.method === "POST" && url.pathname === "/remove-car") {
    const form = await readFormBody(req);
    const monitor = form.get("monitor")?.trim() ?? "";
    const removed = monitor ? deleteAutoDevMonitor(monitor) : false;
    const redirect =
      "/?" +
      new URLSearchParams(
        removed
          ? { notice: `Removed ${monitor}. Past listings stay in the table below.` }
          : { error: `Couldn't find a search named "${monitor}".` }
      );
    res.writeHead(302, { Location: redirect });
    res.end();
    return;
  }

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(renderPage(url));
});

server.listen(PORT, () => {
  console.log(`Car watch UI listening on :${PORT}`);
});
