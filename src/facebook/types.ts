export interface FacebookCookie {
  host: string;
  name: string;
  value: string;
  path: string;
  expires: number;
  secure: boolean;
  httpOnly: boolean;
}

export interface FacebookSession {
  cookies: FacebookCookie[];
  cookieHeader: string;
  fbDtsg: string;
  lsd: string;
  jazoest: string;
  clientRevision: string;
  userId: string;
}

export interface MarketplaceListing {
  id: string;
  title: string;
  price: string;
  location: string;
  imageUrl: string;
  sellerName: string;
  postedDate: string;
  url: string;
  isPending: boolean;
  // Auto.dev-only: peer-comparison price classification (see
  // src/autodev/deal-filter.ts). Unset for Facebook listings.
  priceTier?: "great" | "good" | "bad";
  // Auto.dev-only: formatted mileage-adjusted fair-price estimate (e.g.
  // "$28,500"), only set when priceTier is "bad" and there was enough peer
  // data to estimate one. Unset otherwise.
  fairPrice?: string;
}

export interface MarketplaceListingDetail extends MarketplaceListing {
  description: string;
  images: string[];
  condition: string;
  seller: {
    name: string;
    profileUrl: string;
  };
}

export interface SearchParams {
  query: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  minPrice?: number;
  maxPrice?: number;
  category?: string;
  limit: number;
  cursor?: string;
}

export interface SearchResult {
  listings: MarketplaceListing[];
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface SavedMonitor {
  id: string;
  name: string;
  params: Omit<SearchParams, "cursor">;
  seenIds: string[];
  createdAt: string;
  lastChecked: string | null;
}
