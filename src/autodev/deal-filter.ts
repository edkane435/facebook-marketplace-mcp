import type { AutoDevListing } from "./client.js";

export type PriceTier = "great" | "good" | "bad";

export interface ClassifiedListing extends AutoDevListing {
  priceTier: PriceTier;
  // Negative = below the comparison price (cheaper), positive = above. Null
  // when there weren't enough comparable listings in the batch to judge.
  pctVsMedian: number | null;
  // What this specific listing "should" cost given its mileage, per the
  // peer group's price-vs-mileage trend (or the flat peer median if there
  // wasn't a usable trend). Null when there weren't enough peers to judge
  // against at all. Only meant to be shown for "bad" tier listings — see
  // classifyByPrice's comment below.
  fairPriceEstimate: number | null;
}

export interface PriceTierOptions {
  minMileage: number;
  maxMileage: number;
  // Below this fraction under the peer median -> "great"
  greatThresholdPct: number;
  // Below this fraction under the peer median (but not "great") -> "good"
  goodThresholdPct: number;
}

export const DEFAULT_PRICE_TIER_OPTIONS: PriceTierOptions = {
  minMileage: 0,
  maxMileage: 60000,
  greatThresholdPct: 0.2,
  goodThresholdPct: 0.08,
};

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Least-squares fit of price against mileage across the peer group, so a
// listing's "fair price" can account for its own mileage instead of just
// the flat median of a batch that mixes low- and high-mileage peers
// together. Returns null when there isn't a usable downward trend to fit
// (e.g. all peers at the same mileage, or — from small-sample noise —
// price appearing to go up with mileage, which isn't a real signal worth
// trusting).
function fitPriceVsMileage(
  points: Array<{ mileage: number; price: number }>
): { slope: number; intercept: number } | null {
  const n = points.length;
  const meanX = points.reduce((sum, p) => sum + p.mileage, 0) / n;
  const meanY = points.reduce((sum, p) => sum + p.price, 0) / n;

  let numerator = 0;
  let denominator = 0;
  for (const p of points) {
    numerator += (p.mileage - meanX) * (p.price - meanY);
    denominator += (p.mileage - meanX) ** 2;
  }
  if (denominator === 0) return null;

  const slope = numerator / denominator;
  if (slope >= 0) return null;

  return { slope, intercept: meanY - slope * meanX };
}

// Not a real appraisal — there's no cheap automated valuation source wired
// in (see docs/car-list.md for why KBB/Edmunds aren't automated here). This
// classifies each listing against a "fair price" derived from *other
// comparable results in the same batch* as a rough, free stand-in. Small
// sample sizes (a handful of listings per make/model) make this noisy —
// treat the tier (and the fair-price estimate) as a starting point for
// eyeballing, not a verdict.
//
// Every input listing is always returned — mileage/used/price only decide
// the *peer group* used to compute the comparison price, never whether a
// listing gets shown at all. (This used to filter the returned list itself,
// which silently hid every listing over the mileage cap — devastating for
// trucks/SUVs that routinely exceed it even lightly used, while barely
// affecting smaller cars; that's why some vehicle types appeared to have no
// results at all.) A listing that isn't part of the peer group, or when
// there aren't enough peers to judge against, just gets tier "bad" with a
// null fairPriceEstimate rather than being dropped.
export function classifyByPrice(
  listings: AutoDevListing[],
  options: PriceTierOptions = DEFAULT_PRICE_TIER_OPTIONS
): ClassifiedListing[] {
  const peers = listings.filter(
    (l) =>
      l.used &&
      l.mileageValue != null &&
      l.mileageValue >= options.minMileage &&
      l.mileageValue <= options.maxMileage &&
      l.priceValue != null
  );

  const peerMedian = peers.length >= 3 ? median(peers.map((l) => l.priceValue!)) : null;

  // Prefer a price-vs-mileage trend across the peer group so the fair-price
  // estimate reflects THIS listing's mileage rather than a flat median that
  // mixes low- and high-mileage peers together — falls back to the flat
  // median (peerMedian) whenever there isn't a usable trend to fit.
  const trend =
    peers.length >= 3
      ? fitPriceVsMileage(
          peers.map((l) => ({ mileage: l.mileageValue!, price: l.priceValue! }))
        )
      : null;

  function fairPriceFor(mileageValue: number | null): number | null {
    if (trend && mileageValue != null) {
      return Math.max(0, trend.intercept + trend.slope * mileageValue);
    }
    return peerMedian;
  }

  return listings.map((l) => {
    const fairPrice = fairPriceFor(l.mileageValue);
    if (fairPrice == null || l.priceValue == null) {
      return { ...l, priceTier: "bad", pctVsMedian: null, fairPriceEstimate: null };
    }
    const pct = (l.priceValue - fairPrice) / fairPrice;
    const priceTier: PriceTier =
      pct <= -options.greatThresholdPct
        ? "great"
        : pct <= -options.goodThresholdPct
          ? "good"
          : "bad";
    return { ...l, priceTier, pctVsMedian: pct, fairPriceEstimate: Math.round(fairPrice) };
  });
}
