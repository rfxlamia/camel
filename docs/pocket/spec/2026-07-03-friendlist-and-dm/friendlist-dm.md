# Friendlist & Direct Messaging

**Date:** 2026-07-03
**Status:** Edge Cases Resolved — Ready for Design

---

## Summary

Add a friend list system and 1-on-1 direct messaging (DM) to camel-kanban. Users can send friend requests (mutual confirmation), chat with friends via DM in a unified Inbox, and add friends directly to workspaces without needing to remember usernames.

## Context

Currently, camel-kanban has no user-to-user communication. The "Inbox" only contains system notifications (card assignments, due date reminders). Adding friends and DM enables organic collaboration — users can discover teammates through their friend list and bring them into workspaces seamlessly.

---

## Scope

### In-Scope
- Friend request system (send, accept, decline, cancel)
- Friend list page in sidebar
- Direct messaging between friends (1-on-1, text + markdown)
- Add friend to workspace from friendlist (direct, always "member" role)
- Real-time message delivery via Socket.io
- Unified Inbox with tab filtering (Messages / Notifications)
- TTL-based message persistence (hard delete via cron)

### Out-of-Scope
- Group chat / multi-user messaging
- File/image sharing in chat
- Message editing / deletion
- Read receipts / typing indicators
- Notification push to mobile/email
- Notification page separation (planned for future)

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Friend request model | Mutual confirmation | Standard trust model, user B must accept |
| Real-time delivery | Socket.io | Bidirectional, Redis adapter for horizontal scaling, auto-fallback |
| Socket.io namespace | `/messages` | Isolate DM traffic from future real-time features |
| Socket.io fallback | `websocket` → `polling` | Corporate firewall compatibility |
| DM access control | Friends only | Simple trust boundary, no spam risk |
| Message storage | TTL-based, hard delete via cron job | Clean storage, no orphan data |
| Message TTL cleanup | Background cron job (like scheduler.ts) | Periodic sweep, consistent with existing patterns |
| Post-unfriend message access | Readable until TTL expires | Graceful degradation |
| Unfriending mechanism | Delete row, no notification | Clean state, fresh start possible |
| Decline → re-request | Row kept, update "declined" → "pending" | No orphan rows, retry works |
| OAuth users without username | Reject with prompt to set username | Required for friend discovery |
| Inbox layout | Unified (DM + notifications) | Single entry point; notifications will move later |
| Friendlist location | Separate page in sidebar | Clear navigation, dedicated space |
| Add-to-workspace role | Always "member" | Friends are trusted but not admins by default |
| Redis adapter | Mandatory from day one | Horizontal scaling is config change, not refactor |

---

## Data Model

### New Tables

#### `friends`
```sql
CREATE TABLE friends (
  id SERIAL PRIMARY KEY,
  requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(requester_id, addressee_id)
);
```

#### `direct_messages`
```sql
CREATE TABLE direct_messages (
  id SERIAL PRIMARY KEY,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Indexes
- `friends(requester_id, status)` — outgoing requests lookup
- `friends(addressee_id, status)` — incoming requests lookup
- `friends(requester_id, addressee_id)` — friendship existence check (unique constraint)
- `direct_messages(sender_id, recipient_id, created_at)` — conversation history
- `direct_messages(recipient_id, sender_id, created_at)` — reverse conversation history

### TTL Cleanup
- Background cron job (similar to `scheduler.ts`) runs periodically
- Hard deletes `direct_messages` where `created_at < now() - interval '30 days'`

---

## Stories & Scenarios

### Story 1: Send Friend Request
> As a user, I want to send a friend request to another user by username, so that I can connect with them.

**Rules:**
- R1.1: Can only send request to existing users with a username (OAuth users without username → reject with "User has not set a username yet")
- R1.2: Cannot send request to yourself
- R1.3: Cannot send duplicate pending request
- R1.4: If friendship row exists with status "declined", update it to "pending" (re-request)
- R1.5: If friendship row exists with status "pending" or "accepted", reject

**Scenarios:**

```
Scenario: Successfully send friend request
  Given user "alice" exists with username "alice"
  And user "bob" exists with username "bob"
  And no friendship exists between alice and bob
  When alice sends friend request to "bob"
  Then a friend request is created with status "pending"
  And bob sees the request in his incoming requests list

Scenario: Cannot send request to yourself
  Given user "alice" is logged in
  When alice tries to send friend request to "alice"
  Then error is returned: "Cannot send friend request to yourself"

Scenario: Cannot send duplicate pending request
  Given alice already sent a pending request to bob
  When alice tries to send another request to bob
  Then error is returned: "Friend request already pending"

Scenario: Cannot send request to non-existent user
  Given no user with username "ghost" exists
  When alice sends friend request to "ghost"
  Then error is returned: "User not found"

Scenario: OAuth user without username cannot receive requests
  Given user "charlie" has no username (OAuth-only)
  When alice searches for charlie by username
  Then error is returned: "User has not set a username yet"

Scenario: Re-request after decline
  Given bob declined alice's friend request
  When alice sends a new friend request to bob
  Then the existing row status changes from "declined" to "pending"
  And bob sees the new incoming request

Scenario: Simultaneous friend requests
  Given no friendship exists between alice and bob
  When alice sends request to bob AND bob sends request to alice simultaneously
  Then only one friendship record is created (or both are merged into "accepted")
  And both users see each other as friends
```

---

### Story 2: Respond to Friend Request
> As a user, I want to accept or decline incoming friend requests.

**Rules:**
- R2.1: Only the addressee can accept/decline
- R2.2: Accepting creates an accepted friendship (mutual)
- R2.3: Declining updates status to "declined" (row kept, allows future re-request)

**Scenarios:**

```
Scenario: Accept friend request
  Given bob has a pending friend request from alice
  When bob accepts the request
  Then friendship status changes to "accepted"
  And alice and bob appear in each other's friend list

Scenario: Decline friend request
  Given bob has a pending friend request from alice
  When bob declines the request
  Then friendship status changes to "declined"
  And the request is removed from bob's incoming list (filtered, not deleted)

Scenario: Cannot accept request not addressed to you
  Given bob has a pending friend request from alice
  When charlie tries to accept alice's request to bob
  Then error is returned: "Not authorized"
```

---

### Story 3: Cancel Friend Request
> As a user, I want to cancel a pending friend request I sent.

**Rules:**
- R3.1: Only the requester can cancel
- R3.2: Can only cancel "pending" requests
- R3.3: Canceling deletes the friend request row

**Scenarios:**

```
Scenario: Cancel pending friend request
  Given alice sent a pending request to bob
  When alice cancels the request
  Then the request is deleted
  And bob no longer sees the incoming request

Scenario: Cannot cancel accepted friendship
  Given alice and bob are friends (accepted)
  When alice tries to cancel
  Then error is returned: "Cannot cancel accepted friendship"
```

---

### Story 4: Friend List
> As a user, I want to see my friend list so I can manage my connections.

**Rules:**
- R4.1: Friend list shows all accepted friendships
- R4.2: Each entry shows: display name, username, avatar (if any)
- R4.3: Friend list supports search/filter by name or username
- R4.4: Pending incoming requests are shown separately (with accept/decline actions)
- R4.5: Pending outgoing requests are shown separately (with cancel action)
- R4.6: Unfriending deletes the friendship row (both users can re-request in the future)

**Scenarios:**

```
Scenario: View friend list
  Given alice has 3 accepted friends and 1 pending incoming request
  When alice opens the Friends page
  Then she sees 3 friends in the "Friends" tab
  And she sees 1 pending request in the "Requests" tab

Scenario: Search friends
  Given alice has friends "bob", "charlie", "diana"
  When alice searches for "bo"
  Then only "bob" is shown in the filtered list

Scenario: Search friends returns no matches
  Given alice has friends "bob", "charlie"
  When alice searches for "xyz"
  Then an empty state is shown with "No friends found"

Scenario: Unfriend a user
  Given alice and bob are friends
  When alice unfriends bob
  Then the friendship row is deleted
  And bob is removed from alice's friend list
  And alice is removed from bob's friend list
  And bob is NOT notified
  And existing DM history is preserved until TTL
  And neither can send new DMs to each other
  And either can send a new friend request in the future (fresh start)
```

---

### Story 5: Send & Receive Direct Messages
> As a user, I want to send and receive DMs with my friends in real-time.

**Rules:**
- R5.1: Can only DM users who are accepted friends
- R5.2: Messages support markdown rendering (bold, italic, code, links — NO link previews, just clickable URLs)
- R5.3: Messages are delivered in real-time via Socket.io (`/messages` namespace)
- R5.4: Offline users receive messages when they come online (stored in DB)
- R5.5: Messages persist until TTL expires (default 30 days, hard delete via cron)
- R5.6: Unread state is binary (seen/unseen conversation level, NOT per-message read tracking)

**Scenarios:**

```
Scenario: Send DM to friend
  Given alice and bob are friends
  And bob is online
  When alice sends "Hello **bob**!" to bob
  Then the message is saved to database
  And bob receives the message in real-time via Socket.io
  And the message renders "Hello bob!" with "bob" in bold

Scenario: Send DM to offline friend
  Given alice and bob are friends
  And bob is offline
  When alice sends "Hi there" to bob
  Then the message is saved to database
  And bob sees the message when he comes online

Scenario: Cannot DM non-friend
  Given alice and charlie are NOT friends
  When alice tries to send a message to charlie
  Then error is returned: "You can only message friends"

Scenario: Cannot DM after unfriend
  Given alice and bob were friends, then unfriended
  When alice tries to send a message to bob
  Then error is returned: "You can only message friends"
  And existing DM history is still visible (until TTL)

Scenario: Messages cleaned up after TTL
  Given alice and bob have messages older than 30 days
  When the TTL cron job runs
  Then messages older than 30 days are permanently deleted from database
```

---

### Story 6: Unified Inbox (Messages + Notifications)
> As a user, I want to see my DMs and notifications in one place.

**Rules:**
- R6.1: Inbox page has tabs: "Messages" and "Notifications"
- R6.2: Messages tab shows conversation list (most recent first)
- R6.3: Each conversation shows: friend name, last message preview, timestamp
- R6.4: Unread indicators for new messages (binary: seen/unseen at conversation level)
- R6.5: Notifications tab shows existing notification system (unchanged)
- R6.6: Inbox tabs are loosely coupled — future notification separation should not require rewrite

**Scenarios:**

```
Scenario: View inbox with both tabs
  Given alice has 2 active DM conversations and 5 notifications
  When alice opens the Inbox page
  Then she sees "Messages" tab (default) with 2 conversations
  And she can switch to "Notifications" tab to see 5 notifications

Scenario: Unread message indicator
  Given bob sent alice a message while alice was away
  When alice opens the Inbox
  Then the conversation with bob shows an unread indicator
  And the unread count is shown on the Inbox navigation item
```

---

### Story 7: Add Friend to Workspace
> As a user, I want to add friends directly to my workspace from the friendlist.

**Rules:**
- R7.1: Can only add friends who are in accepted friend list
- R7.2: Added friend gets role "member" (always)
- R7.3: Cannot add friend who is already a workspace member
- R7.4: Workspace capacity (10 per user) still enforced for the added user
- R7.5: Action is instant — no invite confirmation needed
- R7.6: Added friend receives a post-action notification "X added you to Y workspace"

**Scenarios:**

```
Scenario: Add friend to workspace
  Given alice and bob are friends
  And alice owns workspace "Project Alpha"
  And bob is not a member of "Project Alpha"
  When alice adds bob to "Project Alpha" from friendlist
  Then bob becomes a member of "Project Alpha" with role "member"
  And bob sees "Project Alpha" in his workspace list
  And bob receives notification "alice added you to Project Alpha"

Scenario: Cannot add friend already in workspace
  Given alice and bob are friends
  And bob is already a member of "Project Alpha"
  When alice tries to add bob to "Project Alpha"
  Then error is returned: "User is already a member of this workspace"

Scenario: Workspace capacity enforced (user side)
  Given bob already has 10 workspaces
  When alice tries to add bob to "Project Alpha"
  Then error is returned: "User has reached workspace limit"

Scenario: Workspace capacity enforced (workspace side)
  Given workspace "Project Alpha" has reached its member limit
  And alice and bob are friends
  When alice tries to add bob to "Project Alpha"
  Then error is returned: "Workspace has reached member capacity"
```

---

## API Routes

### Friends
| Method | Path | Description |
|--------|------|-------------|
| POST | `/friends/request` | Send friend request (body: `{ username }`) |
| GET | `/friends` | List accepted friends |
| GET | `/friends/requests/incoming` | List incoming pending requests |
| GET | `/friends/requests/outgoing` | List outgoing pending requests |
| POST | `/friends/:friendshipId/accept` | Accept friend request |
| POST | `/friends/:friendshipId/decline` | Decline friend request |
| DELETE | `/friends/:friendshipId` | Cancel request (pending) or unfriend (accepted) |

### Direct Messages
| Method | Path | Description |
|--------|------|-------------|
| GET | `/messages` | List conversations (most recent first) |
| GET | `/messages/:friendId` | Get message history with a friend (cursor pagination) |
| POST | `/messages/:friendId` | Send message (body: `{ content }`) |
| WS | `/messages` (Socket.io namespace) | Real-time messaging |

### Workspace Integration
| Method | Path | Description |
|--------|------|-------------|
| POST | `/workspaces/:id/members/friend` | Add friend to workspace (body: `{ friendId }`) |

---

## Acceptance Criteria

### Friend Requests
- ✓ Given valid username, When send request, Then pending request created
- ✓ Given pending request exists, When accept, Then friendship status = "accepted"
- ✓ Given pending request exists, When decline, Then friendship status = "declined" (row kept)
- ✓ Given declined request, When send new request, Then row updated to "pending"
- ✓ Given pending request exists, When cancel, Then request deleted
- ✓ Given existing friendship, When send duplicate request, Then error returned
- ✓ Given user tries to add self, When send request, Then error returned
- ✗ Given non-existent username, When send request, Then "User not found" error
- ✗ Given OAuth user without username, When search/send request, Then "User has not set a username yet" error
- ✓ Given simultaneous requests from both users, When processed, Then merged into single "accepted" friendship

### Direct Messaging
- ✓ Given friends, When send message, Then message saved and delivered via Socket.io
- ✓ Given friends, When send to offline user, Then message stored for later delivery
- ✓ Given non-friends, When send message, Then "You can only message friends" error
- ✓ Given unfriended users, When view history, Then messages visible until TTL
- ✓ Given unfriended users, When send new message, Then error returned
- ✓ Given message with markdown, When rendered, Then markdown formatted correctly (no link previews)
- ✓ Given messages older than TTL, When cron runs, Then hard deleted from DB

### Friendlist → Workspace
- ✓ Given friend, When add to workspace, Then role = "member"
- ✓ Given friend already in workspace, When add, Then error returned
- ✓ Given friend at workspace cap, When add, Then capacity error returned
- ✓ Given workspace at member cap, When add, Then workspace capacity error returned
- ✓ Given friend added to workspace, When action completes, Then friend receives notification

### Unified Inbox
- ✓ Given DMs and notifications, When open Inbox, Then tabs visible (Messages, Notifications)
- ✓ Given new unread message, When view Inbox, Then unread indicator shown (binary, conversation-level)

---

## Architecture Notes

### Socket.io Configuration
- **Namespace**: `/messages` (isolated from other real-time features)
- **Transport order**: `websocket` → `polling` (auto-fallback)
- **Redis adapter**: `@socket.io/redis-adapter` on existing Redis instance
- **Client**: `socket.io-client` (not full package)
- **Auth**: Reuse session token from cookie for WebSocket handshake
- **SSE remains** for notifications and board events — no migration

### Rate Limiting
- DM send: 10 messages/second per user (TBD during implementation)
- Friend request: 20 requests/hour per user (TBD during implementation)

---

## Open Questions

### BLOCKING
_(All resolved during discovery + edge case hunter)_

### NON-BLOCKING (Implementation Details)
- **Message max length**: TBD (suggest 4000 chars)
- **WebSocket reconnection strategy**: Exponential backoff, max 30s
- **Workspace member cap**: Does one exist? If so, R7.6 scenario needs exact number
- **Simultaneous request merge logic**: DB-level unique constraint + upsert, or application-level check

---

## Out-of-Scope (Remind Pocket-Planning)
- Group chat
- File/image sharing in DM
- Message editing / deletion
- Read receipts / typing indicators
- Notification page separation from Inbox
- Mobile/email push notifications
