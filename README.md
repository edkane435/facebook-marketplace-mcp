# Facebook Marketplace MCP Server

An MCP server that provides access to Facebook Marketplace via direct GraphQL API calls. No browser automation at runtime — speaks Facebook's internal protocol directly.

## How It Works

Facebook's web client makes all Marketplace requests as `POST /api/graphql/` with a `doc_id` (query hash) and `variables`. This server replays those requests using your existing Facebook session cookies from Chrome.

**Think of it like [pypush](https://github.com/JJTech0130/pypush) for iMessage — direct protocol, no browser.**

## Prerequisites

- **macOS** (cookie extraction uses Keychain)
- **Google Chrome** with an active Facebook login
- **Node.js** 20+

## Installation

```bash
git clone <this-repo>
cd facebook-marketplace-mcp
npm install
npm run build
```

## Setup with Claude Code

```bash
claude mcp add facebook-marketplace -- node /path/to/facebook-marketplace-mcp/dist/index.js
```

Or add to your Claude Code config manually:

```json
{
  "mcpServers": {
    "facebook-marketplace": {
      "command": "node",
      "args": ["/path/to/facebook-marketplace-mcp/dist/index.js"],
      "env": {
        "CHROME_PROFILE": "Default"
      }
    }
  }
}
```

## Tools

### `search_listings`
Search Marketplace by query, location, and filters.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Search term |
| `latitude` | number | yes | Latitude of search center |
| `longitude` | number | yes | Longitude of search center |
| `radius_km` | number | no | Search radius (default: 50) |
| `min_price` | number | no | Min price in dollars |
| `max_price` | number | no | Max price in dollars |
| `category` | string | no | Category ID |
| `limit` | number | no | Max results (default: 20) |

### `get_listing`
Get full details for a specific listing.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `listing_id` | string | yes | Marketplace listing ID |

### `monitor_search`
Save a search as a monitor to track new listings over time.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | yes | Monitor name |
| `query` | string | yes | Search term |
| `latitude` | number | yes | Search center lat |
| `longitude` | number | yes | Search center lng |
| `radius_km` | number | no | Radius (default: 50) |
| `min_price` | number | no | Min price |
| `max_price` | number | no | Max price |

### `check_monitors`
Check monitors for new listings since last check.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `monitor_name` | string | no | Check specific monitor, or omit for all |

### `list_monitors`
List all saved monitors.

### `list_found_cars`
List cars discovered by monitors over time, read from the persisted
`cars.csv` history (not just what turned up on the latest check).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `monitor_name` | string | no | Only show cars from this monitor, or omit for all |
| `limit` | number | no | Max cars to show, most recent first (default: 50) |

### `delete_monitor`
Delete a saved monitor.

## Personal Car Shopping List

`npm run seed-car-list` pre-creates monitors for a specific vehicle
shortlist (see `config/car-list.json`) instead of calling `monitor_search`
by hand for each one. Ask your agent to check the monitors periodically,
then ask for `list_found_cars` any time to see everything discovered so
far — it reads from a persisted `cars.csv` in `~/.fb-marketplace/`, so
nothing is lost once `check_monitors` marks a listing as seen. Value any
new hit against KBB/Edmunds before reaching out — see
[`docs/car-list.md`](docs/car-list.md) for the target vehicles, area, and
what counts as a good deal.

### Running unattended (no MCP client, no Chrome/Keychain)

`npm run daily-check` (`scripts/daily-car-check.ts`) checks every saved
monitor and prints a digest of new listings to stdout — no MCP client or
agent loop required, so it can run on a schedule (cron, a Claude Routine,
etc.) on any host, including ones without Chrome or macOS Keychain. It
needs a `.env` file (copy `.env.example`) with:

- `FB_COOKIE_HEADER` — a raw Facebook cookie header copied from Chrome
  DevTools (Network tab → any facebook.com request → `cookie` request
  header), used instead of Keychain extraction. It expires periodically;
  when the daily check starts failing, grab a fresh one.
- `AUTODEV_API_KEY` — optional second data source via
  [Auto.dev](https://www.auto.dev/listings)'s Vehicle Listings API (dealer
  inventory, not private-party — complements rather than duplicates the
  Facebook results). Free API key, 1,000 calls/month free tier; this car
  list's monitors use well under that. Leave unset to skip it — Facebook
  checks still run fine on their own.

  Every Auto.dev listing gets classified into one of three price tiers by
  comparing it to the median price of comparable (used, 0-60,000 mile,
  priced) results in the same batch: **Great** (20%+ below median), **Good**
  (8-20% below median), or **Bad** (anything else, including batches too
  small to judge, or a listing outside that mileage/used comparison pool).
  Every listing is always shown regardless of tier or mileage — the
  0-60,000 range only decides which listings count as peers for computing
  the comparison median, it never hides a listing from the results.
  (An earlier version filtered the mileage range on the results themselves,
  which silently excluded most trucks/SUVs — real used inventory routinely
  exceeds 20k miles even lightly used.) There's no cheap automated
  valuation API to compare against (see `docs/car-list.md`), so this
  peer-comparison is a rough, free stand-in — a starting point for
  eyeballing, not a verdict. All three tiers are stored and shown in the
  web UI (filterable, with a colored badge per row); only Great/Good make
  it into the printed digest so it stays focused on things actually worth
  a look. Tunable in `src/autodev/deal-filter.ts`
  (`DEFAULT_PRICE_TIER_OPTIONS`) if you want a different mileage cap or
  thresholds.

If the check itself fails (most likely an expired cookie), the error is
printed to stderr and the process exits non-zero.

### Web UI (`npm run serve`)

`src/web/server.ts` is a small always-on server that does two things in one
process: serves a mobile-friendly page listing everything in `cars.csv`
(newest first, with working links), and runs the same daily check
internally on its own schedule — no MCP client, no Railway Cron Schedule
needed. One process, one shared volume, nothing to keep in sync across
services.

- `GET /` — the car list page, with filters (price range, location,
  vehicle type, price rating) as query params, and two buttons:
  - **Check now** (`POST /check-now`) — runs the check on demand instead
    of waiting for the daily schedule
  - **Clear all & start fresh** (`POST /clear-all`) — wipes `cars.csv` and
    Auto.dev seen-state, so the next check re-reports every current match
    with none of the old history (e.g. stale pre-fix links) left behind
  - **Manage searches** (collapsible section) — enter a make and hit
    "Search to add" (`GET /search-car`) to preview live Auto.dev listings
    before committing. Leave Model blank to browse every model currently
    listed under that make (grouped with a listing count and price range,
    most common first, each with its own one-click Add) — handy when you
    know you want "a Kia" but not which one yet. Fill in Model too for an
    exact preview of just that model instead. Either way, "Add" / "Add
    this search" (`POST /add-car`) saves it, and Remove (`POST
    /remove-car`) drops it any time. No config file edit or redeploy
    needed either way — new/removed cars take effect on the next check,
    and removing one only stops future checks, it doesn't delete that
    car's past listings from the table. If `AUTODEV_API_KEY`
    isn't set, the preview is skipped but adding still works. This only
    manages the Auto.dev side — Facebook search terms still come from
    `config/car-list.json`.
- `GET /health` — plain `200 ok`, for platform health checks
- `DAILY_CHECK_HOUR_UTC` / `DAILY_CHECK_MINUTE_UTC` (optional, default
  `13`/`0` — i.e. 9am Eastern during daylight saving) — when the internal
  scheduler fires the check once a day

### Deploying to Railway

`railway.json` runs `seed-car-list` then `npm run serve` on deploy, with
`restartPolicyType: ON_FAILURE` so Railway restarts it if it ever crashes
— this is a persistent service, not a one-shot job. `seed-car-list` only
bootstraps Auto.dev monitors from `config/car-list.json` on a completely
empty volume (first-ever deploy); once any exist, it leaves them alone on
every later deploy so cars added/removed through the web UI aren't
reset or re-added by the next redeploy.

1. **New Project → Deploy from GitHub repo**, pick this repo/branch.
2. **Add a Volume** to the service (any mount path, e.g. `/data`) —
   without one, `monitors.json`/`cars.csv` get wiped on every redeploy and
   every listing looks "new" again.
3. **Variables tab**, set:
   - `FB_COOKIE_HEADER` (same as the `.env` value above — set as a real env
     var here instead, no `.env` file needed on Railway). Omit it and set
     `SKIP_FACEBOOK=true` to run Auto.dev-only.
   - `AUTODEV_API_KEY` (optional — omit to skip the Auto.dev source)
   - `FB_MARKETPLACE_HOME` = the volume's mount path (e.g. `/data`), so
     persisted state lands on the volume instead of the ephemeral
     container filesystem
4. Railway should auto-detect the listening port (from `$PORT`) and treat
   this as a normal web service, giving it a public URL — bookmark that on
   your phone/iPad for the car list page. **No Cron Schedule needed** —
   remove it if one's still configured from an earlier setup, since
   scheduling now happens inside the server process itself.

If the build fails on `better-sqlite3` (a native module, only actually
used by the Chrome/Keychain path this deployment doesn't touch), that's a
missing build toolchain in the Nixpacks image — worth flagging if it comes
up, but Railway's default Node builder normally includes what it needs.

## Configuration

| Env Variable | Default | Description |
|-------------|---------|-------------|
| `CHROME_PROFILE` | `Default` | Chrome profile directory name |
| `FB_COOKIE_HEADER` | — | Manual Facebook cookie header, bypasses Chrome/Keychain extraction when set |
| `FB_MARKETPLACE_HOME` | `~/.fb-marketplace` | Where monitors/found-cars state is stored — point this at a mounted volume on hosts with an ephemeral filesystem |
| `AUTODEV_API_KEY` | — | Auto.dev Vehicle Listings API key — optional second data source, skipped entirely if unset |
| `SKIP_FACEBOOK` | — | Set to `true` to skip the Facebook check entirely (Auto.dev-only) |
| `MAX_MONITORS` | — | Testing knob — only check the first N monitors of each source |
| `PORT` | `3000` | Port `npm run serve` listens on (Railway sets this automatically) |
| `DAILY_CHECK_HOUR_UTC` / `DAILY_CHECK_MINUTE_UTC` | `13` / `0` | When `npm run serve`'s internal scheduler fires the daily check |

## Updating GraphQL Queries

Facebook rotates their `doc_id` values on deploys. If searches stop working:

```bash
npm install -D playwright
npx playwright install chromium
npm run capture-queries
```

This opens a browser, navigates Marketplace, and captures current query IDs. Update `src/facebook/queries.ts` with the new values.

## Rate Limiting

The server self-rate-limits to 3 requests/minute with random jitter to avoid detection. This means searches take a few seconds.

## Limitations

- **macOS only** for automatic cookie extraction
- **Requires Chrome** with active Facebook session
- **Facebook ToS** — automating Facebook violates their Terms of Service
- **Fragile** — `doc_id` values change on Facebook deploys
- **Rate limited** — aggressive use may trigger CAPTCHAs or account flags
- **No write operations** — search/read only, no messaging or listing creation
