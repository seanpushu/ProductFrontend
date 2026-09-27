import { useCallback, useEffect, useState } from "react";
import { fetchProducts, type ProductPage } from "./api";
import { ProductCard } from "./ProductCard";

export const PAGE_SIZE = 12;

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; page: ProductPage };

export function App() {
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    fetchProducts(PAGE_SIZE, offset, controller.signal)
      .then((page) => setState({ kind: "ready", page }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({ kind: "error", message: err instanceof Error ? err.message : "Unknown error" });
      });
    return () => controller.abort();
  }, [offset, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return (
    <>
      <header className="top">
        <p className="eyebrow">Product Service</p>
        <h1>Product Catalog</h1>
        <p className="subtitle">Live products from the catalog database, deployed automatically from GitHub.</p>
      </header>
      <main aria-busy={state.kind === "loading"}>
        <Content state={state} onRetry={retry} onPage={setOffset} />
      </main>
    </>
  );
}

function Content({
  state,
  onRetry,
  onPage,
}: {
  state: State;
  onRetry: () => void;
  onPage: (offset: number) => void;
}) {
  if (state.kind === "loading") {
    return (
      <p className="status" role="status">
        Loading products…
      </p>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="status error" role="alert">
        <p>Products could not be loaded. {state.message}.</p>
        <button type="button" className="primary" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }
  const { items, total, limit, offset } = state.page;
  if (total === 0 || items.length === 0) {
    return (
      <p className="status" role="status">
        No products are available right now.
      </p>
    );
  }
  const from = offset + 1;
  const to = offset + items.length;
  return (
    <>
      <p className="count" role="status">
        Showing {from}–{to} of {total} products
      </p>
      <section className="grid" aria-label="Products">
        {items.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </section>
      {total > limit && (
        <nav className="pager" aria-label="Pagination">
          <button type="button" disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - limit))}>
            Previous
          </button>
          <button type="button" disabled={to >= total} onClick={() => onPage(offset + limit)}>
            Next
          </button>
        </nav>
      )}
    </>
  );
}
