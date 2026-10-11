import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const gitPath = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
const makePath = execFileSync("which", ["make"], { encoding: "utf8" }).trim();

function withFixture(run) {
	const root = mkdtempSync(join(tmpdir(), "docs-workflow-"));
	try {
		copyFileSync(join(repoRoot, ".gitignore"), join(root, ".gitignore"));
		copyFileSync(join(repoRoot, "Makefile"), join(root, "Makefile"));
		execFileSync(gitPath, ["init", "-q"], { cwd: root });
		execFileSync(gitPath, ["config", "user.name", "Docs Workflow Test"], {
			cwd: root,
		});
		execFileSync(
			gitPath,
			["config", "user.email", "docs-workflow@example.invalid"],
			{ cwd: root },
		);
		run(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function git(root, args, options = {}) {
	return spawnSync(gitPath, args, { cwd: root, encoding: "utf8", ...options });
}

function runDocsCommit(root, message, env = {}) {
	const childEnv = { ...process.env, ...env };
	if (message !== undefined) childEnv.DOCS_COMMIT_MESSAGE = message;
	else delete childEnv.DOCS_COMMIT_MESSAGE;
	return spawnSync(makePath, ["-s", "docs-commit"], {
		cwd: root,
		env: childEnv,
		encoding: "utf8",
	});
}

function seed(root) {
	for (const path of [
		"docs/pocket/notes/keep.md",
		"docs/superpowers/notes/keep.md",
		"docs/superpowers/notes/remove.md",
		"docs/pocket/secrets/.env",
		"docs/superpowers/secrets/client.pem",
		"docs/local/private.md",
		"unrelated/file.txt",
	]) {
		const fullPath = join(root, path);
		mkdirSync(fullPath.slice(0, fullPath.lastIndexOf("/")), {
			recursive: true,
		});
		writeFileSync(fullPath, `baseline ${path}\n`);
	}
	execFileSync(
		gitPath,
		[
			"add",
			".gitignore",
			"Makefile",
			"docs/pocket/notes/keep.md",
			"docs/superpowers/notes/keep.md",
			"docs/superpowers/notes/remove.md",
			"unrelated/file.txt",
		],
		{ cwd: root },
	);
	execFileSync(
		gitPath,
		[
			"add",
			"-f",
			"docs/pocket/secrets/.env",
			"docs/superpowers/secrets/client.pem",
			"docs/local/private.md",
		],
		{ cwd: root },
	);
	execFileSync(gitPath, ["commit", "-qm", "baseline"], { cwd: root });
}

test("sensitive docs files are ignored while normal docs remain addable in both owned trees", () => {
	withFixture((root) => {
		const sensitive = [];
		for (const tree of ["pocket", "superpowers"]) {
			sensitive.push(
				`docs/${tree}/scratch/.env`,
				`docs/${tree}/scratch/.env.local`,
				`docs/${tree}/scratch/debug.log`,
				`docs/${tree}/scratch/cert.pem`,
				`docs/${tree}/scratch/node_modules/pkg/file.js`,
			);
		}
		for (const path of sensitive) {
			const fullPath = join(root, path);
			mkdirSync(fullPath.slice(0, fullPath.lastIndexOf("/")), {
				recursive: true,
			});
			writeFileSync(fullPath, "placeholder\n");
			assert.equal(
				git(root, ["check-ignore", "-q", path]).status,
				0,
				`${path} should be ignored`,
			);
		}
		for (const path of [
			"docs/pocket/scratch/normal.md",
			"docs/superpowers/scratch/normal.md",
		]) {
			assert.equal(
				git(root, ["check-ignore", "-q", path]).status,
				1,
				`${path} should remain eligible`,
			);
		}
	});
});

test("docs-commit stages only owned docs, supports tracked sensitive files, and preserves other staged paths", () => {
	withFixture((root) => {
		seed(root);
		writeFileSync(join(root, "docs/pocket/notes/keep.md"), "updated\n");
		writeFileSync(join(root, "docs/pocket/secrets/.env"), "still tracked\n");
		writeFileSync(
			join(root, "docs/superpowers/notes/keep.md"),
			"updated superpowers\n",
		);
		rmSync(join(root, "docs/superpowers/notes/remove.md"));
		rmSync(join(root, "docs/superpowers/secrets/client.pem"));
		writeFileSync(join(root, "docs/pocket/notes/new.md"), "new\n");
		writeFileSync(
			join(root, "docs/superpowers/notes/new.md"),
			"new superpowers\n",
		);
		const freshSensitive = [];
		for (const tree of ["pocket", "superpowers"]) {
			for (const name of [
				".env",
				".env.local",
				"debug.log",
				"cert.pem",
				"node_modules/pkg/file.js",
			]) {
				const path = `docs/${tree}/scratch/${name}`;
				const fullPath = join(root, path);
				mkdirSync(fullPath.slice(0, fullPath.lastIndexOf("/")), {
					recursive: true,
				});
				writeFileSync(fullPath, "placeholder secret\n");
				freshSensitive.push(path);
			}
		}
		writeFileSync(join(root, "unrelated/file.txt"), "staged unrelated\n");
		writeFileSync(join(root, "docs/local/private.md"), "local only changed\n");
		execFileSync(gitPath, ["add", "unrelated/file.txt"], { cwd: root });
		execFileSync(gitPath, ["add", "-f", "docs/local/private.md"], {
			cwd: root,
		});

		const literalMessage = 'docs: literal "$HOME" $(touch should-not-exist)';
		const result = runDocsCommit(root, literalMessage);
		assert.equal(result.status, 0, result.stderr || result.stdout);
		assert.equal(
			git(root, ["show", "-s", "--format=%B", "HEAD"]).stdout,
			`${literalMessage}\n`,
		);
		assert.equal(existsSync(join(root, "should-not-exist")), false);
		const committedPaths = git(root, [
			"show",
			"--format=",
			"--name-status",
			"HEAD",
		])
			.stdout.trim()
			.split("\n")
			.sort();
		assert.deepEqual(
			committedPaths,
			[
				"A\tdocs/pocket/notes/new.md",
				"A\tdocs/superpowers/notes/new.md",
				"D\tdocs/superpowers/notes/remove.md",
				"D\tdocs/superpowers/secrets/client.pem",
				"M\tdocs/pocket/notes/keep.md",
				"M\tdocs/pocket/secrets/.env",
				"M\tdocs/superpowers/notes/keep.md",
			].sort(),
		);
		for (const path of freshSensitive) {
			assert.equal(
				git(root, ["ls-files", "--error-unmatch", path]).status,
				1,
				`${path} must not be tracked`,
			);
			assert.equal(
				committedPaths.some((entry) => entry.endsWith(path)),
				false,
				`${path} must not be committed`,
			);
		}
		assert.deepEqual(
			git(root, ["diff", "--cached", "--name-only"])
				.stdout.trim()
				.split("\n")
				.sort(),
			["docs/local/private.md", "unrelated/file.txt"],
		);
		assert.equal(
			git(root, ["ls-tree", "-r", "--name-only", "HEAD"]).stdout.includes(
				"docs/local/",
			),
			true,
		);
	});
});

test("invalid messages fail without changing the index or creating a commit", () => {
	withFixture((root) => {
		seed(root);
		writeFileSync(join(root, "docs/pocket/notes/pending.md"), "pending\n");
		const beforeHead = git(root, ["rev-parse", "HEAD"]).stdout;
		const beforeStatus = git(root, ["status", "--porcelain"]).stdout;
		for (const message of [undefined, "", "   "]) {
			const result = runDocsCommit(root, message);
			assert.notEqual(result.status, 0);
			assert.equal(git(root, ["rev-parse", "HEAD"]).stdout, beforeHead);
			assert.equal(git(root, ["status", "--porcelain"]).stdout, beforeStatus);
		}
	});
});

test("no owned docs changes is a successful no-op even with unrelated staged changes", () => {
	withFixture((root) => {
		seed(root);
		writeFileSync(join(root, "unrelated/file.txt"), "unrelated staged\n");
		execFileSync(gitPath, ["add", "unrelated/file.txt"], { cwd: root });
		const beforeHead = git(root, ["rev-parse", "HEAD"]).stdout;
		const result = runDocsCommit(root, "docs: nothing changed");
		assert.equal(result.status, 0, result.stderr || result.stdout);
		assert.match(result.stdout, /no docs changes/i);
		assert.equal(git(root, ["rev-parse", "HEAD"]).stdout, beforeHead);
		assert.equal(
			git(root, ["diff", "--cached", "--name-only"]).stdout.trim(),
			"unrelated/file.txt",
		);
	});
});

test("docs diff errors propagate instead of being treated as changes or a no-op", () => {
	withFixture((root) => {
		seed(root);
		writeFileSync(join(root, "docs/pocket/notes/pending.md"), "pending\n");
		const beforeHead = git(root, ["rev-parse", "HEAD"]).stdout;
		const shimDir = join(root, "shim");
		mkdirSync(shimDir);
		const shim = join(shimDir, "git");
		writeFileSync(
			shim,
			`#!/bin/sh\nif [ "$1" = diff ]; then exit 42; fi\nexec "${gitPath}" "$@"\n`,
		);
		chmodSync(shim, 0o755);
		const result = runDocsCommit(root, "docs: injected diff failure", {
			PATH: `${shimDir}${delimiter}${process.env.PATH}`,
		});
		assert.notEqual(result.status, 0);
		assert.match(`${result.stdout}\n${result.stderr}`, /42|Error/i);
		assert.equal(git(root, ["rev-parse", "HEAD"]).stdout, beforeHead);
		assert.equal(
			git(root, ["diff", "--cached", "--name-only"]).stdout.trim(),
			"docs/pocket/notes/pending.md",
		);
	});
});
