# ProductFrontend

Public product catalog for the AI Product course project. A static React + TypeScript (Vite) site that
calls the real Product Service (`GET /products`) from the browser and shows name, image, price and
description. No login, cart or payment.

Backend: [seanpushu/ProductService](https://github.com/seanpushu/ProductService).

## Run locally

```powershell
npm ci
copy .env.example .env.local        # VITE_API_BASE_URL=http://localhost:8080
npm run dev                          # http://localhost:5173
```

The Product Service must be running and allow the origin `http://localhost:5173` (its default
`CORS_ALLOW_ORIGINS`).

## Checks

```powershell
npm run typecheck
npm test          # vitest + Testing Library, HTTP is mocked
npm run build     # needs VITE_API_BASE_URL
```

Tests cover: request URL with `limit`/`offset`, price formatting from integer cents (1299 -> $12.99),
loading, empty list, HTTP error and network error with retry, broken / missing images, pagination,
and the sign-in UI (register -> confirm -> sign in -> `/me`, wrong password, unconfirmed account,
session restore on reload, one refresh retry on 401, sign-out). HTTP is mocked in tests.

## Accounts (User Service)

The header has **Sign in** / **Create account**. Forms call the User Service
(`VITE_AUTH_BASE_URL`, local `http://localhost:8081`; empty in production = same origin through CloudFront):
register (email, password, confirm password checked in the browser only) -> email code -> sign in ->
"My profile" from `GET /me` -> sign out. Access tokens are kept in memory; the refresh token is an
HttpOnly cookie the page cannot read. Every POST sends `X-CSRF-Token` and `credentials: "include"`.
The catalog stays public: anonymous visitors can browse without signing in.

## Behaviour

- Requests `GET {VITE_API_BASE_URL}/products?limit=12&offset=N` and reads `items` / `total`.
- Shows "Showing a-b of total"; Previous / Next page with `offset` when `total` exceeds one page.
- On failure it shows an error and a Try again button. It never falls back to built-in product data.
- A missing or failing image becomes a text placeholder; the rest of the page is unaffected.
- `VITE_API_BASE_URL` is compiled into public JavaScript. Never put secrets in `VITE_*` variables.

## Deployment

| Trigger | Workflow | What happens |
|---|---|---|
| Pull request to `main` | `ci.yml` | typecheck, tests, build, cfn-lint. No AWS access. |
| Push to `main` | `deploy.yml` | runs CI, builds with the production API URL, uploads to the private S3 bucket, invalidates CloudFront, checks `/version.txt` = commit SHA, bundle API URL, and API CORS. |

Hosting (`infra/frontend-hosting.yml`, stack `productfrontend-hosting`): private bucket
`productfrontend-site-<account>` read only by CloudFront through OAC, HTTPS via the default
`*.cloudfront.net` certificate, and an OIDC role `productfrontend-github-deploy` that can only write this
bucket and invalidate this distribution (main branch of this repo only).

Caching: `assets/*` files have content hashes and are cached for a year; `index.html` and `version.txt`
use `no-cache` and are invalidated after every deploy.

Repository settings used by `deploy.yml`:

- Secret `AWS_ROLE_ARN`: stack output `GitHubDeployRoleArn`.
- Variables `SITE_BUCKET`, `DISTRIBUTION_ID`, `SITE_URL`: stack outputs.
- Variable `API_BASE_URL`: `https://api.shupu.me`.

The Product Service write endpoints have no authentication (see its README). This site only reads.
