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
monitor and emails a digest of new listings — no MCP client or agent loop
required, so it can run on a schedule (cron, a Claude Routine, etc.) on any
host, including ones without Chrome or macOS Keychain. It needs a `.env`
file (copy `.env.example`) with:

- `FB_COOKIE_HEADER` — a raw Facebook cookie header copied from Chrome
  DevTools (Network tab → any facebook.com request → `cookie` request
  header), used instead of Keychain extraction. It expires periodically;
  when the daily check starts failing, grab a fresh one.
- `AUTODEV_API_KEY` — optional second data source via
  [Auto.dev](https://www.auto.dev/listings)'s Vehicle Listings API (dealer
  inventory, not private-party — complements rather than duplicates the
  Facebook results). Free API key, 1,000 calls/month free tier; this car
  list's 9 monitors use well under that. Leave unset to skip it — Facebook
  checks still run fine on their own.
- `RESEND_API_KEY` / `EMAIL_TO` — sends the digest via
  [Resend](https://resend.com)'s HTTP API rather than raw SMTP. This
  matters on most cloud hosts (Railway included): outbound SMTP ports are
  blocked by default as an anti-spam measure, so an SMTP-based sender just
  hangs and times out there regardless of correct credentials — an HTTP
  API on port 443 sidesteps that entirely.

If `RESEND_API_KEY`/`EMAIL_TO` aren't set, it just prints the digest to
stdout instead of emailing. If the check itself fails (most likely an
expired cookie), it emails an alert saying so instead of failing silently.

### Deploying to Railway

`railway.json` is already set up to run `seed-car-list` (idempotent — safe
to run every time) then `daily-check` on each fire, with
`restartPolicyType: NEVER` so a clean exit doesn't loop-restart it.

1. **New Project → Deploy from GitHub repo**, pick this repo/branch.
2. **Add a Volume** to the service (any mount path, e.g. `/data`) —
   without one, `monitors.json`/`cars.csv` get wiped on every redeploy and
   every listing looks "new" again.
3. **Variables tab**, set:
   - `FB_COOKIE_HEADER`, `RESEND_API_KEY`, `EMAIL_TO` (same as the `.env`
     values above — set as real env vars here instead, no `.env` file
     needed on Railway)
   - `AUTODEV_API_KEY` (optional — omit to skip the Auto.dev source)
   - `FB_MARKETPLACE_HOME` = the volume's mount path (e.g. `/data`), so
     persisted state lands on the volume instead of the ephemeral
     container filesystem
4. **Settings → Cron Schedule**, set how often to run (e.g. once daily).
   Railway only starts the container on each fire and lets it exit — it's
   not an always-on service.

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
| `RESEND_API_KEY` / `EMAIL_TO` / `EMAIL_FROM` | — | Resend HTTP API credentials for `daily-check`'s digest email (`EMAIL_FROM` optional, defaults to Resend's shared sender) |

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
