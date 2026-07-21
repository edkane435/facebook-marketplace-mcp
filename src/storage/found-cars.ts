import fs from "node:fs";
import path from "node:path";
import type { MarketplaceListing } from "../facebook/types.js";
import { getStorageDir } from "./storage-dir.js";

function getCarsFile(): string {
  return path.join(getStorageDir(), "cars.csv");
}

const COLUMNS = [
  "monitor",
  "title",
  "price",
  "location",
  "seller",
  "posted_date",
  "date_found",
  "url",
  "price_tier",
  "external_id",
] as const;

export interface FoundCar {
  monitor: string;
  title: string;
  price: string;
  location: string;
  seller: string;
  postedDate: string;
  dateFound: string;
  url: string;
  priceTier: string;
  // Facebook listing id or Auto.dev VIN — used to tell whether a listing is
  // still actually for sale (see pruneGoneListings). Blank for rows written
  // before this column existed.
  externalId: string;
}

function ensureStorageDir() {
  const dir = getStorageDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function csvField(value: string): string {
  const clean = value.replace(/\r?\n/g, " ");
  if (clean.includes(",") || clean.includes('"')) {
    return `"${clean.replace(/"/g, '""')}"`;
  }
  return clean;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

export function appendFoundCars(
  monitorName: string,
  listings: MarketplaceListing[]
): void {
  ensureStorageDir();

  const carsFile = getCarsFile();
  const isNewFile = !fs.existsSync(carsFile);
  const dateFound = new Date().toISOString();

  const lines: string[] = [];
  if (isNewFile) {
    lines.push(COLUMNS.join(","));
  }

  for (const listing of listings) {
    lines.push(
      [
        monitorName,
        listing.title,
        listing.price,
        listing.location,
        listing.sellerName,
        listing.postedDate,
        dateFound,
        listing.url,
        listing.priceTier ?? "",
        listing.id ?? "",
      ]
        .map(csvField)
        .join(",")
    );
  }

  fs.appendFileSync(carsFile, lines.join("\n") + "\n");
}

function rowToCar(row: string): FoundCar {
  const [monitor, title, price, location, seller, postedDate, dateFound, url, priceTier, externalId] =
    parseCsvLine(row);
  // priceTier/externalId are undefined for rows written before those
  // columns existed.
  return {
    monitor,
    title,
    price,
    location,
    seller,
    postedDate,
    dateFound,
    url,
    priceTier: priceTier ?? "",
    externalId: externalId ?? "",
  };
}

export function loadFoundCars(monitorName?: string): FoundCar[] {
  const carsFile = getCarsFile();
  if (!fs.existsSync(carsFile)) {
    return [];
  }

  const raw = fs.readFileSync(carsFile, "utf-8").trim();
  if (!raw) return [];

  const [, ...rows] = raw.split("\n");
  const cars = rows.map(rowToCar);

  return monitorName ? cars.filter((c) => c.monitor === monitorName) : cars;
}

// Auto.dev rows link to `https://www.google.com/search?q=<VIN>` (optionally
// with " | Carfax: ..." appended) — a fallback identifier for rows written
// before the external_id column existed, so pruning can still cover them.
function extractVinFromUrl(url: string): string {
  const match = url.match(/[?&]q=([^&\s|]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

// Removes found-car rows for one monitor whose listing is no longer among
// the given "currently active" ids (i.e. sold/delisted) — keeps cars.csv
// reflecting what's actually still for sale without wiping legitimate
// history. Rows with no identifiable id (old rows with neither
// external_id nor a parseable VIN link) are left alone since there's no
// safe way to tell whether they're still active. Returns how many were
// removed.
export function pruneGoneListings(monitorName: string, activeIds: Set<string>): number {
  const carsFile = getCarsFile();
  if (!fs.existsSync(carsFile)) return 0;

  const raw = fs.readFileSync(carsFile, "utf-8").trim();
  if (!raw) return 0;

  const [header, ...rows] = raw.split("\n");
  let removed = 0;

  const kept = rows.filter((row) => {
    const car = rowToCar(row);
    if (car.monitor !== monitorName) return true;

    const id = car.externalId || extractVinFromUrl(car.url);
    if (!id) return true;
    if (activeIds.has(id)) return true;

    removed++;
    return false;
  });

  if (removed > 0) {
    fs.writeFileSync(carsFile, [header, ...kept].join("\n") + "\n");
  }

  return removed;
}

export function foundCarsFilePath(): string {
  return getCarsFile();
}

export function clearFoundCars(): void {
  const carsFile = getCarsFile();
  if (fs.existsSync(carsFile)) {
    fs.unlinkSync(carsFile);
  }
}
