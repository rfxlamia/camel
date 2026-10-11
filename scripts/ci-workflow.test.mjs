import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import yaml from "js-yaml";

const workflowText = readFileSync(
	new URL("../.github/workflows/ci.yml", import.meta.url),
	"utf8",
);
const workflow = yaml.load(workflowText);
const jobs = workflow.jobs;
const allRunCommands = Object.values(jobs)
	.flatMap((job) => job.steps ?? [])
	.map((step) => step.run ?? "")
	.join("\n");

test("path-aware CI has the expected jobs and event filters", () => {
	assert.deepEqual(
		Object.keys(jobs).sort(),
		[
			"changes",
			"ci-ok",
			"client-unit",
			"db-integration",
			"guards-lint-typecheck",
			"llm-integration",
			"server-unit",
		].sort(),
	);
	assert.ok(
		Object.hasOwn(workflow.on, "pull_request"),
		"pull_request trigger must exist",
	);
	assert.ok(
		workflow.on.pull_request == null ||
			workflow.on.pull_request.branches === undefined,
		"pull_request must not be limited to a base branch",
	);
	assert.deepEqual(workflow.on.push.branches, ["main"]);
	assert.match(workflowText, /dorny\/paths-filter@[0-9a-f]{40} # v3/);
	assert.deepEqual(workflow.permissions, {
		contents: "read",
		"pull-requests": "read",
	});
	const filterConfig = yaml.load(
		jobs.changes.steps.find((step) => step.id === "filter").with.filters,
	);
	assert.deepEqual(filterConfig, {
		shared: [
			"package.json",
			"package-lock.json",
			".github/**",
			"biome.json",
			".nvmrc",
			"Dockerfile",
			"docker-compose.yml",
		],
		server: ["server/**"],
		client: ["client/**"],
		scripts: ["scripts/**", ".husky/**"],
	});
});

test("every worker gates only on changes and forces execution on main pushes", () => {
	for (const name of [
		"guards-lint-typecheck",
		"server-unit",
		"client-unit",
		"db-integration",
		"llm-integration",
	]) {
		assert.deepEqual(
			jobs[name].needs,
			["changes"],
			`${name} needs only changes`,
		);
		assert.match(jobs[name].if, /github\.event_name == 'push'/);
		assert.match(jobs[name].if, /needs\.changes\.outputs\.shared == 'true'/);
	}
	for (const [name, output] of [
		["guards-lint-typecheck", "scripts"],
		["guards-lint-typecheck", "server"],
		["guards-lint-typecheck", "client"],
		["server-unit", "server"],
		["client-unit", "client"],
		["db-integration", "server"],
		["llm-integration", "server"],
	]) {
		assert.match(
			jobs[name].if,
			new RegExp(`needs\\.changes\\.outputs\\.${output} == 'true'`),
		);
	}
});

test("ci-ok always evaluates all jobs and rejects failures or cancellations", () => {
	assert.equal(jobs["ci-ok"].name, "ci-ok");
	assert.equal(jobs["ci-ok"].if, "always()");
	assert.deepEqual(
		[...jobs["ci-ok"].needs].sort(),
		[
			"changes",
			"guards-lint-typecheck",
			"server-unit",
			"client-unit",
			"db-integration",
			"llm-integration",
		].sort(),
	);
	const failureStep = jobs["ci-ok"].steps[0];
	assert.match(failureStep.run, /exit 1/);
	assert.match(
		jobs["ci-ok"].steps[1].name,
		/successful or intentionally skipped/,
	);
	const aggregateCondition = failureStep.if;
	for (const name of [
		"changes",
		"guards-lint-typecheck",
		"server-unit",
		"client-unit",
		"db-integration",
		"llm-integration",
	]) {
		assert.match(
			aggregateCondition,
			new RegExp(`needs\\.${name}\\.result == 'failure'`),
		);
		assert.match(
			aggregateCondition,
			new RegExp(`needs\\.${name}\\.result == 'cancelled'`),
		);
	}
});

test("CI preserves all prior guard and test commands with explicit worker limits", () => {
	for (const command of [
		"check:mutation-routing",
		"check:event-write-routing",
		"check:feature-modules",
		"check:inline-400",
		"test:guards",
		"test:feature-modules",
		"npm run lint",
		"npm run typecheck",
		"--maxWorkers=4",
		"--maxWorkers=2",
	]) {
		assert.ok(
			allRunCommands.includes(command),
			`missing CI command ${command}`,
		);
	}
});

test("DB job uses the tested selector and preserves serialized Vitest execution", () => {
	const dbCommands = jobs["db-integration"].steps
		.map((step) => step.run ?? "")
		.join("\n");
	assert.match(dbCommands, /list-integration-tests\.mjs/);
	const serverPackage = JSON.parse(
		readFileSync(new URL("../server/package.json", import.meta.url), "utf8"),
	);
	assert.match(
		serverPackage.scripts["test:integration:routes"],
		/--no-file-parallelism/,
	);
	assert.match(dbCommands, /Selected integration test files:/);
});

test("local Vitest worker configuration remains untouched", () => {
	for (const config of ["server/vitest.config.ts", "client/vitest.config.ts"]) {
		const text = readFileSync(new URL(`../${config}`, import.meta.url), "utf8");
		assert.match(text, /maxWorkers:\s*1/);
	}
});
