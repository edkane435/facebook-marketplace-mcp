# Car List — Personal Purchase (not resale)

This is the personal-use version of the "carwatch" workflow: find candidates
with this MCP's monitors, then value each one manually against KBB/Edmunds
before reaching out. No bulk messaging, no flipping — one car, bought right.

## Search area

- **Center**: West Chester, PA 19382 (lat `39.9601`, lng `-75.6058`)
- **Radius**: 100 km (~62 mi) — covers Philly metro, Delaware, South Jersey,
  northern MD. Widen `radius_km` in `config/car-list.json` if a category comes
  up thin.

## Target vehicles

| Class | Models | Monitor name |
|---|---|---|
| Full-size SUV | GMC Yukon, Chevrolet Tahoe | `yukon`, `tahoe` |
| Midsize 3-row crossover | Kia Telluride, Toyota Highlander | `telluride`, `highlander` |
| Truck | Ford F-150, Ram 1500 | `f150`, `ram1500` |

Add or remove vehicles by editing `config/car-list.json` and running
`npm run seed-car-list` again — it reconciles saved monitors to match the
config exactly, adding new entries and removing ones no longer listed.

No price filters are set on any monitor — per your call, this is about deal
quality, not a fixed budget band. `max_price` is available per-vehicle in the
config if you ever want a ceiling.

## "Lightly used," defined

Since Marketplace search is free text (no year/mileage filter in the API),
apply this when you review results or open `get_listing`:

- **Model year**: 2022 or newer (≤4 years old as of mid-2026)
- **Mileage**: under ~45,000 (roughly ≤12k/yr average or better)
- **Title**: clean, no frame/flood/salvage history mentioned
- **Seller**: private party preferred, but dealer listings are fine too for a
  personal purchase (unlike the flip playbook, you're not trying to avoid
  dealer margin on the *sourcing* side)

## What counts as a good deal

Same valuation method as the source playbook, just without the resale math:

1. Look up KBB (kbb.com → "What's my car worth") or Edmunds
   (`edmunds.com/[make]/[model]/[year]/appraisal-value/`) for the **private
   party value**, using the listing's actual year/mileage/trim and ZIP 19382.
2. Compare asking price to that number:
   - **10–25% under** private party → strong deal, worth a message
   - **25–40% under** → still worth pursuing, but check photos/description
     match the car before reaching out (mismatched photos, vague description,
     or a too-good title are the tells)
   - **>40% under** → not a deal, treat as a red flag (salvage title,
     mileage rollback, or scam listing) rather than a discount
3. Trim and options move the number a lot on these three models in
   particular (Yukon/Tahoe LS→Denali/High Country, F-150/Ram 1500
   XL→Limited/Longhorn) — always price the specific trim, not the nameplate
   average.

## Running it

Two ways to run this, depending on whether a person or a schedule is
driving:

**Interactively**, from Claude (or whichever agent has this MCP
connected) — requires macOS + Chrome logged into Facebook, since that's
where cookie extraction comes from:

```bash
npm install
npm run build
npm run seed-car-list   # one-time: creates the monitors above
```

Then just ask it to check your car monitors — that runs `check_monitors`
and reports new listings across all of them at once. Ask for
`list_found_cars` any time to see everything discovered so far (not just
the latest check) — optionally scoped to one monitor, e.g. "show me found
cars for the telluride monitor."

**Unattended, on a schedule** — no Chrome, no agent loop, no macOS
required. `npm run daily-check` does the same check-and-persist as above
but as a standalone script that prints a digest of new listings to stdout
instead of replying in chat. See the README's "Running unattended" section
for the `.env` setup (a manual Facebook cookie header). This is the one to
point a cron job or a Claude Routine at, or just check the web UI
(`npm run serve`) any time — it runs the same check on its own daily
schedule and shows everything found in a browsable, filterable page.

Either way, everything lands in the same `~/.fb-marketplace/cars.csv`, so
you can also just open that file directly in Excel/Numbers/a text editor
at any time.

For each new candidate: price it (KBB/Edmunds), and if it clears the "good
deal" bar above, message the seller yourself. That last step is manual by
design — this list is for surfacing deals, not for automating outreach.
