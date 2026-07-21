import type { AutoDevListing } from "./client.js";

export type PriceTier = "great" | "good" | "bad";

export interface ClassifiedListing extends AutoDevListing {
  priceTier: PriceTier;
  // Negative = below peer median (cheaper), positive = above. Null when
  // there weren't enough comparable listings in the batch to judge.
  pctVsMedian: number | null;
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

// Not a real appraisal — there's no cheap automated valuation source wired
// in (see docs/car-list.md for why KBB/Edmunds aren't automated here). This
// classifies each listing against the median price of *other comparable
// results in the same batch* as a rough, free stand-in. Small sample sizes
// (a handful of listings per make/model) make this noisy — treat the tier
// as a starting point for eyeballing, not a verdict.
//
// Every input listing is always returned — mileage/used/price only decide
// the *peer group* used to compute the comparison median, never whether a
// listing gets shown at all. (This used to filter the returned list itself,
// which silently hid every listing over the mileage cap — devastating for
// trucks/SUVs that routinely exceed it even lightly used, while barely
// affecting smaller cars; that's why some vehicle types appeared to have no
// results at all.) A listing that isn't part of the peer group, or when
// there aren't enough peers to judge against, just gets tier "bad" rather
// than being dropped.
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

  return listings.map((l) => {
    if (peerMedian == null || l.priceValue == null) {
      return { ...l, priceTier: "bad", pctVsMedian: null };
    }
    const pct = (l.priceValue - peerMedian) / peerMedian;
    const priceTier: PriceTier =
      pct <= -options.greatThresholdPct
        ? "great"
        : pct <= -options.goodThresholdPct
          ? "good"
          : "bad";
    return { ...l, priceTier, pctVsMedian: pct };
  });
}
