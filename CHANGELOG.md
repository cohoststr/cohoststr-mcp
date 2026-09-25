# Changelog

## 0.13.2 (2026-09-25)
- Guesty key location corrected to Integrations > Developer tools > OAuth applications (Guesty quick-start guide). Plan note: Open API needs Guesty Pro or Enterprise.
- README: Claude Code install uses `claude mcp add`; Claude Desktop manual path is Settings > Developer > Edit Config.
- setup prints the saved path with ~ for your home folder.

## 0.13.1 (2026-09-25)
- The command-line tool is now `cohoststr-cli` (was `guesty-cli`). No alias is kept.

## 0.13.0 (2026-09-25)
- New: `npx cohoststr-mcp setup` asks for your Guesty credentials in a hidden prompt and writes Claude Desktop's config for you (backup first, other servers kept, file readable by your account only). Nothing you type is printed.

All notable changes to cohoststr-mcp will be documented in this file.

## [0.12.0] - 2026-09-24

### Changed
- Renamed to **CohostSTR**. The npm package is now `cohoststr-mcp` (`guesty-mcp-server` stays on npm for existing installs). Registry name `io.github.cohoststr/cohoststr-mcp`.
- IoT webhook header is now `x-cohoststr-webhook-signature`; default local data paths moved to `~/.cohoststr/`.

### Removed
- The hosted-service code (`src/hosted.js`, `src/hosted/`) is no longer part of this package; the hosted service is maintained separately. The free server is unchanged.

## [0.11.2] - 2026-09-24

### Changed
- LICENSE copyright and package author are now "guesty-mcp-server authors".
- README describes the free server only: hosted-version and sign-up promo lines removed; maker line is product-neutral.

## [0.11.1] - 2026-09-24

### Changed
- README: the maker line no longer links a rental brand; claims are brought in line with the facts ("open-source, write-capable" rather than "first"; production use is described without a property count; the hosted version is described as early access, not beta); the tool count reads "43 Guesty tools" everywhere (the 44th registered tool, `get_license_info`, does not touch Guesty).
- server.json registry description updated to match; it names only features in the free server.

## [0.11.0] - 2026-09-24

### Added
- **`draft_guest_reply`** — gathers what an agent needs to answer a guest accurately: the recent thread, the reservation, and the listing's real check-in/out times, access notes and house rules. Facts Guesty does not hold are marked `unknown - do not guess`. It sends nothing.
- **Channel-policy screen on `send_guest_message`.** A message containing an email address, a phone number, off-platform payment (Zelle, Venmo, PayPal…) or a "book direct" invitation is held with an explanation, because Airbnb, Vrbo and Booking.com can suspend a listing for it. `allowPolicyRisk: true` sends it anyway (direct bookings).
- **Guesty token protection.** Access tokens are persisted (local: `~/.guesty-mcp/tokens.json`, mode 0600; hosted: encrypted) and reused across restarts, token requests are counted per client over a rolling 24h and refused past `GUESTY_TOKEN_BUDGET` (default 4, one under Guesty's cap), and a 401 triggers exactly one refresh. Set `GUESTY_TOKEN_CACHE_FILE=off` to keep tokens in memory only.
- Hosted service (Guesty Copilot): one-step **`undo_change`** for listing, pricing and reservation edits (restores only the fields the change touched; previews say plainly when an action cannot be undone); **write safety** (identical writes within 10 minutes are not repeated, calendar and nightly-price changes refuse booked nights and refuse when the calendar cannot be read, and every such change is re-read to confirm Guesty shows it); **`bulk_update_calendar`** with a per-listing preview, booked listings skipped, stop at the first failure.

### Fixed
- **`get_conversations` returned zero conversations for every account.** The communication API wraps its payload as `{ status, data: { conversations } }`; the tool read `.results`. Measured against a live account 2026-09-24: 0 before, 3 of 3 after. Guest name and reservation now come from `meta`.
- **The `guesty://` message-thread resource called `/messages`, which is not a Guesty route (404).** It now reads `/posts`.

## [0.10.2] - 2026-09-02

### Fixed
- **`get_reviews`: Booking.com reviews came back with `rating: null` and an empty comment on 0.10.1.** Booking.com rows carry `scoring.review_score` (1–10) and `content.{headline, positive, negative}` instead of Airbnb's `overall_rating` / `public_review`. Measured live: 15 of 100 rows on our account. Rows now include `ratingScale` (5 or 10) so an agent never averages the two channels as if they were the same scale, plus `reviewerName` and `hostReply`.

### Added
- `.github/workflows/publish-mcp-registry.yml` — every GitHub release republishes `server.json` to the official MCP registry via OIDC (the registry had been stuck at 0.6.0 because a `server.json` bump in git publishes nothing).

## [0.10.1] - 2026-09-02

### Fixed
- **`get_reviews` returned `[]` for every caller since launch (issue #2).** Guesty's `/v1/reviews` responds `{ data: [...], limit, skip }` with the review text and ratings under `rawReview` (channel-native names: `public_review`, `overall_rating`, `private_feedback`, `reviewer_role`, `category_ratings*`). The tool read `data.results` and `r.rating` / `r.comment`, none of which exist. Measured live on 2026-09-02: 100 rows on a 10-listing account, `listingId` filter honoured server-side, bogus `listingId` returns 0. The reporter's multi-unit hypothesis was a red herring — the bug was universal. Response now returns `returned`, `limit`, `skip` and rows with `rating`, `comment`, `privateFeedback`, `categoryRatings`, `channel`, `reviewerRole`, `listingId`, `reservationId`, `guestId`, `hidden`, `submittedAt`, `date`.
- **`get_calendar_blocks` now reports WHY a day is blocked (issue #4).** Each blocked day carries `blockTypes` (Guesty's true `blocks` flags — `m` manual, `o` owner, `b` booking, `r` reserved, plus the remaining Guesty flags passed through under their own keys), a human `blockReason`, `reservationId`, and summarised `blockRefs` (type, dates, reservation code, source). A `blockTypeLegend` is included in every response so an agent never has to guess a key.

### Tests
- `tests/test-shapes.mjs` exercises both mappers against the live-measured payloads, including a control that shows the pre-fix field reads are `undefined` on a real review row.

## [0.10.0] - 2026-09-02

### Changed
- **All 43 tools are now free. No license key, no paid tier.** For about four months 19 of the 43 registered tools (15 write/guest-messaging tools and the 4 IoT/property-health tools) were gated behind Pro and Enterprise tiers that could not be purchased, so every call to them returned `isError` — to everyone, always. Advertising tools that error is worse than not charging for them. The gate is now open by a single policy constant, `ALL_TOOLS_FREE` in `src/license.js`, and the tier ledgers are kept as named lists so the policy can be reversed in one line if a paid tier is ever actually wired.
- **`enterpriseGated` in `src/iot-tools.js` no longer carries its own tier check.** It defers to `isToolAllowed()` in `license.js`, the same gate every other tool uses. Two copies of one policy is how the 0.9.7 defect (a remedy the kill-switch disabled) shipped in the first place.
- **The registered-tool count is derived, not typed.** `TOTAL_TOOLS` is now the sum of the four ledgers, and `tests/test-remote-toolsync.mjs` asserts the union of those ledgers equals the live `server.tool()` registration census in both directions. A tool registered without a ledger entry fails the build instead of going off-census.
- **`get_license_info`** now reports `allToolsFree`, `licenseRequired: false` and `gatedToolCount: 0`; the `upgradeUrl` field (which pointed at a pricing page with nothing to buy) is replaced by `website`.
- README, `package.json`, `server.json` and the remote `SERVER_INFO` description all say the same thing: 43 registered, all free, 42 of them Guesty tools. The IoT/property-health section now says what those tools do with no devices configured (empty lists and null signals, not errors) instead of calling them unlockable.

### Tests
- `tests/test-enterprise.js` exercises **both arms** of `ALL_TOOLS_FREE` through the new pure `isToolAllowedAt(tier, tool, allToolsFree)`: the closed arm must still refuse a write at the free tier and an IoT tool at Pro, or the open arm's pass is uninterpretable. The live handlers are then called at the free tier and must run (no `isError`).

## [0.9.10] - 2026-08-06

### Fixed
- **Every published version since 0.9.1 told MCP clients it was 0.9.1.** `serverInfo.version` in the `initialize` handshake was a hardcoded string literal in `src/server.js`, last updated at 0.9.1 and untouched through eight subsequent releases. Any client that reads the version it is handed — for compatibility checks, for bug reports, for telemetry — has been reading a number that stopped moving. `package.json` was correct the whole time, which is precisely why nobody noticed: **the surface that was right is the surface everybody looks at.**
- **The only reason this was caught is that a control FAILED TO DISCRIMINATE.** A live handshake against the published 0.9.9 tarball answered `0.9.1`. The obvious conclusion was "the publish is stale". The control — the same handshake against the published **0.9.6** tarball — answered **`0.9.1` as well**. Two known-different inputs producing an identical output is not a passing test; it is a finding. Had the control discriminated, the wrong cause would have been chased and the real one would still be shipping.
- **Fixed as a derived value, not as a corrected literal.** Re-typing `0.9.10` into `src/server.js` would have reproduced the defect on the next release and every release after it. The version is now read from `package.json` via `createRequire`, with a `try/catch` so a packaging accident degrades the version string instead of killing the server at boot. **A hand-typed number is a promise to update it by hand forever.**
- **`src/health.js` carried the same defect one generation deeper** — `version: "0.2.0"` and `toolCount: 15`, both frozen, both wrong. Version is now derived; `toolCount` was **deleted rather than corrected**, because a health endpoint has no business restating a figure that is authoritative elsewhere, and a number with no owner is exactly the thing that goes stale. This module has zero importers today (verified by grep, with a positive control on `license.js` returning four real consumers) — but **dead code still ships, so its claims are still readable, and dead code is not exempt from being true.**
- **`src/http-server.js` already derived its version from `package.json` and said so in a pin-comment.** The codebase held both the fix and the defect side by side. Finding one instance is not finishing: **after fixing an instance, grep for the class.**

## [0.9.9] - 2026-08-06

### Fixed
- **Every published version through 0.9.8 shipped a 369 KB image that nothing references.** `hero.png` was 369,469 of 542,363 unpacked bytes — **68% of every install** — and is referenced by zero files in the repo (grep across `.js`/`.json`/`.md`/`.html` outside `node_modules`, with a positive control that returned three real files). An MCP stdio server renders nothing and needs no artwork. Tarball is now 24 files / 172,894 bytes unpacked / 46 KB packed, down from 25 / 542,363 / 369 KB.
- **This was the uncaught half of the 0.9.8 fix, and the miss matters more than the bytes.** 0.9.8 closed the `.gitignore` / `.npmignore` divergence in one direction, and its commit message stated the principle: *".npmignore gets no vote on what git publishes."* The converse is exactly as true and went unchecked — **`.gitignore` gets no vote on what npm publishes.** `hero.png` had never been git-tracked, so the `.gitignore` line added for it changed nothing; the tarball was the only surface it was ever on, and the tarball is the surface that was not audited. **Fixing a source and assuming the sibling followed is the defect — not forgetting a pattern.** `.npmignore` now excludes binary asset extensions as a class, with the reasoning recorded inline.

## [0.9.8] - 2026-08-06

### Fixed
- **The paid-tier refusal message named a version and a date that had gone stale in front of customers.** A user supplying a `gmcp_pro_*` / `gmcp_biz_*` / `gmcp_ent_*` key was told paid tiers arrive "at v1.0 next week" with "Stripe-backed activation". That text was written 2026-05-21; by 2026-08-06 the package was at 0.9.7 and "next week" was ~11 weeks past. **The defect was not that the copy was wrong when written — it was that it carried dated promises that decayed into a false statement while sitting perfectly still.** The replacement names no version, no date, no payment vendor and no key format, so it cannot go stale on its own.
- **The README instructed Enterprise-tier readers to set `GUESTY_MCP_LICENSE_KEY` to a `gmcp_ent_*` key.** The kill-switch guarantees that key is refused, so the documented remedy could not work. The same defect was removed from the tool-gate messages in 0.9.7 and survived in the shipped docs. It now states plainly that paid tiers are not yet available.
- **The README's Enterprise table listed 3 of the 4 Enterprise tools** — `get_readiness_score` was missing, while the prose two lines above it and `ENT_TOOLS` in code both say 4.
- README no longer quotes the refusal string byte-for-byte. **A paraphrase cannot be falsified by a copy edit; a verbatim quote can — and that coupling is exactly what broke this file.**

## [0.9.7] - 2026-08-06

### Changed
- **Delisted the `remotes` entry from the MCP registry record.** It had advertised a remote endpoint since 0.6.0, and four of the five versions carrying it (0.6.0, 0.7.0, 0.8.1, 0.8.2) published the bare origin with no `/mcp` path — POSTing `initialize` there returns an HTML error page, while a control GET returns JSON, so the failure is verb-specific rather than the host being down. **Four published versions pointed at a URL that could not complete a handshake.** 0.9.6 was the first whose remote answered `initialize` correctly, but it still executes no tools. npm discovery is unaffected and always was: `packages[]` carries the npm entry on every published row independently of `remotes`. Registry rows are per-version and immutable, so removing the entry required a publish rather than an edit. The endpoint itself stays up.

### Fixed
- **The remote advertised a tool list that was 31 names wrong.** Added `tests/test-remote-toolsync.mjs`, which extracts every real registration across the source files and fails if the advertised set and the registered set diverge in either direction — including a control that injects a divergence, so a pass is interpretable rather than decorative.
- **The Enterprise tool gate prescribed a remedy the kill-switch disables** — it told the caller to set an Enterprise key that would then be refused.

## [0.9.6] - 2026-08-06

### Fixed
- **`get_calendar` returned `days: []` and `get_calendar_blocks` returned `blockedDays: []` for every listing and every date range.** Guesty's `/v1/listings/{id}/calendar` returns a **bare top-level array**; both tools read `data.days`, which does not exist. `get_calendar`'s guard made this invisible — it tested `(data.days || data || []).map` (truthy on a bare array, so the guard passed) and then mapped `(data.days || [])` (empty). **The guard and the body evaluated different expressions, so the check reported healthy on exactly the input that defeated it.** Measured live against `open-api.guesty.com` on 2026-08-06: the old expression yields 0 rows where the API returned 4.
- All three calendar call sites now route through one `normalizeCalendarDays()` helper handling bare-array / `days` / `data` / `results`. **It throws on an unrecognised shape by design:** for `get_calendar_blocks` an empty list does not read as "no data", it reads as "nothing is blocked" — i.e. *the unit is free* — and a false "free" on an occupied unit is a double-booking. `get_calendar_availability` keeps its deliberate reservation-derived fallback via `{ strict: false }`, which still announces the unknown shape on stderr rather than swallowing it.
- **Root cause worth naming:** the correct normalizer already existed inline at `get_calendar_availability`, shipped in 0.9.1 (see the Issue #1 entry below) and was never propagated to its two siblings. The broken sites shipped in every release through 0.9.5.

### Security / packaging
- **Removed two editor backup files that were being published to the public registry.** `README.md.pre-ipstrip-listings-*` and `README.md.pre-v095-lock-*` shipped inside the 0.9.5 tarball. **npm force-includes any package-root file whose name begins with `README` or `LICENSE` — `.npmignore` gets no vote on those names** (measured on npm 11.11.0; the force-include is root-only, so a copy in a subdirectory *is* excluded). The existing `*.pre-*` ignore rule was never broken, only unreachable for that one name shape. No credentials or private hosts were exposed; the content was pre-edit marketing copy carrying a download-count claim that had been deliberately removed from the shipped README.
- Added a `prepack` guard that aborts the publish and names any offending file, so this cannot recur silently. Editor backups now live in `_backups/`.

## [0.9.1] - 2026-04-22

### Fixed
- **Issue #1** — `get_reservations`, `get_revenue_summary`, `get_financials`, and `get_owner_statements` silently ignored `checkInFrom`/`checkInTo`/`from`/`to` date params, returning only upcoming reservations regardless of the requested window. Root cause: `checkIn[$gte]` / `checkIn[$lte]` bracket-style query params are not honored by the Guesty Open API v1. New `buildReservationFilters()` helper emits the correct `filters=[{field, operator, from, to}]` JSON-array shape and moves `listingId` + `status` inside the array so they survive alongside date windows. No `context:"now"` scoping (the original upcoming-only culprit).
- **Issue #1** — `get_listing_occupancy` returned `totalDays: 0` because the calendar response shape wasn't mapped defensively. Now normalizes across `days` / `data` / `results` / bare-array variants, and falls back to a reservation-derived occupancy calculation when the calendar endpoint returns no per-day rows.

### Added
- MCP Resources primitive — 7 addressable `guesty://` templates (listing, reservation, review, guest, thread, report-revenue, listing-tasks) wired via `src/resources.js`. Capabilities now advertise `tools` + `resources` (server-side half of the 0.9.0 ship that was deployed 2026-04-20 but not previously committed).
- `tests/test-issue-1-filters.mjs` — 8-case offline regression covering filter-builder output for historical windows, listing scoping, checkout bounds, and `context:"now"` leak detection.

## [0.8.2] - 2026-04-19

### Fixed
- npm description synced to "43 production tools" (was stale at "38 tools" on npm page)
- Removed `claude-code` and `openclaw` from npm keywords (AI-disclosure hygiene)
- Added `iot` and `enterprise` keywords for discoverability

## [0.8.1] - 2026-04-19

### Fixed
- Added `.npmignore` to exclude token files, tests, and non-essential markdown from npm package
- Added `.mcpregistry_*` patterns to `.gitignore` (credential hygiene)
- Package size reduced from 42.3kB to 35.0kB (26→23 files)

## [0.8.0] - 2026-04-17

### Changed — Enterprise Tier MVP Merge (Owner-approved option-c path, msg 6406)
- Enterprise aggregators (`get_property_health`, `submit_checkout_photos`,
  `get_maintenance_alerts`) now layer Guesty-side data (reservation status,
  review score, last-clean timestamp) on top of IoT helpers. Single-call
  snapshots for ops dashboards.
- IoT-only handlers extracted from `iot-tools.js` to internal async helpers
  (`getIoTPropertyHealth`, `submitIoTCheckoutPhotos`, `getIoTMaintenanceAlerts`);
  canonical MCP tool registration moved to `enterprise-tools.js`.
- Graceful degradation: Guesty sub-fetch failures degrade to null value +
  per-field error note (aggregator still returns IoT data).
- `iot-tools.js` retains single MCP registration for `get_readiness_score`.
- Tool count reconciled across README + license.js + package.json + server.json
  to 43 total (39 Guesty + 1 IoT + 3 Enterprise aggregators). Previous 3-way
  drift (README:38, license.js:38, actual registrations:43) resolved.

### Added
- `__handlers` export on `enterprise-tools.js` for direct smoke-test invocation
  (renamed from legacy `__stubs` — real handlers, not stubs, post-merge).
- `tests/test-enterprise.js` rewritten: exports + free-tier-gate + enterprise-lift
  smoke tests. Dynamic import + env-stub so test runs without real Guesty creds.

### Fixed
- `package.json` test script referenced non-existent `tests/test-tools.js`.
  Now runs `tests/test-enterprise.js && tests/test-iot.js`.

## [0.7.0] - 2026-04-15

### Added
- **IoT/Property Health Monitoring** (Enterprise tier)
  - `get_property_health` — Real-time device status for any property
  - `submit_checkout_photos` — Photo submission for post-checkout analysis
  - `get_maintenance_alerts` — Active IoT alerts filtered by property/severity
  - `get_readiness_score` — 0-100 Physical Readiness Score with 6 weighted checks
- **IoT Webhook Receiver** (`POST /webhooks/iot`)
  - Supports Tuya, Google Nest, SmartThings, and generic payloads
  - Auto-normalizes all formats to standard schema
  - Auto-creates alerts for out-of-range readings
- **IoT Data Layer** (`iot-db.js`)
  - Zero-dependency JSON file store for devices, readings, alerts, baselines
  - Auto-pruning at 50K readings and 10K alerts
- Tool count: 38 → 42 (4 new Enterprise-tier tools)

## [0.6.0] - 2026-04-10

### Added
- **License tier gating** — 3-tier monetization (Free/Pro/Business/Enterprise)
  - 23 free tools (read-only operations)
  - 15 gated tools (write operations, messaging, webhooks)
  - License key validation via `GUESTY_MCP_LICENSE_KEY` env var
- **MCP annotations** on all 38 tools (`readOnlyHint`, `destructiveHint`)
- **Enhanced rate limiting** with exponential backoff and retry-after header support
- Streamable HTTP remote endpoint via Vercel deployment
- License key environment variable documented in server.json

### Changed
- Upgraded from v0.5.0 monetization foundation to production-ready gating
- Improved server.json with full environment variable documentation
- Version bumped across all entry points (server.js, http-server.js, cli.js)

## [0.5.0] - 2026-04-07

### Added
- License tier system (`src/license.js`) for Pro/Business/Enterprise gating
- MCP annotations on all 38 tools for better client-side filtering

## [0.4.3] - 2026-03-27

### Changed
- Updated package description to reflect full 38-tool capability
- Updated CHANGELOG with complete version history (v0.3.0–v0.4.2)

## [0.4.2] - 2026-03-27

### Fixed
- MCP Registry namespace case fix
- Added `.gitignore` entry for token files

## [0.4.1] - 2026-03-27

### Fixed
- Server.json description length exceeding MCP Registry limits

## [0.4.0] - 2026-03-27

### Added
- MCP Registry `server.json` and Smithery `smithery.yaml` config
- `mcpName` field in package.json for registry discovery
- Expanded from 29 to **38 tools**:
  - `get_reservation_financials` - Detailed financial breakdown per reservation
  - `get_reservation_notes` - Internal notes on reservations
  - `add_reservation_note` - Add notes to reservations
  - `get_listing_pricing` - Pricing rules and rate plans
  - `get_account_info` - Guesty account details
  - `create_webhook` - Register webhooks for real-time events
  - `delete_webhook` - Remove registered webhooks
  - `get_custom_fields` - Custom field definitions
  - `update_custom_fields` - Update custom field values
- Delete helper utility for webhook management
- Improved error handling across all tools

### Fixed
- 5 failing tools identified and fixed via E2E test against live Guesty API

## [0.3.0] - 2026-03-26

### Added
- Expanded from 15 to **29 tools**:
  - `get_photos` - Property photo URLs and metadata
  - `get_guest` - Guest profile details
  - `get_guests` - Search and list guests
  - `get_occupancy_stats` - Occupancy rates and statistics
  - `get_revenue_stats` - Revenue analytics and trends
  - And additional operational tools
- Docker support with `Dockerfile` and `docker-compose.yml`
- HTTP transport module for remote MCP access (non-stdio)
- Integration test suite (`tests/test-tools.js`) for all tools
- CLI tool (`guesty-cli`) for command-line usage
- Security guide (`SECURITY.md`)
- Health check endpoint for production monitoring
- Webhook handler module for real-time Guesty events (v3 prep)
- Multi-account design doc for v3 architecture
- GitHub Actions CI workflow
- Example configs for Claude Code and Docker Compose

## [0.2.0] - 2026-03-26

### Added
- `create_reservation` - Create direct bookings (website to Guesty)
- `get_reviews` - Fetch guest reviews from all channels
- `get_calendar` - Check availability and pricing by date range
- `update_calendar` - Block/unblock dates, set minimum nights
- `respond_to_review` - Post responses to guest reviews
- `get_owner_statements` - Owner revenue statements and reports
- `get_expenses` - Track operational expenses
- `get_channels` - List connected booking channels per property
- `get_tasks` - Fetch cleaning and maintenance tasks
- Rate limit retry with exponential backoff
- Token caching module

## [0.1.0] - 2026-03-26

### Added
- Initial release with 6 core tools
- `get_reservations` - Fetch reservations with date/listing/status filters
- `get_listing` - Get property details or list all properties
- `get_conversations` - Fetch guest message history
- `send_guest_message` - Send messages to guests in conversations
- `get_financials` - Revenue, payouts, and commission data
- `update_pricing` - Update base price or date-specific pricing
- OAuth2 authentication with automatic token refresh
- CONTRIBUTING.md for open source contributors
- MIT License
