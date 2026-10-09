# Manage Members — Settings Design

**Date:** 2026-08-05  
**Status:** Approved  
**Scope:** Display workspace members in Settings with remove and role-change capabilities.

## Problem

Settings currently has an **Invite Member** section but no way to view existing members, remove them, or change their roles. Admins and owners must manage membership blind.

## Goals

- Show all workspace members in a dedicated **Manage Members** card in Settings.
- Allow **admin** and **owner** to remove members (except the owner).
- Allow **owner** only to promote/demote between **Member** and **Admin**.
- All workspace members can view the list (read-only for regular members).

## Non-Goals

- Managing pending invites (list/cancel) — future work.
- Transferring ownership — already exists via `POST /transfer-ownership`.
- Self-removal ("leave workspace") — out of scope.
- Extracting Invite Member into its own component — can be done later.

## Permission Matrix

| Action | Member | Admin | Owner |
|--------|--------|-------|-------|
| View member list | ✅ | ✅ | ✅ |
| Remove member | ❌ | ✅ (not owner) | ✅ (not owner) |
| Change role (Member ↔ Admin) | ❌ | ❌ | ✅ |
| Remove self | ❌ | ❌ | ❌ |

**Backend enforcement:** `checkCanRemoveUser` gains a self-removal guard — if `actorId === targetUserId`, return 403 `"Cannot remove yourself"`. Applies to admin and owner alike.

### Row-Level UI Rules

| Target row | Member viewer | Admin viewer | Owner viewer |
|------------|---------------|--------------|--------------|
| Owner | Badge "Owner" | Badge "Owner" | Badge "Owner" |
| Admin | Badge "Admin" | Badge + Remove | Dropdown + Remove |
| Member | Badge "Member" | Badge + Remove | Dropdown + Remove |
| Self | Badge only | Badge only (no Remove) | Badge "Owner" |

## UI Design

### Placement

New collapsible **Manage Members** card in `SettingsPage`, positioned **between Invite Member and Identity**, using the existing `SettingsSection` pattern.

### Member Row Layout

Each row displays:
- Initials avatar (reuse pattern from `AssigneePicker`)
- **Display name** (bold) + `@username` (muted)
- Role control: static badge or dropdown (owner viewer only, for non-owner rows)
- **Remove** button (admin/owner viewers only, hidden for owner row and self)

### Interactions

- **Remove** → confirmation modal (same pattern as Danger Zone modals in Settings).
- **Role change** → immediate PATCH on dropdown change; toast on success/error; revert dropdown on failure.
- **Loading** → skeleton/spinner while fetching members.
- **Empty state** → "No members yet".
- After successful invite (from Invite Member section) → refresh member list and workspace `memberCount`.

## Architecture

### Component Extraction

`SettingsPage.tsx` is ~760 lines. Extract member management into a dedicated component:

```
client/src/
├── pages/SettingsPage.tsx
└── components/settings/
    ├── ManageMembersSection.tsx
    └── ManageMembersSection.test.tsx
```

### `ManageMembersSection` Props

```ts
interface ManageMembersSectionProps {
  workspaceId: number;
  currentUserId: number;
  currentUserRole: WorkspaceRole;
  refreshKey?: number;           // increment to trigger re-fetch (e.g. after invite)
  onMembersChanged?: () => void; // callback to reload workspace list (memberCount)
  showToast: (msg: string, type: ToastType) => void;
}
```

`SettingsPage` renders the card for all members (not gated by `canEdit`), passing role-aware props. Invite Member section remains owner/admin-only as today.

## Backend API

### Existing Endpoints (unchanged)

| Method | Path | Access |
|--------|------|--------|
| `GET` | `/workspaces/:workspaceId/members` | Any workspace member |
| `DELETE` | `/workspaces/:workspaceId/members/:userId` | Admin + Owner |

### New Endpoint

```
PATCH /workspaces/:workspaceId/members/:userId
Content-Type: application/json

{ "role": "admin" | "member" }

→ 200 { userId, username, displayName, role }
```

#### Authorization Rules

1. Actor must be workspace **owner** (admin/member → 404, matching `checkActorCanManage` stealth pattern for unauthorized actors on sensitive ops).
2. Target must exist in workspace (404).
3. Cannot change **owner** role (403: "Cannot change workspace owner role").
4. `role` must be `"admin"` or `"member"` (400).
5. Idempotent: if role unchanged, return 200 with current data.

#### Implementation

Add to `server/src/routes/helpers.ts`:
- `checkActorCanChangeRole(role)` — returns `{ allowed: true }` only for `"owner"`.
- `updateMemberRole()` method on `workspaceAccessService`, following the `removeMember` pattern.

Add route handler in `server/src/routes/members.ts`.

### Client API Additions (`client/src/api.ts`)

```ts
removeWorkspaceMember: (workspaceId: number, userId: number) =>
  request<void>(`/workspaces/${workspaceId}/members/${userId}`, { method: "DELETE" }),

updateWorkspaceMemberRole: (
  workspaceId: number,
  userId: number,
  body: { role: "admin" | "member" },
) =>
  request<WorkspaceMember>(
    `/workspaces/${workspaceId}/members/${userId}`,
    { method: "PATCH", body: JSON.stringify(body) },
  ),
```

## Data Flow

```
SettingsPage
  └─ ManageMembersSection
       ├─ mount / refreshKey change → GET /members
       ├─ Remove confirm → DELETE /members/:userId → refresh list + onMembersChanged()
       └─ Role dropdown change → PATCH /members/:userId → update local state + toast
```

## Error Handling

| Scenario | UX |
|----------|-----|
| Network failure | Toast: "Couldn't load members. Try again." + retry button |
| 403 remove owner | Toast: server error message |
| 404 remove (concurrent) | Toast: "Member not found" + refresh list |
| 403/404 role change | Revert dropdown + toast with server message |
| Actor lost permission mid-session | Controls hidden on next fetch (role from context) |

## Testing

### Server (`workspaceAccess.test.ts` + route tests)

- `checkActorCanChangeRole`: owner allowed, admin/member blocked.
- `checkCanRemoveUser`: add self-removal guard (403).
- `updateMemberRole`: happy path, cannot change owner, cannot change own role, non-owner actor gets 404, invalid role 400.
- DELETE existing tests remain valid (admin can remove, cannot remove owner).

### Client (`ManageMembersSection.test.tsx`)

- Member viewer: all rows show badges only, no Remove/dropdown.
- Admin viewer: Remove visible for non-owner/non-self; no role dropdown.
- Owner viewer: dropdown for admin/member rows; Remove for non-owner/non-self.
- Remove confirmation modal: cancel vs confirm.
- Role change: calls PATCH, shows toast.
- `refreshKey` prop triggers re-fetch.

## File Change Summary

| File | Change |
|------|--------|
| `server/src/routes/helpers.ts` | Add `checkActorCanChangeRole`, `updateMemberRole` |
| `server/src/routes/members.ts` | Add `PATCH /members/:userId` |
| `server/src/routes/workspaceAccess.test.ts` | Tests for new auth + service |
| `client/src/api.ts` | Add `removeWorkspaceMember`, `updateWorkspaceMemberRole` |
| `client/src/api.test.ts` | Document new endpoints |
| `client/src/components/settings/ManageMembersSection.tsx` | New component |
| `client/src/components/settings/ManageMembersSection.test.tsx` | New tests |
| `client/src/pages/SettingsPage.tsx` | Render card, pass props, wire invite refresh |
