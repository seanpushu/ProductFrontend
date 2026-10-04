import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, PAGE_SIZE } from "./App";
import { formatPrice, type Product } from "./api";

const product = (over: Partial<Product> = {}): Product => ({
  id: crypto.randomUUID(),
  name: "Blueberries, 1 Pint",
  description: "Fresh blueberries",
  price_cents: 1299,
  currency: "USD",
  image_url: "https://images.test/blueberries.jpg",
  status: "ACTIVE",
  created_at: "2026-09-27T00:00:00Z",
  updated_at: "2026-09-27T00:00:00Z",
  ...over,
});

// Product requests get the queued responses in order. Auth requests made by
// AuthProvider on page load (no session here) answer 401 and do not consume them.
function mockFetch(...responses: Array<() => Promise<Response>>) {
  const queue = [...responses];
  const products = vi.fn((input: RequestInfo | URL) => {
    void input;
    const next = queue.shift();
    return next ? next() : Promise.reject(new Error("unexpected product request"));
  });
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      if (String(input).startsWith("http://auth.test")) {
        return Promise.resolve(new Response(JSON.stringify({ code: "SESSION_INVALID" }), { status: 401 }));
      }
      return products(input);
    }),
  );
  return products;
}
const json = (body: unknown, status = 200) => () =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

describe("formatPrice", () => {
  it("formats integer cents once", () => {
    expect(formatPrice(1299, "USD")).toBe("$12.99");
    expect(formatPrice(0, "USD")).toBe("$0.00");
    expect(formatPrice(6497, "USD")).toBe("$64.97");
  });
  it("respects currencies without minor units", () => {
    expect(formatPrice(500, "JPY")).toBe("¥500");
  });
});

describe("App", () => {
  // Pin the API URL so a VITE_API_BASE_URL left in the shell cannot change the test.
  beforeEach(() => {
    vi.stubEnv("VITE_API_BASE_URL", "http://api.test");
    vi.stubEnv("VITE_AUTH_BASE_URL", "http://auth.test");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("calls GET /products with limit/offset and renders items", async () => {
    const fetchFn = mockFetch(json({ items: [product()], total: 1, limit: PAGE_SIZE, offset: 0 }));
    render(<App />);
    expect(screen.getByText(/loading products/i)).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Blueberries, 1 Pint" })).toBeInTheDocument();
    expect(screen.getByText("$12.99")).toBeInTheDocument();
    expect(screen.getByText("Fresh blueberries")).toBeInTheDocument();
    expect(screen.getByText("Showing 1–1 of 1 products")).toBeInTheDocument();
    expect(String(fetchFn.mock.calls[0][0])).toBe(`http://api.test/products?limit=${PAGE_SIZE}&offset=0`);
  });

  it("shows an empty state", async () => {
    mockFetch(json({ items: [], total: 0, limit: PAGE_SIZE, offset: 0 }));
    render(<App />);
    expect(await screen.findByText(/no products are available/i)).toBeInTheDocument();
  });

  it("shows an error and retries", async () => {
    mockFetch(json({ detail: "boom" }, 503), json({ items: [product()], total: 1, limit: PAGE_SIZE, offset: 0 }));
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("HTTP 503");
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByText("$12.99")).toBeInTheDocument();
  });

  it("shows an error when the network fails, without fake data", async () => {
    mockFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not reach/i);
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("replaces a broken or missing image with a placeholder", async () => {
    mockFetch(json({ items: [product({ name: "A" }), product({ name: "B", image_url: null })], total: 2, limit: PAGE_SIZE, offset: 0 }));
    render(<App />);
    const img = await screen.findByRole("img", { name: "A" });
    fireEvent.error(img);
    expect(screen.getByRole("img", { name: /no image available for A/i })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /no image available for B/i })).toBeInTheDocument();
  });

  it("pages with offset when total exceeds one page", async () => {
    const first = Array.from({ length: PAGE_SIZE }, (_, i) => product({ name: `P${i}` }));
    const fetchFn = mockFetch(
      json({ items: first, total: PAGE_SIZE + 1, limit: PAGE_SIZE, offset: 0 }),
      json({ items: [product({ name: "Last" })], total: PAGE_SIZE + 1, limit: PAGE_SIZE, offset: PAGE_SIZE }),
    );
    render(<App />);
    expect(await screen.findByText(`Showing 1–${PAGE_SIZE} of ${PAGE_SIZE + 1} products`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("heading", { name: "Last" })).toBeInTheDocument();
    expect(String(fetchFn.mock.calls[1][0])).toContain(`offset=${PAGE_SIZE}`);
  });
});
