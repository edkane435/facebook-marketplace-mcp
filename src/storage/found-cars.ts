import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { MarketplaceListing } from "../facebook/types.js";

const STORAGE_DIR = path.join(os.homedir(), ".fb-marketplace");
const CARS_FILE = path.join(STORAGE_DIR, "cars.csv");

const COLUMNS = [
  "monitor",
  "title",
  "price",
  "location",
  "seller",
  "posted_date",
  "date_found",
  "url",
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
}

function ensureStorageDir() {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
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

  const isNewFile = !fs.existsSync(CARS_FILE);
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
      ]
        .map(csvField)
        .join(",")
    );
  }

  fs.appendFileSync(CARS_FILE, lines.join("\n") + "\n");
}

export function loadFoundCars(monitorName?: string): FoundCar[] {
  if (!fs.existsSync(CARS_FILE)) {
    return [];
  }

  const raw = fs.readFileSync(CARS_FILE, "utf-8").trim();
  if (!raw) return [];

  const [, ...rows] = raw.split("\n");
  const cars = rows.map((row) => {
    const [monitor, title, price, location, seller, postedDate, dateFound, url] =
      parseCsvLine(row);
    return { monitor, title, price, location, seller, postedDate, dateFound, url };
  });

  return monitorName ? cars.filter((c) => c.monitor === monitorName) : cars;
}

export function foundCarsFilePath(): string {
  return CARS_FILE;
}
