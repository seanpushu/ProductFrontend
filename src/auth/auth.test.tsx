import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCsrfForTests } from "./api";
import { AuthBar } from "./AuthPanel";
import { AuthProvider } from "./AuthProvider";

// HTTP is mocked: these tests prove the UI logic, not a real Cognito connection.
type Handler = (url: string, init: RequestInit) => [number, unknown];

const PROFILE = { id: "u-1", email: "alice@example.com", status: "ACTIVE", ai_quota_limit: 3, ai_usage_count: 1 };
const TOKENS = { access_token: "access-1", id_token: "id-1", token_type: "Bearer", expires_in: 3600 };

function mockServer(routes: Record<string, Handler | [number, unknown]>) {
  const calls: Array<{ path: string; init: RequestInit }> = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const path = url.replace("http://auth.test", "").split("?")[0];
    calls.push({ path, init });
    const route = routes[`${init.method ?? "GET"} ${path}`];
    if (!route) return new Response(JSON.stringify({ code: "NOT_FOUND" }), { status: 404 });
    const [status, body] = typeof route === "function" ? route(url, init) : route;
    return new Response(status === 204 ? null : JSON.stringify(body), { status });
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

const base = {
  "GET /auth/csrf": [200, { csrf_token: "csrf-abc" }] as [number, unknown],
};

// The header has "Sign in" / "Create account" toggles; form buttons live in the panel.
const panel = () => within(screen.getByRole("region", { name: "Account" }));

function renderBar() {
  return render(
    <AuthProvider>
      <AuthBar />
    </AuthProvider>,
  );
}

beforeEach(() => {
  vi.stubEnv("VITE_AUTH_BASE_URL", "http://auth.test");
  resetCsrfForTests();
});
afterEach(() => vi.unstubAllEnvs());

describe("auth UI", () => {
  it("is anonymous when there is no session, and refresh is tried only once", async () => {
    const calls = mockServer({ ...base, "POST /refresh": [401, { code: "SESSION_INVALID", message: "Session expired" }] });
    renderBar();
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(calls.filter((c) => c.path === "/refresh")).toHaveLength(1);
  });

  it("registers, confirms and signs in, showing /me data", async () => {
    let refreshCount = 0;
    const calls = mockServer({
      ...base,
      "POST /refresh": () => (refreshCount++ === 0 ? [401, { code: "SESSION_INVALID" }] : [200, TOKENS]),
      "POST /register": [201, { user_id: "u-1", status: "PENDING_CONFIRMATION", next_step: "CONFIRM_EMAIL" }],
      "POST /confirm": [200, { status: "ACTIVE", next_step: "LOGIN" }],
      "POST /login": [200, TOKENS],
      "GET /me": [200, PROFILE],
    });
    const user = userEvent.setup();
    renderBar();
    await user.click(await screen.findByRole("button", { name: "Create account" }));
    await user.type(screen.getByLabelText("Email"), "alice@example.com");
    await user.type(screen.getByLabelText("Password"), "Secret-Pass-1");
    await user.type(screen.getByLabelText("Confirm password"), "Secret-Pass-1");
    await user.click(panel().getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("heading", { name: "Confirm your email" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Verification code"), "123456");
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await screen.findByText(/Email confirmed/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Password"), "Secret-Pass-1");
    await user.click(panel().getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Signed in as alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("1 of 3")).toBeInTheDocument();

    const me = calls.find((c) => c.path === "/me")!;
    expect((me.init.headers as Record<string, string>).Authorization).toBe("Bearer access-1");
    const posts = calls.filter((c) => c.init.method === "POST");
    for (const p of posts) {
      expect(p.init.credentials).toBe("include");
      expect((p.init.headers as Record<string, string>)["X-CSRF-Token"]).toBe("csrf-abc");
    }
    expect(window.localStorage.length + window.sessionStorage.length).toBe(0);
  });

  it("rejects mismatched passwords locally without calling the API", async () => {
    const calls = mockServer({ ...base, "POST /refresh": [401, {}] });
    const user = userEvent.setup();
    renderBar();
    await user.click(await screen.findByRole("button", { name: "Create account" }));
    await user.type(screen.getByLabelText("Email"), "a@example.com");
    await user.type(screen.getByLabelText("Password"), "One-Pass-1");
    await user.type(screen.getByLabelText("Confirm password"), "Two-Pass-2");
    await user.click(panel().getByRole("button", { name: "Create account" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Passwords do not match.");
    expect(calls.some((c) => c.path === "/register")).toBe(false);
  });

  it("shows the server error for a wrong password and sends unconfirmed users to confirm", async () => {
    let attempt = 0;
    mockServer({
      ...base,
      "POST /refresh": [401, {}],
      "POST /login": () =>
        attempt++ === 0
          ? [401, { code: "INVALID_CREDENTIALS", message: "Incorrect email or password" }]
          : [403, { code: "NOT_CONFIRMED", message: "Please confirm your email before signing in" }],
    });
    const user = userEvent.setup();
    renderBar();
    await user.click(await screen.findByRole("button", { name: "Sign in" }));
    await user.type(screen.getByLabelText("Email"), "a@example.com");
    await user.type(screen.getByLabelText("Password"), "bad");
    await user.click(panel().getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect email or password");
    await user.click(panel().getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { name: "Confirm your email" })).toBeInTheDocument();
  });

  it("restores the session on reload, recovers one 401 via refresh, and signs out", async () => {
    let meCount = 0;
    let refreshCount = 0;
    const calls = mockServer({
      ...base,
      "POST /refresh": () => [200, { ...TOKENS, access_token: `access-${++refreshCount}` }],
      "GET /me": () => (meCount++ === 0 ? [401, { code: "UNAUTHENTICATED" }] : [200, PROFILE]),
      "POST /logout": [204, null],
    });
    const user = userEvent.setup();
    renderBar();
    expect(await screen.findByText("Signed in as alice@example.com")).toBeInTheDocument();
    expect(refreshCount).toBe(2); // page-load restore + one retry after the 401

    await user.click(screen.getByRole("button", { name: "My profile" }));
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument());
    expect(screen.queryByText(/alice@example.com/)).not.toBeInTheDocument();
    expect(calls.some((c) => c.path === "/logout")).toBe(true);
  });

  it("fetches one CSRF token per page and retries once after a CSRF rejection", async () => {
    let refreshCount = 0;
    const calls = mockServer({
      ...base,
      "POST /refresh": () => (++refreshCount === 1 ? [403, { code: "CSRF_FAILED" }] : [401, { code: "SESSION_INVALID" }]),
    });
    renderBar();
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(refreshCount).toBe(2);
    expect(calls.filter((c) => c.path === "/auth/csrf")).toHaveLength(2); // initial + one refetch
  });

  it("renders nothing and calls nothing when accounts are not enabled for the build", async () => {
    vi.stubEnv("VITE_AUTH_BASE_URL", "");
    vi.stubEnv("VITE_AUTH_ENABLED", "false");
    const calls = mockServer({ ...base });
    const { container } = renderBar();
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
    expect(calls).toHaveLength(0);
  });

  it("signs out locally when the retry also fails (no loop)", async () => {
    let refreshCount = 0;
    mockServer({
      ...base,
      "POST /refresh": () => (++refreshCount === 1 ? [200, TOKENS] : [401, { code: "SESSION_INVALID" }]),
      "GET /me": [401, { code: "UNAUTHENTICATED" }],
    });
    renderBar();
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(refreshCount).toBe(2);
  });
});
