// Integration coverage for transactional column is_done remapping.
// Scenario suites are imported so this remains the required test entrypoint.
import "dotenv/config";
import { afterAll } from "vitest";

import { destroyWorkspace } from "./columns-is-done-remap.test-support.js";

// The scenario modules install per-test setup and cleanup hooks.
import "./columns-is-done-remap.basic.scenarios.js";
import "./columns-is-done-remap.edge.scenarios.js";
import "./columns-is-done-remap.failure.scenarios.js";

// Keep teardown after every imported scenario suite has completed.
afterAll(destroyWorkspace);
