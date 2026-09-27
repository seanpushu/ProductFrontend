// Thin client for the Product Service. Only GET /products is used by the
// public catalog; there are no credentials and no write calls.

export type Product = {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  currency: string;
  image_url: string | null;
  status: "ACTIVE" | "INACTIVE";
  created_at: string;
  updated_at: string;
};

export type ProductPage = {
  items: Product[];
  total: number;
  limit: number;
  offset: number;
};

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ApiError";
  }
}

export function apiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_BASE_URL;
  if (!raw) throw new ApiError("VITE_API_BASE_URL is not configured");
  return raw.replace(/\/+$/, "");
}

export async function fetchProducts(
  limit: number,
  offset: number,
  signal?: AbortSignal,
  base: string = apiBaseUrl(),
): Promise<ProductPage> {
  const url = `${base}/products?limit=${limit}&offset=${offset}`;
  let res: Response;
  try {
    res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError("Could not reach the product service");
  }
  if (!res.ok) throw new ApiError(`Product service returned HTTP ${res.status}`, res.status);
  const body = (await res.json()) as Partial<ProductPage>;
  if (!Array.isArray(body.items) || typeof body.total !== "number") {
    throw new ApiError("Unexpected response from the product service");
  }
  return body as ProductPage;
}

// price_cents is already an integer number of minor units: 1299 -> $12.99.
export function formatPrice(priceCents: number, currency: string): string {
  const code = /^[A-Z]{3}$/.test(currency) ? currency : "USD";
  const formatter = new Intl.NumberFormat("en-US", { style: "currency", currency: code });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(priceCents / 10 ** digits);
}
