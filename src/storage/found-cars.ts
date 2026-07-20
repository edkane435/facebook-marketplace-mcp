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
      ]
        .map(csvField)
        .join(",")
    );
  }

  fs.appendFileSync(carsFile, lines.join("\n") + "\n");
}

export function loadFoundCars(monitorName?: string): FoundCar[] {
  const carsFile = getCarsFile();
  if (!fs.existsSync(carsFile)) {
    return [];
  }

  const raw = fs.readFileSync(carsFile, "utf-8").trim();
  if (!raw) return [];

  const [, ...rows] = raw.split("\n");
  const cars = rows.map((row) => {
    const [monitor, title, price, location, seller, postedDate, dateFound, url, priceTier] =
      parseCsvLine(row);
    // priceTier is undefined for rows written before this column existed.
    return { monitor, title, price, location, seller, postedDate, dateFound, url, priceTier: priceTier ?? "" };
  });

  return monitorName ? cars.filter((c) => c.monitor === monitorName) : cars;
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
