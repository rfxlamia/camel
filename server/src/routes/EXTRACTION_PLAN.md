# Route Extraction Plan

## Goal

Split remaining handlers from `routes.ts` into individual modules under `routes/`.

## Shared Helpers

All shared utilities are in `routes/helpers.ts`. Import from there.

## Pattern to Follow

Each new module should:

1. Create `routes/<name>.ts`
2. Export a Router with `mergeParams: true`
3. Define routes relative to `/workspaces/:workspaceId`
4. Use helpers from `./helpers.js`
5. Use pool from `../db/pool.js`
6. Use middleware from `../middleware/workspace.js`

## Mount Pattern

In `routes.ts`, add:

```ts
import { <name>Router } from "./routes/<name>.js";
// ...
api.use("/workspaces/:workspaceId", <name>Router);
```

## Verification

After each extraction:

1. Run `make typecheck` - must pass
2. Run `make test` - must pass
3. Check line count of routes.ts

## Modules to Extract

### 1. workspaces.ts

Handlers:

- GET /workspaces
- POST /workspaces
- DELETE /workspaces/:workspaceId

Dependencies from helpers.ts:

- serializeWorkspaceList
- getWorkspaceCapacity
- countUserMemberships
- lookupMembership
- parseWorkspaceId

### 2. members.ts

Handlers:

- GET /workspaces/:workspaceId/members
- POST /workspaces/:workspaceId/members
- DELETE /workspaces/:workspaceId/members/:userId

Dependencies from helpers.ts:

- lookupMembership
- checkActorCanManage
- checkInviteeCap
- countUserMemberships
- workspaceAccessService

### 3. invites.ts

Handlers:

- POST /workspaces/:workspaceId/invites/:inviteId/accept
- DELETE /workspaces/:workspaceId/invites/:inviteId

Dependencies from helpers.ts:

- lookupMembership
- checkActorCanManage

### 4. board.ts

Handlers:

- GET /workspaces/:workspaceId/board

Dependencies from helpers.ts:

- getHumanColumns

### 5. cards.ts

Handlers:

- GET /workspaces/:workspaceId/cards/:id
- POST /workspaces/:workspaceId/cards
- PATCH /workspaces/:workspaceId/cards/:id
- DELETE /workspaces/:workspaceId/cards/:id
- POST /workspaces/:workspaceId/cards/:id/move

Dependencies from helpers.ts:

- parseWorkspaceId
- lookupMembership
- createScopedBoardService
- recordActivity
- checkWipLimit

Dependencies from core/:

- positionBetween, rebalance, neighborsAt, POSITION_GAP (from core/position.js)

Dependencies from realtime:

- publishEvent
