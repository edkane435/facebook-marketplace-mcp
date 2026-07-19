// Auto.dev's Vehicle Listings API (docs.auto.dev/v2/products/vehicle-listings).
// Field names for the nested `retailListing` object are a best-effort read of
// public docs/examples, not a verified schema — check a live response and
// adjust the mapping below if a field comes back empty.
const LISTINGS_URL = "https://api.auto.dev/listings";

export interface AutoDevListing {
  vin: string;
  title: string;
  price: string;
  mileage: string;
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
}

export async function searchAutoDevListings(
  params: AutoDevSearchParams
): Promise<AutoDevListing[]> {
  const url = new URL(LISTINGS_URL);
  url.searchParams.set("vehicle.make", params.make);
  url.searchParams.set("vehicle.model", params.model);
  url.searchParams.set("zip", params.zip);
  url.searchParams.set("distance", String(params.distanceMiles));

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

  return rows.map((row) => {
    const r = row as Record<string, any>;
    const vehicle = r.vehicle ?? {};
    const listing = r.retailListing ?? {};

    const title = [vehicle.year, vehicle.make, vehicle.model, vehicle.trim]
      .filter(Boolean)
      .join(" ");

    const price =
      listing.price != null ? `$${Number(listing.price).toLocaleString()}` : "N/A";
    const mileage =
      listing.mileage != null
        ? `${Number(listing.mileage).toLocaleString()} mi`
        : "N/A";
    const location =
      [listing.city, listing.state].filter(Boolean).join(", ") || "Unknown";
    const vin = vehicle.vin ?? r.vin ?? "";

    return {
      vin,
      title: title || "Unknown vehicle",
      price,
      mileage,
      location,
      dealer: listing.dealerName ?? listing.dealer ?? "Unknown",
      url: listing.vdpUrl ?? listing.url ?? (vin ? `https://www.auto.dev/listings/${vin}` : ""),
    };
  });
}
