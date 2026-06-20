# Research Report — OAuth Integration Options for Camel Kanban

- **Date:** 2026-06-21
- **Verdict:** Inconclusive
- **Confidence:** medium

## Assumption tested

*"Ada library OAuth yang matang dan production-ready untuk Express 5 + PostgreSQL yang bisa diintegrasikan sebagai SSO (Google, GitHub) berdampingan dengan auth custom yang sudah ada (username/password + bcrypt + session cookie), tanpa breaking change, dan memberikan value signifikan — baik dari sisi user experience (satu-klik login) maupun developer experience (library stabil, community besar, maintenance aktif)."*

**Disconfirming observation:** Tidak ada library OAuth yang stabil/maintained untuk Express 5, ATAU integrasi memerlukan rewrite auth system yang ada, ATAU library punya masalah security/maintenance yang serius.

## Methods used

| # | Method | Category | What it checked |
|---|--------|----------|-----------------|
| 1 | Differential Comparison | empirical | Head-to-head perbandingan Passport.js vs Better Auth vs Auth.js: downloads, stars, maintenance, Express 5 support |
| 2 | Documentation vs Reality Check | triangulation | Verifikasi klaim library di docs vs realita di changelog, issue tracker, dan community discussions |
| 3 | Falsification | adversarial ← refutation method | Aktif mencari bukti yang menolak: maintenance issues, Express 5 incompatibility, schema conflicts, integration complexity |

## Evidence

### Method 1: Differential Comparison

| Kriteria | Passport.js | Better Auth | Auth.js (NextAuth) |
|----------|-------------|-------------|-------------------|
| Weekly Downloads | 7.5M | 350K+ | Declining |
| GitHub Stars | 23.5K | 28.8K | - |
| Last Release | 0.7.0 (Nov 2023) | 1.6.19 (active) | Maintenance mode |
| Maintenance Status | INACTIVE (Snyk: no commits 6+ mo) | ACTIVE (7000+ commits, YC-backed) | DEPRECATED (absorbed by Better Auth Sep 2025) |
| Express 5 Support | Untested, middleware-based | Official `toNodeHandler` helper | `@auth/express` EXPERIMENTAL |
| TypeScript | Via @types/passport | Native TS-first | Yes |
| OAuth Providers | 500+ strategies | Google, GitHub, + more built-in | Similar to Better Auth |
| PostgreSQL Support | Via express-session + connect-pg-simple | Native (pg Pool direct) | Via adapters |

**Sources:**

- Snyk: passport maintenance "Inactive", no commits 6+ months — [snyk.io](https://security.snyk.io/package/npm/passport)
- npm: passport 0.7.0 published Nov 2023 — [npmjs.com](https://www.npmjs.com/package/passport)
- YC Launch: Better Auth 13K+ stars, 350K+ monthly downloads — [ycombinator.com](https://www.ycombinator.com/launches/NUm-better-auth-the-authentication-framework-for-typescript)
- npmx: Better Auth 28.8K stars, latest 1.6.19 — [npmx.dev](https://npmx.dev/package/better-auth)
- Auth.js official: "The Auth.js project is now part of Better Auth" — [authjs.dev](https://authjs.dev)
- LogRocket 2026: "Better Auth is the strongest default for new self-hosted projects" — [blog.logrocket.com](https://blog.logrocket.com/best-auth-library-nextjs-2026)

### Method 2: Documentation vs Reality Check

**Passport.js:**

- Docs claim: Simple, unobtrusive, 500+ strategies
- Reality: GitHub issue #748 (2022) — community raised maintenance concerns, still open
- Reality: TypeScript types return `any` — StackOverflow reports `no-unsafe-argument` ESLint errors
- Reality: No Express 5 documentation or testing
- Reality: Session management requires separate `express-session` middleware

**Better Auth:**

- Docs claim: Express integration with `toNodeHandler`, PostgreSQL native
- Reality: Official Express integration exists with v4/v5 route distinction (`/api/auth/` vs `/api/auth/splat`)
- Reality: June 2026 security patches (CVE-2026-45337, CVE-2026-41427, etc.) — active security response
- Reality: GitHub issue #1418 — date handling issues with PostgreSQL/Supabase
- Reality: StackOverflow — developers confused about Express integration patterns
- Reality: WorkOS (2026): "does not yet have years of production battle-testing or third-party security audits"

**Auth.js:**

- Docs claim: Express support via `@auth/express`
- Reality: `@auth/express` explicitly marked as EXPERIMENTAL on authjs.dev
- Reality: Official recommendation: "we strongly recommend new projects to start with Better Auth"
- Reality: Now in security-patch-only mode

**Sources:**

- Passport GitHub issue #748 — [github.com](https://github.com/jaredhanson/passport/issues/748)
- Better Auth Express integration docs — [better-auth.com](https://better-auth.com/docs/integrations/express)
- Better Auth security update June 2026 — [better-auth.com](https://better-auth.com/blog/security-update-june-2026)
- Auth.js Express reference — [authjs.dev](https://authjs.dev/reference/express)
- WorkOS Node.js auth guide 2026 — [workos.com](https://workos.com/blog/nodejs-authentication-guide-2026)

### Method 3: Falsification (Adversarial)

**Evidence AGAINST the assumption:**

| Counter-evidence | Severity | Source |
|-----------------|----------|--------|
| Passport.js is effectively abandoned — no commits 6+ months, Snyk rates "Inactive" | HIGH | Snyk |
| Better Auth has no third-party security audits | MEDIUM | WorkOS 2026 |
| Better Auth date handling issues with PostgreSQL | LOW | GitHub #1418 |
| `@auth/express` is EXPERIMENTAL — not production-ready | HIGH | authjs.dev |
| Better Auth creates its own tables (`user`, `session`, `account`, `verification`) — Camel already has `users` and `sessions` tables with different schema | HIGH | better-auth.com + camel schema.sql |
| Express 5 route syntax difference (`/api/auth/splat`) may conflict with Camel's router | MEDIUM | better-auth.com Express docs |
| Auth.js absorbed into Better Auth — betting on Auth.js means betting on deprecated library | HIGH | authjs.dev, GitHub discussions |

**Evidence FOR the assumption:**

| Supporting evidence | Strength | Source |
|--------------------|----------|--------|
| Better Auth has official Express integration with `toNodeHandler` | Strong | better-auth.com |
| Better Auth supports PostgreSQL natively via `pg.Pool` | Strong | better-auth.com |
| Better Auth supports email/password AND social providers in one config | Strong | better-auth.com |
| Better Auth can use custom password hashing (bcrypt compatible) | Medium | better-auth.com docs |
| Better Auth is actively maintained with security patches | Strong | June 2026 CVEs |
| Better Auth recommended by Next.js, Nuxt, Astro | Medium | YC launch |

**Sources:**

- Better Auth PostgreSQL adapter — [better-auth.com](https://better-auth.com/docs/adapters/postgresql)
- Better Auth Express integration — [better-auth.com](https://better-auth.com/docs/integrations/express)
- Express 5 migration guide — [expressjs.com](https://expressjs.com/en/guide/migrating-5)
- Camel schema.sql — `server/src/db/schema.sql`

## Curation notes

**Strongest support:**

- Better Auth is clearly the leading open-source auth library for TypeScript in 2026
- Active maintenance with security patches, YC backing, framework endorsements
- Official Express integration exists

**Strongest counter-evidence:**

- Passport.js is effectively dead for new projects
- Better Auth creates its own database schema — Camel's existing `users`/`sessions` tables are incompatible
- No evidence Better Auth can coexist with existing username/password auth without migration
- `@auth/express` is experimental — Auth.js is not a viable alternative

**Remaining gaps (from advisor):**

1. Schema compatibility unverified — can Better Auth use Camel's existing tables?
2. Coexistence model unverified — can OAuth be added alongside existing auth?
3. Express 5 route syntax compatibility unverified with Camel's router setup
4. Effort estimation missing — no data on implementation complexity

**Curation method:** Advisor tool (full conversation forwarded)

## Verdict & reasoning

**Verdict: Inconclusive** (confidence: medium)

The evidence strongly supports that **Better Auth is the clear winner** among OAuth libraries for Express + TypeScript + PostgreSQL in 2026. Passport.js is effectively abandoned, Auth.js is deprecated, and Better Auth is the actively maintained successor endorsed by the ecosystem.

However, the assumption bundles three claims, and only the first (library exists and is mature) is confirmed. The second claim (non-disruptive integration alongside existing auth) is **unverified** — Better Auth creates its own schema that conflicts with Camel's existing `users`/`sessions` tables, and there's no evidence of a coexistence model. The third claim (meaningful value) is supported but depends on whether integration can be done without breaking existing users.

The verdict cannot be "Confirmed" because the integration sub-claim has zero direct evidence and likely requires significant migration work.

## Recommendation (non-binding)

**Adopt Better Auth as the OAuth library**, but with these caveats:

1. **Library choice: Better Auth** — clear winner, no contest. Don't consider Passport.js (abandoned) or Auth.js (deprecated).

2. **Integration strategy requires investigation** before committing:
   - Run a Technical Spike to verify Better Auth works with Camel's Express 5 setup
   - Investigate whether Better Auth's adapter can be configured to use Camel's existing `users`/`sessions` tables
   - If not, plan a schema migration that preserves existing users

3. **Phased approach recommended:**
   - Phase 1: Add Better Auth alongside existing auth (Google/GitHub SSO only)
   - Phase 2: Migrate existing users to Better Auth's session model
   - Phase 3: Deprecate custom auth endpoints

4. **Alternative if schema migration is too risky:** Use Passport.js for OAuth only (passport-google-oauth20, passport-github2) while keeping existing auth for password login. This is lower risk but bets on an abandoned library.

## Technical Spike (2026-06-21)

### Setup

- Minimal Express 5 + Better Auth + PostgreSQL spike in `/tmp/better-auth-spike`
- Connected to Camel's actual database (`postgres://camel:camel@localhost:5432/camel_kanban`)
- Tested with `better-auth@1.6.19`, `express@5.1.0`, `pg@8.13.1`

### Results

| Test | Result | Details |
|------|--------|--------|
| TypeScript compilation | ✅ PASS | No errors, all imports resolve correctly |
| Express 5 + `toNodeHandler` | ✅ PASS | Server starts, routes mount correctly |
| PostgreSQL pool connection | ✅ PASS | `pg.Pool` connects to Camel's database |
| Custom table name (`modelName: "users"`) | ✅ PASS | Better Auth queries `users` table instead of `user` |
| Field mapping (`name` → `displayName`) | ⚠️ PARTIAL | Works for SELECT, but INSERT still uses mapped column name |
| **ID type compatibility** | ❌ **FAIL** | `invalid input syntax for type integer: "EHGSjgi6aAkukKJorVGB9blooNMHlRE0"` |

### Critical Finding: Schema Fundamental Incompatibility

**Better Auth generates nanoid string IDs** (`"EHGSjgi6aAkukKJorVGB9blooNMHlRE0"`) but **Camel's `users.id` is `integer` (serial)**. This is a hard blocker — cannot be resolved with field mapping or `modelName` configuration.

**Full schema comparison:**

| Column | Camel `users` | Better Auth expects | Compatible? |
|--------|---------------|---------------------|-------------|
| ID | `integer` (serial) | `string` (nanoid) | ❌ **HARD BLOCKER** |
| Login | `username` (unique) | `email` (unique) | ⚠️ Can add column |
| Display | `display_name` | `name` | ✅ Field mapping works |
| Password | `password_hash` (in `users`) | In `account` table | ⚠️ Different model |
| Email verified | ❌ tidak ada | `emailVerified` (boolean) | ⚠️ Can add column |
| Image | ❌ tidak ada | `image` (string) | ⚠️ Can add column |
| Updated | ❌ tidak ada | `updatedAt` (Date) | ⚠️ Can add column |

**What works:**

- Express 5 integration (`toNodeHandler`) — confirmed working
- PostgreSQL native support (`pg.Pool`) — confirmed working
- Custom table names (`modelName`) — confirmed working
- Bcrypt password hashing — configurable

**What doesn't work:**

- Integer ID type — Better Auth hardcodes nanoid/UUID generation
- Existing `sessions` table schema — Better Auth expects different columns
- Coexistence model — Better Auth manages its own session cookies

### Implications

**Option A: Full migration to Better Auth**

- Change `users.id` from `integer` to `text` (breaks all foreign keys: `workspace_members`, `card_events`, `agent_boards`, etc.)
- Rename/add columns to match Better Auth schema
- Migrate existing password hashes to `account` table
- **Risk: HIGH** — massive schema change, all existing data affected

**Option B: Dual auth system**

- Create new Better Auth tables (`user`, `session`, `account`, `verification`) alongside existing tables
- Use Better Auth only for new OAuth users
- Keep existing auth for password login
- **Risk: MEDIUM** — two auth systems to maintain, session cookie conflict

**Option C: Passport.js for OAuth only**

- Use `passport-google-oauth20` + `passport-github2` for SSO only
- Keep existing auth system untouched
- **Risk: LOW** — minimal changes, but bets on abandoned library

### Spike code

- Location: `/tmp/better-auth-spike/` (ephemeral, will be cleaned up)
- Config: `src/auth.ts` with `modelName`, `fields`, bcrypt password hashing
- Server: `src/index.ts` with Express 5 + `toNodeHandler`

---

## What would change this verdict

- **To Confirmed:** Run a Technical Spike proving Better Auth can coexist with Camel's existing auth (custom adapter for existing `users`/`sessions` tables, same cookie name, no breaking changes)
- **To Refuted:** Discover that Better Auth's schema requirements are non-negotiable and migration would break existing users, OR that Express 5 compatibility is fundamentally broken → **Technical Spike confirmed this: ID type mismatch is a hard blocker**
- **To Confirmed (alternative):** If the maintainer decides schema migration is acceptable, the verdict flips to Confirmed based on library maturity evidence alone
