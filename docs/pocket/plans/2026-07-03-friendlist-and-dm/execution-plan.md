# EXECUTION PLAN — Friendlist & Direct Messaging

**Date:** 2026-07-03
**Spec:** docs/pocket/spec/2026-07-03-friendlist-and-dm/friendlist-dm.md
**Status:** draft
**Total tasks:** 8
**GitHub Issue:** #86

---

## Execution Overview

### Recommended Order
```
T1 → T2, T4 (parallel) → T3, T5, T7 (parallel) → T6 → T8
```

> Dependency order above is **recommended** — pocket skill enforces actual
> parallelism and sequencing based on its routing logic.

### Parallelizable Groups
| Group | Tasks | Unblocked After |
|-------|-------|-----------------|
| Group A | T2, T4 | T1 completes |
| Group B | T3, T5, T7 | T2 + T4 complete |

### Constraints Reminder
**Architecture:** Kysely ORM, Express 5 (NodeNext ESM), React 18 + Vite + Tailwind v4. Socket.io only for DM (`/messages` namespace). SSE stays for notifications/board events. Redis adapter mandatory from day one. Biome lint. Conventional commits.

**Out-of-scope:** Group chat, file/image sharing, message editing/deletion, read receipts, typing indicators, notification push, notification page separation.

**Assumptions at risk:**
- Workspace member cap: not confirmed in spec (assumed exists, enforced in R7.6)
- Message max length: 4000 chars assumed
- Simultaneous friend request merge: DB unique constraint + upsert assumed

**Sequencing:** T1 is foundation (schema). T2 (friend API) and T4 (Socket.io setup) are independent after T1. T3 (friend UI) needs T2. T5 (DM API) needs T1 + T4. T7 (workspace integration) needs T2. T6 (inbox unification) needs T3 + T5. T8 (TTL cleanup) needs T5.

### File Structure Map

```
Rule: Friend system schema
  Modify: server/src/db/schema.sql
  Modify: server/src/db/types.ts (regenerated)

Rule: Friend request API
  Create: server/src/routes/friends.ts              (created by: T2)
  Modify: server/src/routes/helpers.ts              (add friendship helper)
  Test:   server/src/routes/friends.test.ts

Rule: Friend list UI
  Create: client/src/pages/FriendsPage.tsx           (created by: T3)
  Create: client/src/components/FriendRequestCard.tsx (created by: T3)
  Modify: client/src/api.ts                          (add friend endpoints)
  Modify: client/src/Router.tsx                      (add /friends route)
  Modify: client/src/components/Sidebar.tsx          (add Friends nav item)
  Test:   client/src/pages/FriendsPage.test.tsx

Rule: Socket.io setup
  Create: server/src/socket.ts                       (created by: T4)
  Modify: server/src/index.ts                        (attach Socket.io)
  Test:   server/src/socket.test.ts

Rule: Direct messages API
  Create: server/src/routes/messages.ts              (created by: T5)
  Create: server/src/messages/service.ts             (created by: T5)
  Test:   server/src/routes/messages.test.ts

Rule: Direct messages UI + Inbox unification
  Create: client/src/components/MessagesTab.tsx       (created by: T6)
  Create: client/src/components/ConversationView.tsx  (created by: T6)
  Create: client/src/hooks/useSocket.ts              (created by: T6)
  Modify: client/src/pages/InboxPage.tsx             (add tabs)
  Modify: client/src/api.ts                          (add message endpoints)
  Modify: client/src/context/NotificationsContext.tsx (unread count)
  Test:   client/src/pages/InboxPage.test.tsx

Rule: Workspace integration
  Modify: server/src/routes/members.ts               (add friend endpoint)
  Modify: client/src/pages/FriendsPage.tsx           (add workspace selector)
  Modify: client/src/api.ts                          (add workspace friend endpoint)
  Test:   server/src/routes/members.test.ts

Rule: Message TTL cleanup
  Create: server/src/messages/cleanup.ts             (created by: T8)
  Modify: server/src/notifications/scheduler.ts      (add cleanup job)
  Test:   server/src/messages/cleanup.test.ts
```

---

## Pocket Packets

---

### Task 1: Friend System Schema + Types [prereq]

## OBJECTIVE
Add `friends` and `direct_messages` tables to the database schema and regenerate Kysely types.

Files:
- Modify: `server/src/db/schema.sql`
- Modify: `server/src/db/types.ts` (regenerated)

Steps:
1. Add `friends` table to `server/src/db/schema.sql`:
   ```sql
   CREATE TABLE IF NOT EXISTS friends (
     id SERIAL PRIMARY KEY,
     requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined')),
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     UNIQUE(requester_id, addressee_id)
   );
   CREATE INDEX idx_friends_requester_status ON friends(requester_id, status);
   CREATE INDEX idx_friends_addressee_status ON friends(addressee_id, status);
   ```

2. Add `direct_messages` table to `server/src/db/schema.sql`:
   ```sql
   CREATE TABLE IF NOT EXISTS direct_messages (
     id SERIAL PRIMARY KEY,
     sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     content TEXT NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   );
   CREATE INDEX idx_dm_sender_recipient ON direct_messages(sender_id, recipient_id, created_at);
   CREATE INDEX idx_dm_recipient_sender ON direct_messages(recipient_id, sender_id, created_at);
   ```

3. Regenerate Kysely types:
   ```bash
   npx kysely-codegen --out-file server/src/db/types.ts
   ```
   Verify `DB` interface includes `friends` and `direct_messages` tables with correct column types.

4. Apply migration to local database:
   ```bash
   make db-migrate
   ```

5. Verify tables exist:
   ```bash
   psql $DATABASE_URL -c "\dt friends" && psql $DATABASE_URL -c "\dt direct_messages"
   ```

6. Commit:
   ```bash
   git add server/src/db/schema.sql server/src/db/types.ts
   git commit -m "chore(db): add friends and direct_messages tables"
   ```

## REFERENCES LOADED
docs/pocket/spec/2026-07-03-friendlist-and-dm/friendlist-dm.md — Data Model section
server/src/db/schema.sql — existing schema patterns (users, workspaces, workspace_members)
server/src/db/types.ts — Kysely type generation pattern

## WHY THIS APPROACH
Complexity: lightweight
Justification: Schema-first approach ensures all downstream tasks have typed DB access. Single migration file follows existing pattern (schema.sql applied via make db-migrate).

## SANDWICH CONTEXT
[CRITICAL: Schema changes must be additive only — no modifications to existing tables]
You are implementing database schema for Friendlist & DM feature.
Spec: docs/pocket/spec/2026-07-03-friendlist-and-dm/friendlist-dm.md
Design decision: New tables only, no changes to existing schema
Files in scope: server/src/db/schema.sql, server/src/db/types.ts
Available after: none (prereq)
Architecture rule: Kysely ORM, PostgreSQL 16, schema.sql + make db-migrate
[RESTATE: Schema changes must be additive only — no modifications to existing tables]

## DELIVERABLE
Given schema.sql is updated, When make db-migrate runs, Then friends and direct_messages tables exist with correct columns, constraints, and indexes
Given types.ts is regenerated, When importing DB type, Then friends and direct_messages are present in the DB interface
Given existing tables, When migration runs, Then no existing data is affected

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - friends table with requester_id, addressee_id, status, timestamps, unique constraint
  - direct_messages table with sender_id, recipient_id, content, created_at
  - Proper indexes for query patterns
  - Kysely types regenerated and verified
  - Migration applies cleanly via make db-migrate

Must-not-have:
  - Modifications to existing tables (users, workspaces, cards, etc.)
  - Data migration or backfill
  - Foreign key changes to existing tables

Open question risks:
  - None — schema is fully specified in spec

Rollback note:
  - DROP TABLE friends, direct_messages to rollback

## STOP CONDITIONS
Done when: tables exist in DB, types regenerated, migration applies cleanly
Uncertain when: kysely-codegen fails or produces incorrect types
Escalate when: migration conflicts with existing schema

---

### Task 2: Friend System Backend [depends: T1]

## OBJECTIVE
Implement friend request API: send, accept, decline, cancel, list friends, list incoming/outgoing requests. Include authorization checks and edge case handling.

Files:
- Create: `server/src/routes/friends.ts`
- Modify: `server/src/routes/helpers.ts` (add checkFriendship helper)
- Test: `server/src/routes/friends.test.ts`

Steps:
1. Write failing tests for friend request API:
   File: `server/src/routes/friends.test.ts`
   Tests verify:
   - POST /friends/request — send request by username (happy path)
   - POST /friends/request — cannot send to self
   - POST /friends/request — cannot send duplicate pending
   - POST /friends/request — re-request after decline (update row)
   - POST /friends/request — OAuth user without username rejected
   - POST /friends/request — non-existent user rejected
   - GET /friends — list accepted friends
   - GET /friends/requests/incoming — list pending incoming
   - GET /friends/requests/outgoing — list pending outgoing
   - POST /friends/:id/accept — accept request
   - POST /friends/:id/decline — decline request
   - DELETE /friends/:id — cancel pending request
   - DELETE /friends/:id — unfriend accepted (delete row)

2. Run tests — verify FAIL:
   ```bash
   npm run test -- server/src/routes/friends.test.ts
   ```
   Expected: all tests fail (routes don't exist yet)

3. Add `checkFriendship` helper to `server/src/routes/helpers.ts`:
   ```typescript
   export async function checkFriendship(
     db: Kysely<DB>,
     userId: number,
     friendId: number
   ): Promise<{ status: 'accepted' | 'pending' | 'declined' | 'none'; friendshipId: number | null }>
   ```

4. Create `server/src/routes/friends.ts`:
   - POST `/request` — find user by username, validate not self, check existing row (declined → update, none → insert, pending/accepted → reject)
   - GET `/` — list accepted friends (join users table for display_name, username, image)
   - GET `/requests/incoming` — list pending where addressee_id = current user
   - GET `/requests/outgoing` — list pending where requester_id = current user
   - POST `/:id/accept` — verify addressee, update status to accepted
   - POST `/:id/decline` — verify addressee, update status to declined
   - DELETE `/:id` — if pending + requester → delete (cancel); if accepted → delete (unfriend)

5. Run tests — verify PASS:
   ```bash
   npm run test -- server/src/routes/friends.test.ts
   ```
   Expected: all tests pass

6. Commit:
   ```bash
   git add server/src/routes/friends.ts server/src/routes/helpers.ts server/src/routes/friends.test.ts
   git commit -m "feat(friends): add friend request API with full CRUD"
   ```

## REFERENCES LOADED
docs/pocket/spec/2026-07-03-friendlist-and-dm/friendlist-dm.md — Stories 1-4, API Routes (Friends section)
server/src/routes/helpers.ts — existing helper patterns (checkWorkspaceMembership, checkWorkspaceCapacity)
server/src/routes/members.ts — route structure pattern
server/src/auth.ts — requireAuth middleware pattern

## WHY THIS APPROACH
Complexity: standard
Justification: Single route file per domain follows existing convention. Helper extraction keeps routes DRY. TDD ensures all edge cases are covered before implementation.

## SANDWICH CONTEXT
[CRITICAL: Friend request authorization — only requester can cancel, only addressee can accept/decline]
You are implementing friend system backend for Friendlist & DM.
Spec: docs/pocket/spec/2026-07-03-friendlist-and-dm/friendlist-dm.md
Design decision: Mutual confirmation model, row kept on decline (update to pending on re-request), delete on unfriend
Files in scope: server/src/routes/friends.ts, server/src/routes/helpers.ts, server/src/routes/friends.test.ts
Available after: T1 (schema)
Architecture rule: Express 5 routes, Kysely ORM, requireAuth middleware, conventional error objects { status, error }
[RESTATE: Friend request authorization — only requester can cancel, only addressee can accept/decline]

## DELIVERABLE
Given valid username, When POST /friends/request, Then pending friend request created
Given pending request, When POST /friends/:id/accept, Then status = "accepted" and both users see each other as friends
Given pending request, When POST /friends/:id/decline, Then status = "declined" (row kept)
Given declined request, When POST /friends/request again, Then row updated from "declined" to "pending"
Given OAuth user without username, When search, Then error "User has not set a username yet"
Given pending request from self, When DELETE /friends/:id, Then request deleted (cancel)
Given accepted friendship, When DELETE /friends/:id, Then row deleted (unfriend)
[must-not] Given non-addressee user, When accept/decline, Then error "Not authorized"

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - All 13 test scenarios passing
  - Authorization checks on every mutation endpoint
  - Re-request after decline updates existing row (no duplicate)
  - Unfriend deletes row (not soft delete)
  - OAuth user without username rejected with clear message

Must-not-have:
  - Modifications to existing route files (only helpers.ts addition)
  - Real-time notifications for friend requests (out of scope)
  - Group friendship (only 1-on-1)

Open question risks:
  - Simultaneous friend requests race condition → if DB unique constraint causes one to fail, handle gracefully with retry or merge

Rollback note:
  - Remove friends.ts route file and helpers addition

## STOP CONDITIONS
Done when: all tests pass, routes respond correctly, authorization enforced
Uncertain when: simultaneous request handling unclear
Escalate when: authorization logic cannot be implemented within existing middleware pattern

---

### Task 3: Friend System Frontend [depends: T2]

## OBJECTIVE
Build Friends page UI with friend list, incoming/outgoing request tabs, search, unfriend action, and add-to-workspace button (placeholder for T7 integration).

Files:
- Create: `client/src/pages/FriendsPage.tsx`
- Create: `client/src/components/FriendRequestCard.tsx`
- Modify: `client/src/api.ts` (add friend endpoints)
- Modify: `client/src/Router.tsx` (add /friends route)
- Modify: `client/src/components/Sidebar.tsx` (add Friends nav item)

Steps:
1. Write failing tests for FriendsPage:
   File: `client/src/pages/FriendsPage.test.tsx`
   Tests verify:
   - Renders friend list with display_name, username, avatar
   - Renders "Friends" tab (default) and "Requests" tab
   - Search filters friends by name/username
   - Empty state shown when no friends match search
   - Accept/decline buttons on incoming requests
   - Cancel button on outgoing requests
   - Unfriend action with confirmation

2. Run tests — verify FAIL:
   ```bash
   npm run test -- client/src/pages/FriendsPage.test.tsx
   ```
   Expected: tests fail (components don't exist yet)

3. Add friend API functions to `client/src/api.ts`:
   ```typescript
   export async function sendFriendRequest(username: string): Promise<...>
   export async function listFriends(): Promise<...>
   export async function listIncomingRequests(): Promise<...>
   export async function listOutgoingRequests(): Promise<...>
   export async function acceptFriendRequest(id: number): Promise<...>
   export async function declineFriendRequest(id: number): Promise<...>
   export async function cancelFriendRequest(id: number): Promise<...>
   export async function unfriend(id: number): Promise<...>
   ```

4. Create `client/src/components/FriendRequestCard.tsx`:
   - Display: avatar, display_name, username
   - Props: request data, type (incoming/outgoing), onAccept, onDecline, onCancel callbacks

5. Create `client/src/pages/FriendsPage.tsx`:
   - Tabs: "Friends" (default), "Requests"
   - Friends tab: search input + friend list + unfriend action + "Add to Workspace" button (opens selector, T7 integration point)
   - Requests tab: incoming (accept/decline) + outgoing (cancel)
   - Empty states for each tab

6. Update `client/src/Router.tsx` — add `/friends` route
7. Update `client/src/components/Sidebar.tsx` — add "Friends" nav item with icon (Users icon from lucide-react)

8. Run tests — verify PASS:
   ```bash
   npm run test -- client/src/pages/FriendsPage.test.tsx
   ```
   Expected: all tests pass

9. Commit:
   ```bash
   git add client/src/pages/FriendsPage.tsx client/src/components/FriendRequestCard.tsx \
           client/src/api.ts client/src/Router.tsx client/src/components/Sidebar.tsx \
           client/src/pages/FriendsPage.test.tsx
   git commit -m "feat(friends): add Friends page with list, requests, and search"
   ```

## REFERENCES LOADED
docs/pocket/spec/2026-07-03-friendlist-and-dm/friendlist-dm.md — Stories 1-4 (UI), Story 7 (workspace button placeholder)
client/src/pages/InboxPage.tsx — existing page pattern
client/src/components/Sidebar.tsx — navigation pattern
client/src/api.ts — API function pattern
client/src/Router.tsx — route definition pattern
docs/pocket/rule/creative-brief.md — UI design tokens (OKLCH colors, Work Sans typography)

## WHY THIS APPROACH
Complexity: standard
Justification: Separate Friends page follows existing page pattern. FriendRequestCard component keeps request rendering reusable. API layer separation matches existing convention.

## SANDWICH CONTEXT
[CRITICAL: Friends page must use design tokens from creative-brief.md — OKLCH colors, Work Sans font]
You are implementing friend system frontend for Friendlist & DM.
Spec: docs/pocket/spec/2026-07-03-friendlist-and-dm/friendlist-dm.md
Design decision: Separate page in sidebar, tabs for Friends/Requests
Files in scope: client/src/pages/FriendsPage.tsx, client/src/components/FriendRequestCard.tsx, client/src/api.ts, client/src/Router.tsx, client/src/components/Sidebar.tsx
Available after: T2 (friend API)
Architecture rule: React 18 + TypeScript, Tailwind CSS v4, lucide-react icons, Vite bundler resolution (no .js extensions)
[RESTATE: Friends page must use design tokens from creative-brief.md — OKLCH colors, Work Sans font]

## DELIVERABLE
Given user has friends, When open /friends, Then friend list displayed with name, username, avatar
Given user has incoming requests, When switch to Requests tab, Then accept/decline buttons shown
Given user has outgoing requests, When switch to Requests tab, Then cancel button shown
Given user searches for friend, When type query, Then list filtered by name/username
Given search returns no results, When view page, Then empty state "No friends found" shown
Given user clicks unfriend, When confirm, Then friend removed from list
[must-not] Given page renders, When view source, Then no .js extensions in imports (Vite bundler resolution)

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - All test scenarios passing
  - Design tokens from creative-brief.md applied
  - Empty states for all tabs
  - Search is client-side filter (friends already loaded)
  - "Add to Workspace" button present (opens selector, T7 integration)

Must-not-have:
  - Server-side search (fetch all friends, filter client-side)
  - Real-time updates on friend list (poll or manual refresh)
  - Modifications to files outside listed scope

Open question risks:
  - Creative-brief.md design tokens may not cover all needed values → use closest match, note in commit

Rollback note:
  - Remove FriendsPage.tsx, FriendRequestCard.tsx, revert Router/Sidebar/api changes

## STOP CONDITIONS
Done when: all tests pass, page renders correctly, design tokens applied
Uncertain when: design tokens unclear for specific components
Escalate when: creative-brief.md has no applicable tokens

---

### Task 4: Socket.io Setup [depends: T1]

## OBJECTIVE
Set up Socket.io server with `/messages` namespace, Redis adapter, cookie-based authentication middleware, and Express integration.

Files:
- Create: `server/src/socket.ts`
- Modify: `server/src/index.ts` (attach Socket.io to HTTP server)
- Test: `server/src/socket.test.ts`

Steps:
1. Install dependencies:
   ```bash
   cd server && npm install socket.io @socket.io/redis-adapter
   cd ../client && npm install socket.io-client
   ```

2. Write failing tests for Socket.io setup:
   File: `server/src/socket.test.ts`
   Tests verify:
   - Socket.io server initializes on HTTP server
   - `/messages` namespace exists
   - Auth middleware rejects connection without valid session cookie
   - Auth middleware accepts connection with valid session cookie
   - Redis adapter is configured (mock Redis)

3. Create `server/src/socket.ts`:
   ```typescript
   import { Server } from "socket.io";
   import { createAdapter } from "@socket.io/redis-adapter";
   import { getRedisClient } from "./db/redis.js";
   import { parse } from "cookie";
   import { getSessionByToken } from "./auth.js";

   export function initSocketio(httpServer: HttpServer): Server {
     const io = new Server(httpServer, {
       cors: { origin: true, credentials: true },
       transports: ["websocket", "polling"],
     });

     // Redis adapter for horizontal scaling
     const pubClient = getRedisClient();
     const subClient = pubClient.duplicate();
     io.adapter(createAdapter(pubClient, subClient));

     // /messages namespace with auth
     const messagesNs = io.of("/messages");
     messagesNs.use(async (socket, next) => {
       try {
         const cookies = parse(socket.handshake.headers.cookie || "");
         const sessionToken = cookies["camel_session"];
         if (!sessionToken) return next(new Error("Authentication required"));
         const session = await getSessionByToken(sessionToken);
         if (!session) return next(new Error("Invalid session"));
         socket.data.userId = session.userId;
         next();
       } catch (err) {
         next(new Error("Authentication failed"));
       }
     });

     messagesNs.on("connection", (socket) => {
       // Join user's personal room for receiving messages
       socket.join(`user:${socket.data.userId}`);
       // Handlers registered in T5
     });

     return io;
   }
   ```

4. Update `server/src/index.ts`:
   - Import `initSocketio` from `./socket.js`
   - After HTTP server listen, call `initSocketio(httpServer)`

5. Run tests — verify FAIL:
   ```bash
   npm run test -- server/src/socket.test.ts
   ```
   Expected: tests fail (socket.ts doesn't exist yet)

6. Implement socket.ts and index.ts changes (Steps 3-4 above)

7. Run tests — verify PASS:
   ```bash
   npm run test -- server/src/socket.test.ts
   ```
   Expected: all tests pass

8. Commit:
   ```bash
   git add server/src/socket.ts server/src/index.ts server/src/socket.test.ts \
           server/package.json client/package.json server/package-lock.json client/package-lock.json
   git commit -m "feat(realtime): add Socket.io server with /messages namespace and Redis adapter"
   ```

## REFERENCES LOADED
docs/pocket/spec/2026-07-03-friendlist-and-dm/friendlist-dm.md — Design Decisions (Socket.io namespace, Redis adapter, fallback)
server/src/db/redis.ts — existing Redis client pattern (getRedisClient)
server/src/auth.ts — session validation (getSessionByToken or equivalent)
server/src/index.ts — Express server setup, HTTP server creation
Socket.io docs — server initialization, namespaces, Redis adapter, cookie auth middleware

## WHY THIS APPROACH
Complexity: standard
Justification: Socket.io setup is infrastructure work — isolated from business logic. Namespace isolation (/messages) keeps DM traffic separate. Redis adapter from day one enables horizontal scaling without refactor. Cookie-based auth reuses existing session system.

## SANDWICH CONTEXT
[CRITICAL: Socket.io must use /messages namespace only — never the default namespace]
You are implementing Socket.io infrastructure for Friendlist & DM.
Spec: docs/pocket/spec/2026-07-03-friendlist-and-dm/friendlist-dm.md
Design decision: Socket.io with /messages namespace, websocket→polling fallback, Redis adapter mandatory
Files in scope: server/src/socket.ts, server/src/index.ts, server/src/socket.test.ts
Available after: T1 (schema, for types)
Architecture rule: Express 5 + NodeNext ESM (.js extensions in imports), Redis adapter on existing Redis client
[RESTATE: Socket.io must use /messages namespace only — never the default namespace]

## DELIVERABLE
Given HTTP server starts, When Socket.io initializes, Then /messages namespace is available
Given valid session cookie, When connect to /messages, Then connection accepted and userId attached to socket
Given invalid/missing session cookie, When connect to /messages, Then connection rejected with "Authentication required"
Given Redis adapter configured, When multiple server instances run, Then messages propagate across instances
[must-not] Given Socket.io starts, When client connects to default namespace, Then connection should be handled (not our concern — only /messages is managed)

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - All test scenarios passing
  - /messages namespace isolated from default
  - Cookie-based auth using existing session system
  - Redis adapter configured with pub/sub clients
  - Transport order: websocket → polling

Must-not-have:
  - Event handlers for DM (added in T5)
  - Modifications to SSE system
  - Default namespace event handling
  - Socket.io for notifications or board events

Open question risks:
  - Redis client duplicate() method availability → if redis v6 doesn't support it, use createClient with same config

Rollback note:
  - Remove socket.ts, revert index.ts changes, uninstall socket.io packages

## STOP CONDITIONS
Done when: all tests pass, Socket.io starts with HTTP server, auth middleware works
Uncertain when: Redis adapter configuration unclear with existing redis v6 client
Escalate when: Express 5 HTTP server integration doesn't work with Socket.io

---

### Task 5: Direct Messages Backend [depends: T1, T4]

## OBJECTIVE
Implement DM API: send message, get conversation history, list conversations. Add Socket.io event handlers for real-time message delivery.

Files:
- Create: `server/src/routes/messages.ts`
- Create: `server/src/messages/service.ts`
- Test: `server/src/routes/messages.test.ts`

Steps:
1. Write failing tests for DM API:
   File: `server/src/routes/messages.test.ts`
   Tests verify:
   - POST /messages/:friendId — send message to friend (happy path)
   - POST /messages/:friendId — cannot send to non-friend
   - POST /messages/:friendId — cannot send after unfriend
   - GET /messages/:friendId — get conversation history with cursor pagination
   - GET /messages — list conversations (most recent first, last message preview)
   - POST /messages/:friendId — content validation (max 4000 chars, not empty)
   - Socket.io event: message delivered to recipient in real-time

2. Create `server/src/messages/service.ts`:
   ```typescript
   export async function sendMessage(db, senderId, recipientId, content): Promise<DirectMessage>
   export async function getConversation(db, userId, friendId, cursor?, limit?): Promise<DirectMessage[]>
   export async function listConversations(db, userId): Promise<ConversationPreview[]>
   ```
   - `sendMessage`: validate friendship exists and is "accepted", insert message
   - `getConversation`: query messages between two users, cursor pagination by id
   - `listConversations`: aggregate latest message per conversation partner

3. Create `server/src/routes/messages.ts`:
   - GET `/` — list conversations for current user
   - GET `/:friendId` — get message history (cursor pagination: `?before=<id>&limit=50`)
   - POST `/:friendId` — send message (validate friendship, save to DB, emit via Socket.io)

4. Add Socket.io event handlers to `server/src/socket.ts`:
   - On "message:send" event: validate friendship, save message, emit "message:new" to recipient's room
   - On "message:read" event: mark conversation as seen (update unread state)

5. Run tests — verify FAIL:
   ```bash
   npm run test -- server/src/routes/messages.test.ts
   ```
   Expected: tests fail (routes don't exist yet)

6. Implement messages service, routes, and socket handlers (Steps 2-4 above)

7. Run tests — verify PASS:
   ```bash
   npm run test -- server/src/routes/messages.test.ts
   ```
   Expected: all tests pass

8. Commit:
   ```bash
   git add server/src/routes/messages.ts server/src/messages/service.ts \
           server/src/routes/messages.test.ts server/src/socket.ts
   git commit -m "feat(messages): add DM API and Socket.io event handlers"
   ```

## REFERENCES LOADED
docs/pocket/spec/2026-07-03-friendlist-and-dm/friendlist-dm.md — Story 5, API Routes (Messages section)
server/src/routes/helpers.ts — existing helper patterns
server/src/socket.ts — Socket.io setup from T4
server/src/db/redis.ts — Redis client for Socket.io adapter

## WHY THIS APPROACH
Complexity: standard
Justification: Service layer separates business logic from routes (sendMessage validates friendship). Socket.io events provide real-time delivery while REST API handles persistence and history. Dual-path (REST + Socket.io) ensures offline users get messages when they come online.

## SANDWICH CONTEXT
[CRITICAL: DM only allowed between accepted friends — check friendship status on every send]
You are implementing DM backend for Friendlist & DM.
Spec: docs/pocket/spec/2026-07-03-friendlist-and-dm/friendlist-dm.md
Design decision: Friends-only DM, Socket.io /messages namespace, REST for persistence + history
Files in scope: server/src/routes/messages.ts, server/src/messages/service.ts, server/src/routes/messages.test.ts, server/src/socket.ts
Available after: T1 (schema), T4 (Socket.io setup)
Architecture rule: Kysely ORM, Express 5, Socket.io /messages namespace, conventional error objects
[RESTATE: DM only allowed between accepted friends — check friendship status on every send]

## DELIVERABLE
Given friends, When POST /messages/:friendId, Then message saved and returned
Given friends + recipient online, When send message, Then recipient receives "message:new" via Socket.io
Given non-friends, When POST /messages/:friendId, Then error "You can only message friends"
Given conversation exists, When GET /messages/:friendId, Then messages returned with cursor pagination
Given multiple conversations, When GET /messages, Then conversations listed most recent first with preview
Given empty content, When POST /messages/:friendId, Then validation error
[must-not] Given content > 4000 chars, When send, Then validation error

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - All test scenarios passing
  - Friendship validation on every send (REST + Socket.io)
  - Cursor pagination for conversation history
  - Real-time delivery via Socket.io for online users
  - Messages stored for offline delivery
  - Content validation (not empty, max 4000 chars)

Must-not-have:
  - Message editing or deletion endpoints
  - Read receipts or per-message read tracking
  - Group messaging
  - File/image upload

Open question risks:
  - Socket.io event integration with Express routes (both need access to Socket.io instance) → pass io instance via module-level variable or dependency injection

Rollback note:
  - Remove messages.ts route file, messages/ directory, socket.ts event handlers

## STOP CONDITIONS
Done when: all tests pass, messages saved and delivered in real-time
Uncertain when: Socket.io instance access pattern from routes unclear
Escalate when: friendship check causes performance issues with large friend lists

---

### Task 6: Inbox Unification [depends: T3, T5]

## OBJECTIVE
Refactor InboxPage to support tabbed layout (Messages + Notifications), add conversation list UI with unread indicators, and integrate Socket.io client for real-time message updates.

Files:
- Create: `client/src/components/MessagesTab.tsx`
- Create: `client/src/components/ConversationView.tsx`
- Create: `client/src/hooks/useSocket.ts`
- Modify: `client/src/pages/InboxPage.tsx` (add tabs)
- Modify: `client/src/api.ts` (add message endpoints)
- Modify: `client/src/context/NotificationsContext.tsx` (unread count)

Steps:
1. Write failing tests:
   File: `client/src/pages/InboxPage.test.tsx`
   Tests verify:
   - InboxPage renders two tabs: "Messages" and "Notifications"
   - "Messages" tab is default
   - Messages tab shows conversation list with name, preview, timestamp
   - Unread indicator shown on conversations with new messages
   - Switching to Notifications tab shows existing notification system
   - Clicking conversation opens ConversationView

2. Add message API functions to `client/src/api.ts`:
   ```typescript
   export async function listConversations(): Promise<ConversationPreview[]>
   export async function getConversation(friendId: number, cursor?: number): Promise<DirectMessage[]>
   export async function sendMessage(friendId: number, content: string): Promise<DirectMessage>
   ```

3. Create `client/src/hooks/useSocket.ts`:
   - Initialize socket.io-client connection to `/messages` namespace
   - Auto-reconnect with exponential backoff
   - Listen for "message:new" events, update conversation list
   - Expose: `sendMessage(friendId, content)`, `onNewMessage(callback)`, `isConnected`

4. Create `client/src/components/MessagesTab.tsx`:
   - Fetch conversations via API
   - Render conversation list (name, last message preview, timestamp, unread indicator)
   - Click handler to open ConversationView
   - Real-time updates via useSocket hook

5. Create `client/src/components/ConversationView.tsx`:
   - Fetch message history with cursor pagination
   - Render messages with markdown (react-markdown)
   - Send message input at bottom
   - Real-time message receive via useSocket
   - Back button to return to conversation list

6. Modify `client/src/pages/InboxPage.tsx`:
   - Add tab switcher: "Messages" | "Notifications"
   - Messages tab renders MessagesTab component
   - Notifications tab renders existing notification list

7. Modify `client/src/context/NotificationsContext.tsx`:
   - Add unread message count to context
   - Expose `unreadMessageCount` alongside existing notification count

8. Run tests — verify FAIL:
   ```bash
   npm run test -- client/src/pages/InboxPage.test.tsx
   ```
   Expected: tests fail (new components don't exist yet)

9. Implement components (Steps 2-7 above)

10. Run tests — verify PASS:
   ```bash
   npm run test -- client/src/pages/InboxPage.test.tsx
   ```
   Expected: all tests pass

11. Commit:
   ```bash
   git add client/src/components/MessagesTab.tsx client/src/components/ConversationView.tsx \
           client/src/hooks/useSocket.ts client/src/pages/InboxPage.tsx \
           client/src/api.ts client/src/context/NotificationsContext.tsx \
           client/src/pages/InboxPage.test.tsx
   git commit -m "feat(inbox): unify DM and notifications with tabbed layout"
   ```

## REFERENCES LOADED
docs/pocket/spec/2026-07-03-friendlist-and-dm/friendlist-dm.md — Story 6, API Routes (Messages section)
client/src/pages/InboxPage.tsx — existing inbox page
client/src/context/NotificationsContext.tsx — existing notification context
client/src/api.ts — API function pattern
docs/pocket/rule/creative-brief.md — UI design tokens
client/src/hooks/ — existing hook patterns

## WHY THIS APPROACH
Complexity: standard
Justification: Tab-based layout keeps unified inbox simple. Separate MessagesTab and ConversationView components follow single-responsibility. useSocket hook encapsulates Socket.io complexity. Markdown rendering via react-markdown (already in dependencies).

## SANDWICH CONTEXT
[CRITICAL: Inbox tabs must be loosely coupled — future notification separation should not require rewrite]
You are implementing inbox unification for Friendlist & DM.
Spec: docs/pocket/spec/2026-07-03-friendlist-and-dm/friendlist-dm.md
Design decision: Unified inbox with tabs, Messages default, Notifications unchanged
Files in scope: client/src/components/MessagesTab.tsx, client/src/components/ConversationView.tsx, client/src/hooks/useSocket.ts, client/src/pages/InboxPage.tsx, client/src/api.ts, client/src/context/NotificationsContext.tsx
Available after: T3 (friend UI), T5 (DM API)
Architecture rule: React 18, Tailwind CSS v4, react-markdown for markdown, socket.io-client, Vite bundler resolution
[RESTATE: Inbox tabs must be loosely coupled — future notification separation should not require rewrite]

## DELIVERABLE
Given user opens Inbox, When page loads, Then "Messages" tab shown by default with conversation list
Given user clicks "Notifications" tab, When tab switches, Then existing notification system shown unchanged
Given new message received via Socket.io, When conversation list visible, Then unread indicator shown
Given user clicks conversation, When ConversationView opens, Then message history loaded with markdown rendering
Given user sends message, When message submitted, Then message appears in conversation and sent via Socket.io
[must-not] Given tab switch, When rendering, Then Messages and Notifications must not share state or re-render each other

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - All test scenarios passing
  - Tab-based layout with Messages default
  - Unread indicators (binary, conversation-level)
  - Markdown rendering in messages
  - Real-time updates via Socket.io
  - Cursor pagination for message history

Must-not-have:
  - Per-message read receipts
  - Typing indicators
  - Message editing/deletion UI
  - Modifications to existing notification rendering logic

Open question risks:
  - react-markdown security (XSS in markdown) → use rehype-sanitize plugin
  - Socket.io client bundle size (~100KB) → acceptable trade-off per design decision

Rollback note:
  - Remove new components, revert InboxPage to original

## STOP CONDITIONS
Done when: all tests pass, inbox tabs work, real-time messaging functional
Uncertain when: react-markdown XSS handling unclear
Escalate when: Socket.io client integration causes build issues

---

### Task 7: Workspace Integration [depends: T2]

## OBJECTIVE
Add endpoint to add friend directly to workspace (no invite confirmation) with "member" role. Add workspace selector UI to FriendsPage.

Files:
- Modify: `server/src/routes/members.ts` (add friend-to-workspace endpoint)
- Modify: `client/src/pages/FriendsPage.tsx` (add workspace selector modal)
- Modify: `client/src/api.ts` (add workspace friend endpoint)
- Test: `server/src/routes/members.test.ts` (add tests)

Steps:
1. Write failing tests:
   File: `server/src/routes/members.test.ts` (append new describe block)
   Tests verify:
   - POST /workspaces/:id/members/friend — add friend as member (happy path)
   - POST /workspaces/:id/members/friend — cannot add non-friend
   - POST /workspaces/:id/members/friend — cannot add existing member
   - POST /workspaces/:id/members/friend — user at workspace cap (10) rejected
   - POST /workspaces/:id/members/friend — workspace at member cap rejected
   - POST /workspaces/:id/members/friend — added friend receives notification

2. Add endpoint to `server/src/routes/members.ts`:
   ```typescript
   router.post("/:id/members/friend", requireWorkspaceMember("admin"), async (req, res) => {
     // Validate friendship is "accepted"
     // Check user workspace cap (10)
     // Check workspace member cap (if exists)
     // Insert into workspace_members with role "member"
     // Create notification for added user
   });
   ```

3. Add API function to `client/src/api.ts`:
   ```typescript
   export async function addFriendToWorkspace(workspaceId: number, friendId: number): Promise<void>
   ```

4. Update `client/src/pages/FriendsPage.tsx`:
   - "Add to Workspace" button on each friend card
   - Click opens modal with workspace selector (list user's workspaces)
   - On select, call addFriendToWorkspace API
   - Success toast: "Added [name] to [workspace]"
   - Error handling for all failure cases

5. Run tests — verify FAIL:
   ```bash
   npm run test -- server/src/routes/members.test.ts
   ```
   Expected: new tests fail (endpoint doesn't exist yet)

6. Implement endpoint and UI (Steps 2-4 above)

7. Run tests — verify PASS:
   ```bash
   npm run test -- server/src/routes/members.test.ts
   ```
   Expected: all tests pass

8. Commit:
   ```bash
   git add server/src/routes/members.ts client/src/pages/FriendsPage.tsx \
           client/src/api.ts server/src/routes/members.test.ts
   git commit -m "feat(workspace): add friend-to-workspace integration"
   ```

## REFERENCES LOADED
docs/pocket/spec/2026-07-03-friendlist-and-dm/friendlist-dm.md — Story 7, API Routes (Workspace Integration)
server/src/routes/members.ts — existing member management (POST /:id/members)
server/src/routes/helpers.ts — checkWorkspaceCapacity, recordActivity
client/src/pages/FriendsPage.tsx — Friends page from T3 (needs workspace selector)

## WHY THIS APPROACH
Complexity: standard
Justification: Leverages existing member management infrastructure. Direct add (no invite) simplifies flow for friends. Notification ensures added user knows about the workspace.

## SANDWICH CONTEXT
[CRITICAL: Added friend always gets role "member" — never admin or owner]
You are implementing workspace integration for Friendlist & DM.
Spec: docs/pocket/spec/2026-07-03-friendlist-and-dm/friendlist-dm.md
Design decision: Direct add from friendlist, always "member" role, no invite confirmation
Files in scope: server/src/routes/members.ts, client/src/pages/FriendsPage.tsx, client/src/api.ts, server/src/routes/members.test.ts
Available after: T2 (friend API)
Architecture rule: Express 5, requireWorkspaceMember middleware, recordActivity for mutations
[RESTATE: Added friend always gets role "member" — never admin or owner]

## DELIVERABLE
Given friend, When POST /workspaces/:id/members/friend, Then friend added as "member"
Given non-friend, When add to workspace, Then error "Not a friend"
Given friend already in workspace, When add, Then error "Already a member"
Given user at 10 workspace cap, When add, Then error "Workspace limit reached"
Given friend added, When action completes, Then friend receives notification
Given friend added, When friend views workspace list, Then new workspace appears

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - All test scenarios passing
  - Role always "member" (hardcoded, not parameterized)
  - Workspace capacity check (user side)
  - Notification sent to added user
  - recordActivity called for audit trail

Must-not-have:
  - Role selection UI (always "member")
  - Invite confirmation flow
  - Modifications to existing member management endpoints

Open question risks:
  - Workspace member cap: spec mentions R7.6 but cap number unknown → implement check only if cap exists in existing code

Rollback note:
  - Revert members.ts changes, remove FriendsPage workspace selector

## STOP CONDITIONS
Done when: all tests pass, friend added to workspace as member
Uncertain when: workspace member cap number unclear
Escalate when: existing member management pattern doesn't support direct add

---

### Task 8: Message TTL Cleanup [depends: T5]

## OBJECTIVE
Create background cron job that hard-deletes direct messages older than 30 days. Integrate with existing scheduler.

Files:
- Create: `server/src/messages/cleanup.ts`
- Modify: `server/src/notifications/scheduler.ts` (add cleanup job)
- Test: `server/src/messages/cleanup.test.ts`

Steps:
1. Write failing tests:
   File: `server/src/messages/cleanup.test.ts`
   Tests verify:
   - Messages older than 30 days are deleted
   - Messages newer than 30 days are preserved
   - Cleanup runs without errors
   - Empty table (no messages) handled gracefully

2. Create `server/src/messages/cleanup.ts`:
   ```typescript
   import { db } from "../db/index.js";

   export async function cleanupExpiredMessages(ttlDays: number = 30): Promise<number> {
     const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000);
     const result = await db
       .deleteFrom("direct_messages")
       .where("created_at", "<", cutoff)
       .executeTakeFirst();
     return Number(result.numDeletedRows);
   }
   ```

3. Integrate with `server/src/notifications/scheduler.ts`:
   - Import `cleanupExpiredMessages`
   - Add cleanup job to existing scheduler (runs periodically, e.g., every hour)
   - Log deletion count for observability

4. Run tests — verify FAIL:
   ```bash
   npm run test -- server/src/messages/cleanup.test.ts
   ```
   Expected: tests fail (cleanup.ts doesn't exist yet)

5. Implement cleanup and scheduler integration (Steps 2-3 above)

6. Run tests — verify PASS:
   ```bash
   npm run test -- server/src/messages/cleanup.test.ts
   ```
   Expected: all tests pass

7. Commit:
   ```bash
   git add server/src/messages/cleanup.ts server/src/notifications/scheduler.ts \
           server/src/messages/cleanup.test.ts
   git commit -m "feat(messages): add TTL cleanup cron job for direct messages"
   ```

## REFERENCES LOADED
docs/pocket/spec/2026-07-03-friendlist-and-dm/friendlist-dm.md — Data Model (TTL Cleanup), Story 5 (R5.5)
server/src/notifications/scheduler.ts — existing scheduler pattern (due date reminders)
server/src/db/index.ts — database client

## WHY THIS APPROACH
Complexity: lightweight
Justification: Reuses existing scheduler infrastructure. Hard delete is clean (no soft-delete complexity). Simple cron job follows project patterns.

## SANDWICH CONTEXT
[CRITICAL: TTL cleanup is hard delete — messages are permanently removed from database]
You are implementing message TTL cleanup for Friendlist & DM.
Spec: docs/pocket/spec/2026-07-03-friendlist-and-dm/friendlist-dm.md
Design decision: Hard delete via cron job, default 30 days TTL
Files in scope: server/src/messages/cleanup.ts, server/src/notifications/scheduler.ts, server/src/messages/cleanup.test.ts
Available after: T5 (DM API, direct_messages table populated)
Architecture rule: Kysely ORM, integrate with existing scheduler.ts pattern
[RESTATE: TTL cleanup is hard delete — messages are permanently removed from database]

## DELIVERABLE
Given messages older than 30 days, When cleanup runs, Then messages deleted from database
Given messages newer than 30 days, When cleanup runs, Then messages preserved
Given empty direct_messages table, When cleanup runs, Then no errors (graceful no-op)
Given scheduler runs, When cleanup job executes, Then deletion count logged

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - All test scenarios passing
  - Hard delete (not soft delete)
  - Integrated with existing scheduler
  - Deletion count logged for observability
  - Default 30-day TTL (configurable parameter)

Must-not-have:
  - Soft delete with deleted_at flag
  - Cleanup of other message types (notifications, card_events)
  - User-facing TTL configuration UI

Open question risks:
  - None — TTL behavior fully specified

Rollback note:
  - Remove cleanup.ts, revert scheduler.ts changes

## STOP CONDITIONS
Done when: all tests pass, cleanup job integrated with scheduler
Uncertain when: scheduler.ts integration pattern unclear
Escalate when: scheduler timing conflicts with existing jobs

---

## Plan Summary

| Task | Name | Depends | Complexity | Key Verification |
|------|------|---------|------------|-----------------|
| T1 | Friend System Schema + Types | prereq | lightweight | Tables exist, types regenerated |
| T2 | Friend System Backend | T1 | standard | All 13 friend request scenarios pass |
| T3 | Friend System Frontend | T2 | standard | Friends page renders, search works, actions functional |
| T4 | Socket.io Setup | T1 | standard | /messages namespace auth works, Redis adapter configured |
| T5 | Direct Messages Backend | T1, T4 | standard | Messages saved, real-time delivery works |
| T6 | Inbox Unification | T3, T5 | standard | Tabs work, conversations render, real-time updates |
| T7 | Workspace Integration | T2 | standard | Friend added to workspace as member, notification sent |
| T8 | Message TTL Cleanup | T5 | lightweight | Old messages deleted, scheduler integrated |
