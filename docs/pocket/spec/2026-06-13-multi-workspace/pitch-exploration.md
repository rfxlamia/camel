# Pitch Exploration: multi-workspace
Date: 2026-06-13 | Project: Camel | Status: pitch-only

---

## Problem Statement
Camel saat ini mengasumsi satu user = satu board. Ketika login, user langsung masuk ke satu board tanpa pilihan. Untuk enterprise case di mana satu anggota team mengerjakan beberapa project, user butuh kemampuan untuk punya beberapa workspace, bisa switch antar workspace, dan bisa create atau join workspace baru.

## Root Tension
Menambah scope boundary (workspace) tanpa mengubah mental model yang sudah familiar (board → columns → cards). User harus bisa switch context tanpa kehilangan orientasi.

## Key Constraints
- Existing user punya data — harus migrate ke "Default Workspace" tanpa downtime
- Real-time (Redis Pub/Sub + SSE) harus scoped ke workspace — events tidak boleh bocor
- Small team (5-6 orang) — permissions harus simple, tidak boleh over-engineer
- UI pattern harus familiar — workspace switcher di sidebar, bukan inovasi yang aneh

## Success Looks Like
User bisa login, lihat list workspaces yang dia punya akses, pilih satu, dan langsung bekerja di board workspace tersebut. Switch ke workspace lain = seluruh konteks berpindah (columns, cards, activity, presence).

---

## Brainstorming Methods Used

### Question Storming — deep
Key insights:
- Q2 paling revealing: user bisa punya role berbeda di workspace berbeda (Admin di WS A, member di WS B) — ini mengubah model auth dari "global role" ke "per-workspace role"
- Q3: "personal workspace" vs "explicitly created" — pattern terkuat adalah auto-create personal workspace saat signup
- Q4: state switching — board state (scroll position, open cards) harus di-persist per workspace
- Q6: ownership model — workspace bisa flat (owner = creator) tanpa perlu organization layer

### First Principles Thinking — creative
Key insights:
- "Workspace harus punya project di dalamnya" → Tidak. Board = workspace. Simplifies mental model.
- "Perlu organization layer" → Tidak. Workspace bisa flat, organization bisa jadi fitur masa depan.
- "Multi-workspace = multi-account" → Tidak. Satu identitas, banyak konteks.
- Fundamental truth: workspace adalah boundary untuk akses dan konteks. Dua user di workspace yang sama bisa lihat data yang sama.

### Six Thinking Hats — structured
Key insights:
- White Hat: Schema saat ini tidak punya `boards` table — semua global. Perlu data model overhaul.
- Yellow Hat: Multi-workspace memungkinkan team kecil scale ke beberapa project tanpa tool baru.
- Black Hat: Complexity naik — routing, state management, data isolation. Migration blocker.
- Green Hat: Workspace switcher di sidebar, quick switch (Cmd+K), recent workspaces, workspace creation wizard.
- Red Hat: Developer tidak mau bingung di workspace mana. PM mau lihat semua project. Admin mau kontrol akses.
- Blue Hat: Priority: 1) Data model 2) Workspace CRUD 3) Switcher UI 4) Permissions 5) Migration.

### Analogical Thinking — creative
Key insights:
- Linear: Organization → Team → Project. Sidebar dropdown switcher. "Personal issues" vs team issues.
- Notion: Workspace terpisah, user bisa switch. "Shared with me" pages.
- Jira: Organization → Project. Project switcher di top-left. Project roles (admin, member, viewer).
- GitHub: Personal account + Organizations. Profile dropdown → "Switch context."
- Pattern: semua punya switcher di sidebar/top-left, semua punya "recent"/"pinned", semua pisahkan personal vs team.

### Reverse Brainstorming — creative
Key insights:
- Failure mode #1: Bikin switcher yang confusing — user tidak tahu mereka di workspace mana.
- Failure mode #2: Tidak ada data isolation — user di WS A bisa query cards dari WS B.
- Failure mode #3: Tidak migrate existing data — user lama kehilangan board.
- Failure mode #4: Permissions terlalu granular — admin, editor, viewer, commenter, guest... bingung.
- Insight: Visual indicator workspace aktif adalah critical UX. Data isolation adalah security requirement.

---

## Advisor Synthesis

### Key Insights (ranked by signal strength)
1. **Workspace is a context boundary, not just a feature toggle.** Switch workspace = switch entire scope of visible data. Data-model-level change.
2. **"Personal workspace" is the anchor pattern.** Auto-create on signup, auto-migrate existing users. Eliminates cold-start and migration blocker.
3. **Three roles are sufficient.** Owner (full control + delete), Admin (manage members + settings), Member (read/write cards).
4. **`workspace_id` must be a first-class FK on every table.** `boards`, `columns`, `cards`, `card_events` — all need it. Security + data isolation.
5. **The switcher lives in the sidebar top-left.** Every tool (Linear, Notion, Jira, GitHub) uses this pattern.

### Patterns
- Personal default → team opt-in (every tool does this)
- Three-tier permissions max (Owner/Admin/Member)
- Workspace switcher always visible, always in same place
- Data isolation via foreign key + query scoping

### Ideas Worth Pursuing
| Idea | Why |
|------|-----|
| Auto-create "Default Workspace" on signup | Eliminates cold-start, simplifies migration |
| `workspace_id` FK on all data tables | Security + data isolation + query scoping |
| Sidebar workspace switcher with avatar/initials | Consistent with industry pattern, low learning curve |
| Simple 3-role model (Owner/Admin/Member) | Sufficient for small teams, avoid over-engineering |
| Search/filter in workspace list | Prevents usability cliff at 10+ workspaces |
| "Leave workspace" action | Prevents workspace clutter, user autonomy |

### Discarded
| Idea | Why discard |
|------|-------------|
| Organization layer above workspace | Adds hierarchy complexity without clear user value now |
| Cross-workspace dashboard view | Future feature, not MVP |
| Workspace templates | Premature optimization, manual creation is fine |
| Complex permission matrix (viewer, commenter, guest) | Overkill for small teams, adds UI confusion |

---

## Spike Results

### Current Schema
```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│   users     │      │  columns    │      │    cards    │
├─────────────┤      ├─────────────┤      ├─────────────┤
│ id (PK)     │      │ id (PK)     │      │ id (PK)     │
│ username    │      │ title       │◄─────│ column_id   │
│ display_name│      │ position    │      │ title       │
│ password_hash│     │ wip_limit   │      │ description │
│ created_at  │      │ policy      │      │ position    │
└─────────────┘      │ is_done     │      │ version     │
                     └─────────────┘      │ deleted_at  │
                                          │ created_at  │
┌─────────────┐                           │ started_at  │
│  sessions   │                           │ done_at     │
├─────────────┤                           └─────────────┘
│ token (PK)  │
│ user_id ────│──► users.id                    │
│ expires_at  │                                ▼
└─────────────┘                           ┌─────────────┐
                                          │ card_events │
┌─────────────┐                           ├─────────────┤
│  settings   │                           │ id (PK)     │
├─────────────┤                           │ card_id ────│──► cards.id
│ key (PK)    │                           │ from_column │──► columns.id
│ text_value  │                           │ to_column   │──► columns.id
│ bool_value  │                           │ actor_id    │──► users.id
│ version     │                           │ event_type  │
│ updated_at  │                           │ payload     │
└─────────────┘                           │ created_at  │
                                          └─────────────┘
```

**Key finding:** Tidak ada `boards` table! Semua global. Asumsi = satu board untuk semua user.

### New Tables Needed

```sql
-- 1. Workspaces
CREATE TABLE workspaces (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  slug       TEXT UNIQUE,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Workspace membership + roles
CREATE TABLE workspace_members (
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

-- 3. Add workspace_id FK to existing tables
ALTER TABLE columns ADD COLUMN workspace_id INTEGER REFERENCES workspaces(id);
ALTER TABLE cards ADD COLUMN workspace_id INTEGER REFERENCES workspaces(id);
ALTER TABLE card_events ADD COLUMN workspace_id INTEGER REFERENCES workspaces(id);

-- 4. Indexes
CREATE INDEX idx_columns_workspace ON columns(workspace_id);
CREATE INDEX idx_cards_workspace ON cards(workspace_id);
CREATE INDEX idx_events_workspace ON card_events(workspace_id);
CREATE INDEX idx_workspace_members_user ON workspace_members(user_id);
```

### Migration Path
1. Add `workspace_id` as nullable FK to `columns`, `cards`, `card_events`
2. Create "Default Workspace" for each existing user
3. Add user as 'owner' in `workspace_members`
4. Assign all existing data → new workspace_id
5. Set NOT NULL constraint on `workspace_id` columns
6. Drop old global indexes, create workspace-scoped indexes

### Real-time Scoping
- Change channel: `camel:events` → `camel:workspace:{id}:events`
- Change presence prefix: `camel:presence:` → `camel:workspace:{id}:presence:{userId}`
- SSE handler filters by workspace_id

### Session State
- Client stores `activeWorkspaceId` in localStorage
- API calls include workspace context (header or path param)
- On reload, restore from localStorage or fetch user's workspaces

---

## Approach Directions

### Direction A: Full Multi-Workspace MVP (Recommended)
Implementasi lengkap: workspace CRUD, membership management, data isolation, real-time scoping, sidebar switcher, migration script.

+ Fitur lengkap, langsung viable untuk enterprise case
+ Clean architecture dari awal, tidak perlu refactor besar nanti
− Scope besar, delivery lebih lama
− Banyak yang harus di-test (migration, isolation, real-time)

### Direction B: Minimal Workspace (Phase 1)
Implementasi minimal: workspace CRUD + data isolation dulu, tanpa membership management dan real-time scoping.

+ Delivery cepat, bisa di-test segera
+ Foundation sudah ada, tinggal tambah fitur nanti
− Semua user bisa akses semua workspace (tidak ada access control)
− Real-time events bercampur antar workspace (confusing)

### Direction C: Personal + Shared Split
Pisahkan "Personal Workspace" (private) dan "Shared Workspace" (team). Personal auto-created, shared harus di-create atau di-invite.

+ Mental model jelas: personal vs team
+ Personal workspace tidak perlu access control (simplified)
− Dua tipe workspace = dua code path, lebih kompleks
− User mungkin bingung kapan pakai personal vs shared

---

## Open Questions for pocket-grinding
- [ ] Bagaimana data model untuk workspace-level settings yang berbeda per workspace? (WIP limits, column names)
- [ ] Apakah ada limit jumlah workspace yang bisa di-join satu user?
- [ ] Invitation via email, link, atau manual add oleh admin?
- [ ] Apakah user bisa search/filter workspace yang tersedia, atau hanya yang di-invite?
- [ ] Apakah ada "recent workspaces" atau "pinned workspaces" di switcher?
- [ ] Bagaimana handle workspace deletion? (cascade delete semua data atau archive?)
- [ ] Apakah perlu workspace-level activity feed terpisah, atau satu global feed yang di-filter?
- [ ] Bagaimana handle context panel di mobile? (sidebar switcher pattern tidak ideal untuk small screen)

---

## Recommended Direction
**Direction A: Full Multi-Workspace MVP** — Paling aligned dengan enterprise case requirement. Data model harus clean dari awal (`workspace_id` FK) dan real-time scoping adalah security requirement. Scope besar tapi well-defined, bisa dipecah jadi task-task kecil.

---

## Handoff Context (for pocket-grinding)
When pocket-grinding reads this doc:
- Start with this problem statement (Phase 1 context)
- Use Direction A (Full Multi-Workspace MVP) sebagai working hypothesis untuk Phase 5 Design Proposals
- Treat Open Questions di atas sebagai Phase 3 Discovery targets
- Do NOT treat Approach Directions sebagai final architecture — validate through GWT first
- Existing pitch (evolve-camel-workspace, 2026-06-11) harus complement, bukan conflict — check for overlaps
- Spike results di atas (schema, migration path, real-time scoping) adalah technical foundation — use as baseline

## Related Pitches
- **evolve-camel-workspace** (2026-06-11): Workspace enrichment (context panel, threads, integrations) — complement multi-workspace
- **team-collaboration** (2026-06-10): Presence, real-time updates, activity feed — foundation untuk workspace
- **multi-page-layout** (2026-06-11): Router, dashboard, sidebar — structural foundation untuk workspace switcher
