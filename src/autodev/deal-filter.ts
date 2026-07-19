import type { AutoDevListing } from "./client.js";

export interface DealFilterOptions {
  minMileage: number;
  maxMileage: number;
  // Keep a listing if its price is at least this fraction below the median
  // price of the other candidates in the same batch (same make/model call).
  discountPct: number;
}

export const DEFAULT_DEAL_FILTER: DealFilterOptions = {
  minMileage: 0,
  maxMileage: 20000,
  discountPct: 0.1,
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
// flags listings priced notably below the median of *other comparable
// results in the same batch* as a rough, free stand-in. Small sample sizes
// (a handful of listings per make/model) make this noisy; treat it as a
// pre-filter to reduce what you have to eyeball, not a verdict.
export function filterToGoodDeals(
  listings: AutoDevListing[],
  options: DealFilterOptions = DEFAULT_DEAL_FILTER
): AutoDevListing[] {
  const candidates = listings.filter(
    (l) =>
      l.used &&
      l.mileageValue != null &&
      l.mileageValue >= options.minMileage &&
      l.mileageValue <= options.maxMileage &&
      l.priceValue != null
  );

  if (candidates.length < 3) {
    // Not enough comparable listings in this batch to judge "below median"
    // meaningfully — return the mileage-filtered set as-is.
    return candidates;
  }

  const prices = candidates
    .map((l) => l.priceValue)
    .filter((p): p is number => p != null);
  const peerMedian = median(prices);
  const ceiling = peerMedian * (1 - options.discountPct);

  return candidates.filter((l) => l.priceValue != null && l.priceValue <= ceiling);
}
