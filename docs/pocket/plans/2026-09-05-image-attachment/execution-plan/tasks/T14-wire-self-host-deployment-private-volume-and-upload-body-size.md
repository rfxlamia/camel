# Task T14 — Wire self-host deployment, private volume, and upload body size

**Phase:** 2
**Depends:** T2, T5, T6, T8
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 14: Wire self-host deployment, private volume, and upload body size [depends: T2, T5, T6, T8]

## OBJECTIVE

Make the private storage contract self-host friendly in the tracked container/deployment configuration and raise nginx request-body limits for realistic multi-select batches without modifying ignored operator-specific GGF files.

Files:

- Modify: `Dockerfile`
- Modify: `deploy/docker-compose.prod.yml`
- Modify: `deploy/.env.production.template`
- Modify: `deploy/nginx/camel.conf`

This is a structural/deployment task: `[no-tdd — structural task]`.

Steps:

1. Add the runner directory creation and configurable environment wiring:
   - create `/app/server/private-uploads` in `Dockerfile`
   - pass `ATTACHMENTS_DIR` with default `/app/server/private-uploads` in tracked production Compose
   - add the optional variable/documentation to `deploy/.env.production.template`
   - mount a distinct named `camel_private_uploads` volume at `/app/server/private-uploads`, separate from `camel_uploads`.
2. Raise `client_max_body_size` to approximately `35m` on both nginx API proxy surfaces that can receive attachment multipart requests: the `camel.web.id` `/api/` block and the `api.camel.web.id` proxy block. Do not alter static public uploads caching rules.
3. Verify the deployment configuration:
   `docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production.template config`
   Expected: valid Compose configuration with distinct `camel_uploads` and `camel_private_uploads` mounts and the private path passed to the server.
4. Verify the private/public boundaries and nginx limits:
   `rg -n "private-uploads|camel_private_uploads|client_max_body_size|client/public/uploads" Dockerfile deploy/docker-compose.prod.yml deploy/.env.production.template deploy/nginx/camel.conf`
   Expected: private mount/path is outside `client/public`, public upload volume remains separate, and both API proxy surfaces contain the body-size limit.
5. Run the relevant static checks:
   `npm run typecheck`
   Expected: PASS for both server and client; no application source behavior changes are introduced.
6. Commit:
   `git add Dockerfile deploy/docker-compose.prod.yml deploy/.env.production.template deploy/nginx/camel.conf`
   `git commit -m "chore(deploy): provision private attachment storage"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md` — self-host private volume, no public static serving, ~35MB nginx body size, and rollback.
- `server/src/config.ts` and `server/src/lib/attachment-storage.ts` — T2 configurable path/default.
- `Dockerfile` — current runner path and public upload directory creation.
- `deploy/docker-compose.prod.yml` — tracked production server volume contract.
- `deploy/.env.production.template` — self-host environment documentation.
- `deploy/nginx/camel.conf` — both production API proxy surfaces.

## WHY THIS APPROACH

Complexity: lightweight
Justification: This task changes only deployment artifacts and has no application behavior to unit-test. The verification commands validate Compose rendering, private/public separation, nginx coverage, and application typechecks.

## SANDWICH CONTEXT

[CRITICAL: The private attachment volume must be separate from `/app/client/public/uploads`; no private directory may be registered with `express.static`.]
You are wiring self-host deployment for Image Attachment on Board Cards.
Spec: `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md`
Design decision: configurable local-disk provider with a distinct named volume; production Compose is the tracked canonical contract.
Files in scope: `Dockerfile`, `deploy/docker-compose.prod.yml`, `deploy/.env.production.template`, `deploy/nginx/camel.conf`.
Available after: T2 path/provider, T5 delivery, T6 upload, T8 card-create.
Architecture rule: leave root `docker-compose.yml` unchanged because it has no server service, and leave ignored `deploy/docker-compose.ggf.yml` operator-specific.
[RESTATE: The private attachment volume must be separate from `/app/client/public/uploads`; no private directory may be registered with `express.static`.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given a self-host runs tracked production Compose, When it renders the configuration, Then private attachment storage has a distinct named volume/path and remains outside public uploads.
Given a realistic multi-select request, When nginx receives it, Then both API proxy surfaces allow approximately 35MB rather than the 1MB default.
Given GGF operators use the ignored operator-specific Compose file, Then the plan documents the required private mount without untracking or committing that file.

All verification commands PASS. Commit exists with message matching `chore(deploy): ...`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- Distinct private named volume and configurable path are visible to self-hosters.
- Both relevant nginx API proxy surfaces have the body-size limit.
- Public logo upload volume and static serving remain unchanged.

Must-not-have:

- Tracking/committing `deploy/docker-compose.ggf.yml`, mounting private files under `client/public`, or exposing a private static route.

Open question risks:

- Operators using the ignored GGF Compose file must manually mirror the canonical production mount; if the deployment process requires a tracked GGF artifact, report NEEDS_CONTEXT rather than unignoring it implicitly.

Rollback note:

- Revert nginx body-size change independently if needed; hide attachment UI/routes and leave additive volume/schema in place.

## STOP CONDITIONS

Done when Compose config, boundary grep, and typechecks pass and the deployment commit exists.
Uncertain when Docker Compose cannot render with the repository's documented env template; report the exact missing variable/error.
Escalate when self-host support requires committing ignored operator credentials/config or serving private files publicly.
