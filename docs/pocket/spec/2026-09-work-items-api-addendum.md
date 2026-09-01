# Work-items API addendum

**Date:** 2026-09-01
**Status:** approved
**Parent spec:** [unified-view.md](./2026-08-31-board-tracker-unified-view/unified-view.md)
**ADR:** [2026-09-board-tracker-dual-table.md](../adr/2026-09-board-tracker-dual-table.md)

## Summary

Introduce `/work-items` as the canonical REST path for unified board+tracker reads and writes. `/tracker/items` remains a supported legacy alias.

## Routes

| Canonical | Legacy alias | Notes |
|-----------|--------------|-------|
| `GET /work-items` | `GET /tracker/items` | Merged list |
| `POST /work-items` | `POST /tracker/items` | Create tracker-native item |
| `GET /work-items/:key` | `GET /tracker/items/:key` | Detail |
| `PATCH /work-items/:key` | `PATCH /tracker/items/:key` | Update / status reverse |
| `PATCH /work-items/:key/position` | `PATCH /tracker/items/:key/position` | Reorder |
| `DELETE /work-items/:key` | `DELETE /tracker/items/:key` | Soft delete |
| `GET /work-items/:key/events` | `GET /tracker/items/:key/events` | Changelog |

## Client migration

- New code MUST use `api.listWorkItems`, `api.getWorkItem`, etc.
- `api.listTrackerItems` and siblings remain for backward compatibility.
- Target removal of legacy client methods: 2 sprints after all internal surfaces migrate.

## Unified activity

- `GET /activity` — board (`card_events`) only (unchanged)
- `GET /activity/unified` — merged board + tracker events, sorted by `created_at DESC`
