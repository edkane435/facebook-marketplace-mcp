// Always-on web UI + internal daily-check scheduler, sharing the same
// process (and therefore the same mounted volume) rather than needing a
// second Railway service — Railway volumes are tied to one service, so
// this sidesteps needing to share one across two.
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "../utils/env.js";
import type { FoundCar } from "../storage/found-cars.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnvFile(path.join(__dirname, "..", "..", ".env"));

const { runDailyCheck } = await import("../check-runner.js");
const { loadFoundCars } = await import("../storage/found-cars.js");

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
}

function parseFilters(url: URL): Filters {
  const minPriceRaw = url.searchParams.get("minPrice");
  const maxPriceRaw = url.searchParams.get("maxPrice");
  return {
    minPrice: minPriceRaw ? Number(minPriceRaw) : undefined,
    maxPrice: maxPriceRaw ? Number(maxPriceRaw) : undefined,
    location: url.searchParams.get("location")?.trim() ?? "",
    type: url.searchParams.get("type")?.trim() ?? "",
  };
}

function applyFilters(cars: FoundCar[], filters: Filters): FoundCar[] {
  return cars.filter((c) => {
    if (filters.type && c.monitor !== filters.type) return false;

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

// "f150-autodev" -> "F150 Autodev" — just for the dropdown label, filtering
// still matches on the exact monitor name.
function prettyMonitorLabel(monitor: string): string {
  return monitor
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
  const types = [...new Set(allCars.map((c) => c.monitor))].sort();
  const options = types
    .map(
      (t) =>
        `<option value="${escapeHtml(t)}" ${filters.type === t ? "selected" : ""}>${escapeHtml(prettyMonitorLabel(t))}</option>`
    )
    .join("");

  return `<form class="filters" method="get" action="/">
    <label>Min $ <input type="number" name="minPrice" value="${filters.minPrice ?? ""}" placeholder="0" inputmode="numeric"></label>
    <label>Max $ <input type="number" name="maxPrice" value="${filters.maxPrice ?? ""}" placeholder="any" inputmode="numeric"></label>
    <label>Location <input type="text" name="location" value="${escapeHtml(filters.location)}" placeholder="e.g. NJ"></label>
    <label>Type <select name="type"><option value="">All</option>${options}</select></label>
    <button type="submit">Filter</button>
    <a class="clear" href="/">Clear</a>
  </form>`;
}

function renderPage(url: URL): string {
  const allCars = loadFoundCars().slice().reverse(); // newest first
  const filters = parseFilters(url);
  const cars = applyFilters(allCars, filters);

  const rows = cars
    .map(
      (c) => `
    <tr>
      <td class="nowrap">${escapeHtml(c.dateFound.slice(0, 10))}</td>
      <td class="nowrap">${escapeHtml(c.monitor)}</td>
      <td>${escapeHtml(c.title)}</td>
      <td class="nowrap">${escapeHtml(c.price)}</td>
      <td>${escapeHtml(c.location)}</td>
      <td>${escapeHtml(c.seller)}</td>
      <td>${renderLinks(c.url)}</td>
    </tr>`
    )
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Car Watch</title>
<style>
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
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 0.82rem; min-width: 700px; }
  th, td { text-align: left; padding: 0.5rem 0.6rem; border-bottom: 1px solid #2a2d35; vertical-align: top; }
  th { position: sticky; top: 0; background: #0b0d12; font-weight: 600; }
  a { color: #7dd3fc; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .nowrap { white-space: nowrap; }
  .empty { opacity: 0.6; padding: 2rem 0; }
</style>
</head>
<body>
  <h1>Car Watch</h1>
  <p class="meta">${cars.length} of ${allCars.length} found · newest first · refresh anytime</p>
  ${renderFilterForm(allCars, filters)}
  ${
    cars.length === 0
      ? `<p class="empty">${allCars.length === 0 ? "Nothing found yet — check back after the next scheduled run." : "No results match these filters."}</p>`
      : `<div class="table-wrap"><table>
    <thead><tr><th>Found</th><th>Search</th><th>Title</th><th>Price</th><th>Location</th><th>Seller</th><th>Links</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`
  }
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(renderPage(url));
});

server.listen(PORT, () => {
  console.log(`Car watch UI listening on :${PORT}`);
});
