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
- `SMTP_USER` / `SMTP_APP_PASSWORD` / `EMAIL_TO` — Gmail SMTP credentials
  (an [App Password](https://myaccount.google.com/apppasswords), not your
  normal password) for sending the digest.

If `SMTP_*` isn't set, it just prints the digest to stdout instead of
emailing. If the check itself fails (most likely an expired cookie), it
emails an alert saying so instead of failing silently.

## Configuration

| Env Variable | Default | Description |
|-------------|---------|-------------|
| `CHROME_PROFILE` | `Default` | Chrome profile directory name |
| `FB_COOKIE_HEADER` | — | Manual Facebook cookie header, bypasses Chrome/Keychain extraction when set |
| `SMTP_USER` / `SMTP_APP_PASSWORD` / `EMAIL_TO` | — | Gmail SMTP credentials for `daily-check`'s digest email |

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
