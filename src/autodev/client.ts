// Auto.dev's Vehicle Listings API (docs.auto.dev/v2/products/vehicle-listings).
// Field names for the nested `retailListing` object are a best-effort read of
// public docs/examples, not a verified schema — check a live response and
// adjust the mapping below if a field comes back empty.
const LISTINGS_URL = "https://api.auto.dev/listings";

export interface AutoDevListing {
  vin: string;
  title: string;
  price: string;
  priceValue: number | null;
  mileage: string;
  mileageValue: number | null;
  location: string;
  dealer: string;
  url: string;
}

export interface AutoDevSearchParams {
  apiKey: string;
  make: string;
  model: string;
  zip: string;
  distanceMiles: number;
  minMileage?: number;
  maxMileage?: number;
}

export async function searchAutoDevListings(
  params: AutoDevSearchParams
): Promise<AutoDevListing[]> {
  const url = new URL(LISTINGS_URL);
  url.searchParams.set("vehicle.make", params.make);
  url.searchParams.set("vehicle.model", params.model);
  url.searchParams.set("zip", params.zip);
  url.searchParams.set("distance", String(params.distanceMiles));

  if (params.minMileage != null || params.maxMileage != null) {
    // Same dash-range convention Auto.dev's docs show for price/year —
    // unconfirmed for mileage specifically, so mileageValue below is also
    // filtered client-side as a safety net in case this param is ignored.
    url.searchParams.set(
      "retailListing.mileage",
      `${params.minMileage ?? 0}-${params.maxMileage ?? 999999}`
    );
  }

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${params.apiKey}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Auto.dev API error: ${res.status} ${res.statusText} ${body}`
    );
  }

  const json = (await res.json()) as { data?: unknown[] };
  const rows = Array.isArray(json.data) ? json.data : [];

  if (rows.length > 0) {
    const sample = rows[0] as Record<string, any>;
    console.log(
      "[auto.dev] retailListing keys:",
      Object.keys(sample.retailListing ?? {}).join(", ")
    );
    console.log(
      "[auto.dev] vehicle keys:",
      Object.keys(sample.vehicle ?? {}).join(", ")
    );
  }

  return rows.map((row) => {
    const r = row as Record<string, any>;
    const vehicle = r.vehicle ?? {};
    const listing = r.retailListing ?? {};

    const title = [vehicle.year, vehicle.make, vehicle.model, vehicle.trim]
      .filter(Boolean)
      .join(" ");

    const rawPrice = listing.price;
    const priceValue = rawPrice != null ? Number(rawPrice) : null;
    const price = priceValue != null ? `$${priceValue.toLocaleString()}` : "N/A";

    // Best-effort field name guesses — mileage came back N/A on the first
    // real run, so "mileage" alone isn't it. Trying likely alternates.
    const rawMileage = listing.mileage ?? listing.odometer ?? listing.miles;
    const mileageValue = rawMileage != null ? Number(rawMileage) : null;
    const mileage =
      mileageValue != null ? `${mileageValue.toLocaleString()} mi` : "N/A";

    const location =
      [listing.city, listing.state].filter(Boolean).join(", ") || "Unknown";
    const vin = vehicle.vin ?? r.vin ?? "";

    // Best-effort guess at whichever field holds the clickout/detail link —
    // none of these are confirmed against a real response yet. Falls back to
    // a VIN search rather than inventing a URL pattern that 404s.
    const listingUrl =
      listing.vdpUrl ??
      listing.clickoutUrl ??
      listing.listingUrl ??
      listing.detailUrl ??
      listing.link ??
      listing.url ??
      (vin ? `https://www.google.com/search?q=${encodeURIComponent(vin)}` : "");

    return {
      vin,
      title: title || "Unknown vehicle",
      price,
      priceValue,
      mileage,
      mileageValue,
      location,
      dealer: listing.dealerName ?? listing.dealer ?? "Unknown",
      url: listingUrl,
    };
  });
}
