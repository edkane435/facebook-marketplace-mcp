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
| Midsize 3-row crossover | Kia Telluride + close peers (Hyundai Palisade, Honda Pilot, Toyota Highlander, VW Atlas) | `telluride`, `palisade`, `pilot`, `highlander`, `atlas` |
| Truck | Ford F-150, Ram 1500 | `f150`, `ram1500` |

The Telluride peers are included because "a 3-row crossover like the
Telluride" casts a slightly wider net than one nameplate — same segment,
similar size/features, and cross-shopping them is how you actually find the
best deal in that class. Delete the ones you don't care about from
`config/car-list.json` if you'd rather keep it to Telluride only.

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

This MCP requires macOS + Chrome logged into Facebook (cookie extraction),
so seeding and checking monitors has to happen on your own machine, not in
a cloud sandbox:

```bash
npm install
npm run build
npm run seed-car-list   # one-time: creates the 9 monitors above
```

Then, from Claude (or whichever agent has this MCP connected), just ask it
to check your car monitors — that runs `check_monitors` and reports new
listings across all nine searches at once. Re-run it hourly, daily, however
often you want; it only shows genuinely *new* listings each time.

To see the full list of everything found so far (not just the latest
check), ask for `list_found_cars` — optionally scoped to one monitor, e.g.
"show me found cars for the telluride monitor." It reads from
`~/.fb-marketplace/cars.csv`, which every `check_monitors` run appends to,
so it's a running history you can also open directly in Excel/Numbers/a
text editor at any time.

For each new candidate: price it (KBB/Edmunds), and if it clears the "good
deal" bar above, message the seller yourself. That last step is manual by
design — this list is for surfacing deals, not for automating outreach.
