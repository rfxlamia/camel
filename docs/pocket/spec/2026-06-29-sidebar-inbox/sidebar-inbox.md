# Spec: Sidebar Inbox — Notification Center
Date: 2026-06-29 | Project: Camel Kanban | Scope confirmed: yes

---

## Problem Statement

Camel Kanban tidak punya notification center personal — user tidak bisa melihat secara terpusat hal-hal yang relevan untuk mereka. Diperlukan fitur **Inbox** di sidebar Kanban mode yang menampilkan notifikasi personal: card assignments, due date changes & reminders, welcome message, membership changes, dan system alerts.

## Design Decision: Domain Event Bus + Notifications Table

**Pattern:** Lightweight in-process event bus (Node `EventEmitter`). Route handlers emit domain events. Notification service subscribes dan handle routing + insertion ke `notifications` table. Client menerima realtime via SSE channel terpisah (`/notifications/stream`) dan fetch history via REST endpoint.

**Why this pattern:**
- Centralized notification routing — semua logic di satu subscriber
- Decoupled dari realtime layer — tidak mengubah `publishEvent` pipeline
- Extensible — gampang tambah subscriber baru nanti (analytics, audit)
- Follows existing Camel patterns (ESM, async/await, Express routes)

---

## Data Model

### Table: `notifications`

```sql
CREATE TABLE notifications (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id  INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,  -- 'card_assigned', 'due_date_changed', 'due_date_reminder', 'welcome', 'member_joined', 'system_alert'
  title         TEXT NOT NULL,
  body          TEXT,
  card_id       INTEGER REFERENCES cards(id) ON DELETE SET NULL,
  board_id      INTEGER,
  actor_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  read_at       TIMESTAMPTZ,
  source_deleted BOOLEAN NOT NULL DEFAULT FALSE,  -- true when card/board is deleted
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_notifications_user_unread ON notifications(user_id, read_at) WHERE read_at IS NULL;
CREATE INDEX idx_notifications_user_created ON notifications(user_id, created_at DESC);

-- Idempotency: prevent duplicate notifications from retries
CREATE UNIQUE INDEX idx_notifications_idempotency ON notifications(user_id, type, card_id, created_at);
```

### Table: `workspace_settings` (extension)

```sql
ALTER TABLE workspace_settings ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC';
```

---

## Notification Types

| Type | Trigger | Routing | Message Template |
|------|---------|---------|-----------------|
| `card_assigned` | Card created with assignee, or assignee changed TO user | Assignee (not actor) | "{actor} assigned '{card_title}' to you" |
| `due_date_changed` | due_date of assigned card changed, including set to null | Assignee (not actor) | "{actor} changed due date of '{card_title}' from {old} to {new}" or "{actor} removed due date from '{card_title}'" |
| `due_date_reminder` | Scheduled daily: card due today (workspace TZ), not in done column | Assignee | "'{card_title}' is due today" |
| `welcome` | User joins workspace (membership created) | New member | "Welcome to {workspace_name}! Start by exploring the board." |
| `member_joined` | New member joins workspace | All existing members (not the new member) | "{new_member} joined {workspace_name}" |
| `system_alert` | Admin/system creates alert | All users | Custom title + body |

### Routing Rules

- **Assignee only** — card notifications go to assignee, not all workspace members
- **Actor exclusion** — if the person performing the action IS the assignee, no notification is created
- **Unassigned cards** — no notification for due date changes on cards without assignee
- **Bulk operations** — individual notifications per card (no aggregation for MVP)

---

## Domain Event Bus

### Event Types (emitted by route handlers)

```typescript
// In server/src/events.ts
import { EventEmitter } from "node:events";

export interface DomainEvent {
  type: string;
  workspaceId: number;
  actorId: number;
  payload: Record<string, unknown>;
}

export const domainBus = new EventEmitter();

// Event names
export const EVENTS = {
  CARD_ASSIGNED: "card:assigned",
  CARD_DUE_DATE_CHANGED: "card:dueDateChanged",
  CARD_DUE_DATE_REMOVED: "card:dueDateRemoved",
  MEMBER_JOINED: "member:joined",
  SYSTEM_ALERT: "system:alert",
} as const;
```

### Notification Service

```typescript
// In server/src/notifications/service.ts
// Subscribes to domain events, creates notifications, manages SSE delivery

domainBus.on(EVENTS.CARD_ASSIGNED, async (event) => {
  // Look up assignee_id from card
  // If assignee != actor, insert notification
  // Push via SSE to target user
});
```

### Route Handler Integration

```typescript
// In routes/cards.ts — after successful assignment
domainBus.emit(EVENTS.CARD_ASSIGNED, {
  type: EVENTS.CARD_ASSIGNED,
  workspaceId,
  actorId: req.user!.id,
  payload: { cardId, cardTitle, assigneeId },
});
```

---

## API Endpoints

### GET `/api/workspaces/:workspaceId/notifications`

Fetch user's notifications with pagination.

**Query params:**
- `cursor` (optional) — notification ID for cursor-based pagination
- `limit` (default: 50)

**Response:**
```json
{
  "notifications": [
    {
      "id": 123,
      "type": "card_assigned",
      "title": "Bob assigned 'Fix login bug' to you",
      "body": null,
      "cardId": 456,
      "boardId": 1,
      "actorId": 7,
      "readAt": null,
      "sourceDeleted": false,
      "createdAt": "2026-06-29T10:00:00Z"
    }
  ],
  "unreadCount": 5,
  "nextCursor": 120
}
```

### PATCH `/api/workspaces/:workspaceId/notifications/:id/read`

Mark single notification as read.

**Response:** `{ "ok": true }`

### POST `/api/workspaces/:workspaceId/notifications/read-all`

Mark all user's notifications as read in this workspace.

**Response:** `{ "ok": true, "markedCount": 5 }`

### GET `/api/workspaces/:workspaceId/notifications/stream` (SSE)

Server-Sent Events stream for realtime notification delivery.

**Events:**
- `notification.created` — new notification arrived
- `notification.read` — notification marked as read (for cross-tab sync)
- `notifications.read-all` — all marked as read

**Reconnection:** Client sends `Last-Event-ID` header (notification ID). Server replays notifications created after that ID.

---

## SSE Architecture

### Separate Channel (not reusing workspace SSE)

- Endpoint: `GET /api/workspaces/:workspaceId/notifications/stream`
- Auth: same as workspace SSE (requireWorkspaceMember middleware)
- Per-user: only streams notifications for the authenticated user
- Heartbeat: `: ping\n\n` every 25 seconds (same as workspace SSE)

### Client Reconnection

On SSE reconnect:
1. Client includes `Last-Event-ID` (last received notification ID)
2. Server queries `notifications WHERE user_id = ? AND id > ? ORDER BY id`
3. Replays missed notifications as SSE events
4. Then switches to live push

---

## Scheduled Jobs

### Due Date Reminder (Daily)

**Trigger:** Cron job, runs at midnight in each workspace's timezone.

**Logic:**
1. Query distinct workspace timezones from `workspace_settings`
2. For each workspace where local midnight matches current UTC time:
   - Find cards where `due_date = CURRENT_DATE` (in workspace TZ)
   - AND card is NOT in a column with `is_done = true`
   - AND assignee exists
   - AND no existing `due_date_reminder` notification for this card today (idempotency)
3. Insert reminder notification for each qualifying card

**Implementation:** Node.js `setInterval` check every minute, or external cron trigger.

---

## Client Implementation

### Sidebar Integration

**File:** `client/src/layout/sidebar/navItems.ts`

Add Inbox to `KANBAN_NAV`:
```typescript
{ to: "/inbox", label: "Inbox", icon: Inbox }  // lucide-react Inbox icon
```

### Badge Count

- Fetch `unreadCount` on app load via `GET /notifications?limit=1`
- Update via SSE `notification.created` / `notification.read` events
- Display as red badge on sidebar nav item

### InboxPage Component

**File:** `client/src/pages/InboxPage.tsx`

- List of notifications, newest first
- Unread: bold title + blue dot indicator
- Read: normal weight, muted color
- Click card-related notification → navigate to `/board?card={cardId}`
- Click notification → mark as read
- "Mark all as read" button in header
- Empty state: illustration + "Inbox kamu kosong — semua terkendali!"
- Source deleted: greyed out, click disabled, label "Card no longer exists"

### SSE Client Hook

**File:** `client/src/hooks/useNotifications.ts`

- Connects to `/notifications/stream` on mount
- Handles reconnection with `Last-Event-ID`
- Exposes: `notifications[]`, `unreadCount`, `markAsRead(id)`, `markAllAsRead()`

---

## Acceptance Criteria

### Rule: Card Assignment
✓ Given user Bob creates a card with assignee = Alice, When creation succeeds, Then Alice receives `card_assigned` notification
✓ Given card is assigned to Alice, When Bob changes assignee to Charlie, Then Charlie receives notification, Alice does NOT
✓ Given user Alice creates a card with assignee = Alice, When creation succeeds, Then Alice does NOT receive notification
✓ Given card has assignee, When assignee is set to null, Then no notification is created

### Rule: Due Date Change
✓ Given card assigned to Alice with due_date, When Bob changes due_date, Then Alice receives `due_date_changed` notification
✓ Given card assigned to Alice, When Alice changes own card due_date, Then no notification
✓ Given card with no due_date, When due_date is set, Then assignee receives notification with "set to {new_date}"
✓ Given card with due_date, When due_date is removed (null), Then assignee receives "removed due date" notification

### Rule: Due Date Reminder
✓ Given card assigned to Alice with due_date = today (workspace TZ), card not in done column, When cron runs, Then Alice receives `due_date_reminder`
✓ Given card in done column with due_date = today, When cron runs, Then no notification
✓ Given reminder already sent for card today, When cron runs again, Then no duplicate

### Rule: Welcome Message
✓ Given user Alice joins workspace, When membership is created, Then Alice receives `welcome` notification
✓ Given Alice already has welcome for workspace, When re-join, Then no duplicate

### Rule: Membership Change
✓ Given workspace with Alice and Bob, When Charlie joins, Then Alice and Bob receive `member_joined`, Charlie does NOT

### Rule: System Alert
✓ Given admin creates system alert, When alert is published, Then all users receive `system_alert`

### Rule: Inbox Interaction
✓ Given Alice has 3 unread and 2 read notifications, When opens Inbox, Then unread shown with visual distinction, badge shows 3
✓ Given notification links to card, When clicked, Then navigate to board and mark as read
✓ Given notification links to deleted card, When displayed, Then show "Card no longer exists", click disabled
✓ Given Alice has 5 unread, When clicks "Mark all as read", Then all marked read, badge = 0

### Rule: SSE Delivery
✓ Given notification created, When user has SSE connection, Then notification pushed in realtime
✓ Given SSE disconnected then reconnected, When client sends Last-Event-ID, Then missed notifications replayed

### Rule: Edge Cases
✓ Given card is deleted, When notification exists, Then notification kept with source_deleted = true
✓ Given user removed from workspace, When they check inbox, Then workspace notifications hidden
✓ Given workspace timezone = Asia/Jakarta, When cron checks "due today", Then uses Jakarta midnight

---

## Out-of-Scope (remind pocket-planning)
- Agent events (agent.card.done, agent.board.ready, etc.)
- Global inbox across workspaces
- Notification preferences / user settings
- Smart grouping / digest mode / focus mode
- Comment/mention notifications
- Push notifications (browser/mobile)
- Notification expiry / retention policy automation
- Bulk aggregation (50 cards = 50 individual notifications)

---

## Open Questions (non-blocking, implementation details)
- Workspace timezone setting UI — when to build? (assumption: settings page, separate feature)
- Due date reminder cron — exact trigger mechanism? (assumption: setInterval check every minute)
- Notification retention — auto-archive after N days? (assumption: no expiry for MVP)
