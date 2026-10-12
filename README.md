# 📇 Contacts API

> REST API for managing **users**, **contacts**, and **addresses** — built with Express 5, TypeScript, Prisma (MySQL), and Redis.

A clean, production-minded API: JWT auth with refresh tokens in `httpOnly` cookies, Zod validation, Redis caching namespaced per user, centralized error handling, and 95%+ test coverage.

---

## ✨ Features

- 🔐 **JWT authentication** — access token (1 hour) + refresh token (1 day) in a signed `httpOnly` / `SameSite=Strict` cookie.
- 🔄 **Auto-refresh** — when the access token expires but a valid refresh token exists, the request still succeeds and the response includes a `newAccessToken`.
- 🚪 **Safe logout** — the refresh token is revoked, so logged-out tokens can't be reused.
- 🔎 **Search & pagination** — find contacts by name / email / phone, with `page` and `size`.
- ⚡ **Redis caching** — profiles, contacts, and addresses are cached (1-hour TTL) with per-user namespaced keys so they can never collide.
- 🛡️ **Zod validation** — input is validated before touching the database; mass-assignment is prevented (unknown fields are stripped).
- 🏗️ **Layered architecture** — routes → controllers → services → models, with validation & utils kept separate.
- 🧪 **Extensive tests** — 143 unit tests + 121 integration tests with coverage thresholds.

---

## 🧰 Tech Stack

| Technology | Purpose |
| --- | --- |
| **Express 5** + **TypeScript** | HTTP server & language |
| **Prisma** (MySQL) | ORM & migrations |
| **Redis** (ioredis) | cache |
| **Zod** | request validation |
| **jsonwebtoken** + **bcrypt** | tokens & password hashing |
| **Jest** + **Supertest** | unit & integration tests |

---

## ✅ Requirements

- Node.js **20** or newer
- MySQL **8**
- Redis **6** or newer

---

## ⚙️ Configuration

Copy `.env.example` to `.env` and fill in the values:

```shell
cp .env.example .env
# then fill in the SECRET_KEY*, DATABASE_URL, etc.
```

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | MySQL connection string |
| `REDIS_URL` | Redis connection string (default `redis://localhost:6379/0`) |
| `SECRET_KEY` | signs the access tokens |
| `SECRET_KEY_DATABASE` | signs the refresh tokens |
| `SECRET_KEY_COOKIE` | signs the refresh token cookie |
| `PORT` | HTTP port (default `3000`) |

> 🔐 **Tip:** use long, random secret values, e.g. `openssl rand -hex 32`.

---

## 🚀 Run Locally

```shell
npm ci
npx prisma generate
npx prisma migrate deploy   # applies prisma/migrations
npm run build
npm start
```

The server runs at `http://localhost:3000`. Health check: `GET /health` (liveness) and
`GET /ready` (readiness — verifies the database and Redis are actually reachable).

### 🗄️ Existing database

If your database was created before the migrations existed, mark the baseline
migration as already applied instead of running it:

```shell
npx prisma migrate resolve --applied 20260101000000_init
```

---

## 🧪 Testing

There are two kinds of tests:

- **📦 Unit tests** (`tests/unit`) — no external services; the database and Redis are mocked.
- **🔌 Integration tests** (`tests/integration`) — the real Express app against real MySQL and Redis.

```shell
npm run test:unit          # fast, nothing to set up
npm run test:integration   # needs MySQL and Redis
npm test                   # both
npm run test:ci            # both + coverage thresholds
npm run typecheck          # type-checks the source and the tests
```

### ⚠️ Safety net

Integration tests **delete every row in every table**, so they refuse to run unless
the database name in `DATABASE_URL` contains `test` — real data can never be wiped.

Tests use Redis database `1` by default (`REDIS_URL=redis://localhost:6379/1`) and
only ever delete the cache keys the application itself creates.

### 🧑‍🔬 Setting up a test database

Prepare a `*_test` database in MySQL and a local Redis, then:

```shell
cp .env.test.example .env.test     # point DATABASE_URL at your test database
npm run migrate:test               # applies migrations to the test DB (reads .env.test)
npm test
```

---

## 🔌 API Reference

### 🔑 Authentication

Protected routes expect the access token in the `Authorization` header:

```
Authorization: <access-token>
```

When the access token has expired but a valid refresh token (cookie) is present,
the request still succeeds and the response includes a `newAccessToken` — the
client simply swaps in the new token.

### 🗂️ Endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/users` | 📝 register |
| `POST` | `/api/users/login` | 🔑 log in |
| `GET` / `PATCH` | `/api/users/current` | 👤 read / update the current user |
| `DELETE` | `/api/users/logout` | 🚪 log out |
| `POST` | `/api/contacts` | ➕ create a contact |
| `GET` | `/api/contacts` | 🔎 search contacts (`name`, `email`, `phone`, `page`, `size`) |
| `GET` / `PATCH` / `DELETE` | `/api/contacts/:contactId` | 👁️ read / ✏️ update / 🗑️ delete a contact |
| `POST` / `GET` | `/api/contacts/:contactId/addresses` | ➕ create / 📋 list addresses |
| `GET` / `PATCH` / `DELETE` | `/api/contacts/:contactId/addresses/:addressId` | 👁️ read / ✏️ update / 🗑️ delete an address |
| `GET` | `/health`, `/ready` | 💚 liveness & readiness |

### 📦 Response Shape

```jsonc
// Success
{ "data": { ... } }

// With pagination
{ "data": [ ... ], "paging": { "currentPage": 1, "totalPage": 3, "size": 10 } }

// Error
{ "errors": "..." }
```

### 🪪 Example: login

```shell
curl -X POST http://localhost:3000/api/users/login \
  -H "Content-Type: application/json" \
  -d '{"username":"alice123","password":"password123"}'
```

### ❌ Status Codes

| Status | Meaning |
| --- | --- |
| `200` | success |
| `400` | validation failed / invalid JSON body |
| `401` | authentication failed |
| `404` | resource not found |
| `409` | username already taken |
| `413` | request body too large |
| `500` | server error (details hidden) |

---

## 📜 License

ISC — built with ❤️ by [Bonzz](https://github.com/bonzz).