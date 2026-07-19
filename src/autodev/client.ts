// Auto.dev's Vehicle Listings API (docs.auto.dev/v2/products/vehicle-listings).
// Confirmed field names from a live response's retailListing object:
// carfaxUrl, city, cpo, dealer, miles, photoCount, price, primaryImage,
// state, used, vdp, zip, dealerId. vehicle object: baseInvoice, baseMsrp,
// bodyStyle, confidence, cylinders, doors, drivetrain, engine,
// exteriorColor, fuel, interiorColor, make, model, seats, series,
// squishVin, style, transmission, trim, type, vin, year.
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
  used: boolean;
  cpo: boolean;
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

    const priceValue = listing.price != null ? Number(listing.price) : null;
    const price = priceValue != null ? `$${priceValue.toLocaleString()}` : "N/A";

    const mileageValue = listing.miles != null ? Number(listing.miles) : null;
    const mileage =
      mileageValue != null ? `${mileageValue.toLocaleString()} mi` : "N/A";

    const location =
      [listing.city, listing.state].filter(Boolean).join(", ") || "Unknown";
    const vin = vehicle.vin ?? r.vin ?? "";

    // "vdp" (vehicle detail page) is the confirmed field, but its exact
    // format (full URL vs relative path) hasn't been seen directly since
    // it was empty on the monitors checked so far — handling both.
    const rawVdp: string | undefined = listing.vdp;
    const listingUrl = rawVdp
      ? rawVdp.startsWith("http")
        ? rawVdp
        : `https://www.auto.dev${rawVdp.startsWith("/") ? "" : "/"}${rawVdp}`
      : vin
        ? `https://www.google.com/search?q=${encodeURIComponent(vin)}`
        : "";

    return {
      vin,
      title: title || "Unknown vehicle",
      price,
      priceValue,
      mileage,
      mileageValue,
      location,
      dealer: listing.dealer ?? "Unknown",
      url: listingUrl,
      used: listing.used === true,
      cpo: listing.cpo === true,
    };
  });
}
