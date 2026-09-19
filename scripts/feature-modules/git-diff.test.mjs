import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
	collectGitDiff,
	parseNameStatusOutput,
	unquoteGitPath,
} from "./git-diff.mjs";
import { countRawLines, LINE_BUDGET_MAX } from "./line-budget.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const cliScript = join(repoRoot, "scripts/check-feature-modules.mjs");

describe("Cycle 1 — git-diff parser (unit)", () => {
	it("classifies add/modify/rename/copy/delete and applies ignore rules", () => {
		const fixture = [
			"A\tclient/src/features/board/new.ts",
			"M\tserver/src/modules/tracker/item.ts",
			"R100\tserver/src/old.ts\tserver/src/modules/tracker/renamed.ts",
			"R085\tserver/src/edited-old.ts\tserver/src/modules/tracker/renamed-edit.ts",
			"C100\tserver/src/copy-src.ts\tserver/src/modules/tracker/copied.ts",
			"D\tserver/src/modules/tracker/removed.ts",
			'A\t"path with spaces/client.ts"',
			"A\tcamel-lottie/foo.ts",
			"A\tREADME.md",
			"A\tclient/src/styles.css",
		].join("\n");

		const result = parseNameStatusOutput(fixture);

		assert.deepEqual(result.new, [
			"client/src/features/board/new.ts",
			"path with spaces/client.ts",
		]);
		assert.deepEqual(result.modified, ["server/src/modules/tracker/item.ts"]);
		assert.deepEqual(result.renamed, [
			{
				from: "server/src/old.ts",
				to: "server/src/modules/tracker/renamed.ts",
				similarity: 100,
				kind: "rename",
			},
			{
				from: "server/src/edited-old.ts",
				to: "server/src/modules/tracker/renamed-edit.ts",
				similarity: 85,
				kind: "rename-with-edit",
			},
		]);
		assert.deepEqual(result.copied, [
			{
				from: "server/src/copy-src.ts",
				to: "server/src/modules/tracker/copied.ts",
				similarity: 100,
			},
		]);
		assert.deepEqual(result.deleted, ["server/src/modules/tracker/removed.ts"]);
	});

	it("defaults merge-base ref to origin/main and accepts override", () => {
		assert.equal(
			parseNameStatusOutput("", { baseRef: undefined }).baseRef,
			"origin/main",
		);
		assert.equal(
			parseNameStatusOutput("", { baseRef: "feature/foo" }).baseRef,
			"feature/foo",
		);
	});

	it("lists source files excluding deleted and non-ts paths", () => {
		const fixture = [
			"A\tclient/src/a.ts",
			"D\tclient/src/gone.ts",
			"A\tclient/src/a.tsx",
			"A\tclient/src/readme.md",
		].join("\n");
		const result = parseNameStatusOutput(fixture);
		assert.deepEqual(result.sourceFiles.sort(), [
			"client/src/a.ts",
			"client/src/a.tsx",
		]);
		assert.ok(!result.sourceFiles.includes("client/src/gone.ts"));
	});

	it("decodes C-quoted octal and tab escapes in git pathnames", () => {
		assert.equal(unquoteGitPath('"caf\\303\\251.ts"'), "café.ts");
		assert.equal(
			unquoteGitPath('"client/src/foo\\tbar.ts"'),
			"client/src/foo\tbar.ts",
		);

		const result = parseNameStatusOutput('A\t"caf\\303\\251.ts"\n');
		assert.deepEqual(result.new, ["café.ts"]);
	});
});

describe("Cycle Map — map data (unit)", () => {
	it("lists locked features, kernel-in-waiting, and scan roots", async () => {
		const map = await import("./map.mjs");

		const expectedFeatures = [
			"board",
			"tracker",
			"my-work",
			"agent",
			"chat",
			"focus",
			"settings",
			"workspaces",
			"notifications",
			"activity",
			"auth",
		];
		assert.deepEqual([...map.FEATURES].sort(), [...expectedFeatures].sort());
		assert.deepEqual(map.SCAN_ROOTS, ["client/src", "server/src"]);
		assert.deepEqual(map.KERNEL_IN_WAITING, []);
		assert.ok(
			existsSync(join(repoRoot, "client/src/shared/workItemMutations.ts")),
		);
		assert.ok(
			!existsSync(join(repoRoot, "client/src/lib/workItemMutations.ts")),
		);
		assert.ok(
			existsSync(join(repoRoot, "client/src/shared/trackerUtils.ts")),
			"expected kernel home client/src/shared/trackerUtils.ts",
		);
		assert.ok(
			!existsSync(join(repoRoot, "client/src/lib/trackerUtils.ts")),
			"expected leftover client/src/lib/trackerUtils.ts to be gone",
		);
		for (const name of [
			"trackerRollup.ts",
			"trackerSearch.ts",
			"trackerViewPrefs.ts",
			"trackerItemMutationQueue.ts",
		]) {
			assert.ok(
				existsSync(join(repoRoot, `client/src/shared/${name}`)),
				`expected kernel home client/src/shared/${name}`,
			);
			assert.ok(
				!existsSync(join(repoRoot, `client/src/lib/${name}`)),
				`expected leftover client/src/lib/${name} to be gone`,
			);
		}
		assert.ok(
			existsSync(join(repoRoot, "client/src/shared/TrackerGlyphs.tsx")),
			"expected kernel home client/src/shared/TrackerGlyphs.tsx",
		);
		assert.ok(
			!existsSync(
				join(repoRoot, "client/src/components/tracker/TrackerGlyphs.tsx"),
			),
			"expected leftover client/src/components/tracker/TrackerGlyphs.tsx to be gone",
		);
		assert.ok(
			existsSync(join(repoRoot, "client/src/shared/popoverPlacement.ts")),
			"expected kernel home client/src/shared/popoverPlacement.ts",
		);
		assert.ok(
			!existsSync(join(repoRoot, "client/src/lib/popoverPlacement.ts")),
			"expected leftover client/src/lib/popoverPlacement.ts to be gone",
		);
		assert.ok(
			existsSync(join(repoRoot, "client/src/shared/TrackerPropertyPicker.tsx")),
			"expected kernel home client/src/shared/TrackerPropertyPicker.tsx",
		);
		assert.ok(
			!existsSync(
				join(
					repoRoot,
					"client/src/components/tracker/TrackerPropertyPicker.tsx",
				),
			),
			"expected leftover client/src/components/tracker/TrackerPropertyPicker.tsx to be gone",
		);
		assert.ok(
			existsSync(join(repoRoot, "client/src/shared/boardViewUtils.ts")),
			"expected kernel home client/src/shared/boardViewUtils.ts",
		);
		assert.ok(
			!existsSync(join(repoRoot, "client/src/lib/boardViewUtils.ts")),
			"expected leftover client/src/lib/boardViewUtils.ts to be gone",
		);
		assert.ok(
			existsSync(join(repoRoot, "client/src/shared/taskCreateContracts.ts")),
			"expected kernel home client/src/shared/taskCreateContracts.ts",
		);
		assert.ok(
			!existsSync(join(repoRoot, "client/src/lib/taskCreateContracts.ts")),
			"expected leftover client/src/lib/taskCreateContracts.ts to be gone",
		);
		assert.ok(
			existsSync(join(repoRoot, "client/src/shared/caretRect.ts")),
			"expected kernel home client/src/shared/caretRect.ts",
		);
		assert.ok(
			!existsSync(join(repoRoot, "client/src/lib/caretRect.ts")),
			"expected leftover client/src/lib/caretRect.ts to be gone",
		);
		assert.ok(
			existsSync(join(repoRoot, "client/src/shared/imageAttachments.ts")),
			"expected kernel home client/src/shared/imageAttachments.ts",
		);
		assert.ok(
			!existsSync(join(repoRoot, "client/src/lib/imageAttachments.ts")),
			"expected leftover client/src/lib/imageAttachments.ts to be gone",
		);
		assert.ok(
			existsSync(join(repoRoot, "client/src/shared/ImageUploadPopover.tsx")),
			"expected kernel home client/src/shared/ImageUploadPopover.tsx",
		);
		assert.ok(
			!existsSync(
				join(repoRoot, "client/src/components/ImageUploadPopover.tsx"),
			),
			"expected leftover client/src/components/ImageUploadPopover.tsx to be gone",
		);
		assert.ok(
			existsSync(join(repoRoot, "client/src/shared/imageAttachments.test.ts")),
			"expected kernel home client/src/shared/imageAttachments.test.ts",
		);
		assert.ok(
			!existsSync(join(repoRoot, "client/src/lib/imageAttachments.test.ts")),
			"expected leftover client/src/lib/imageAttachments.test.ts to be gone",
		);
		assert.ok(
			existsSync(
				join(repoRoot, "client/src/shared/ImageUploadPopover.test.tsx"),
			),
			"expected kernel home client/src/shared/ImageUploadPopover.test.tsx",
		);
		assert.ok(
			!existsSync(
				join(repoRoot, "client/src/components/ImageUploadPopover.test.tsx"),
			),
			"expected leftover client/src/components/ImageUploadPopover.test.tsx to be gone",
		);
		assert.ok(
			existsSync(join(repoRoot, "client/src/shared/CardAttachmentDialogs.tsx")),
			"expected kernel home client/src/shared/CardAttachmentDialogs.tsx",
		);
		{
			const leftoverAttachments = "client/src/components/CardAttachments.tsx";
			const leftoverAttachmentLines = countRawLines(
				readFileSync(join(repoRoot, leftoverAttachments), "utf8"),
			);
			assert.ok(
				leftoverAttachmentLines <= LINE_BUDGET_MAX,
				`expected leftover ${leftoverAttachments} ≤${LINE_BUDGET_MAX} lines after 300-on-touch (got ${leftoverAttachmentLines})`,
			);
		}
		for (const name of [
			"TaskTitleEditor.tsx",
			"taskFieldDefinitions.tsx",
			"taskMetadataDraft.ts",
			"TaskFieldCommandPopover.tsx",
			"TaskMetadataCatalogProvider.tsx",
		]) {
			assert.ok(
				existsSync(join(repoRoot, `client/src/shared/${name}`)),
				`expected kernel home client/src/shared/${name}`,
			);
			assert.ok(
				!existsSync(join(repoRoot, `client/src/components/task-entry/${name}`)),
				`expected leftover client/src/components/task-entry/${name} to be gone`,
			);
		}
		assert.ok(
			existsSync(join(repoRoot, "client/src/features/tracker/index.ts")),
			"expected features/tracker public API client/src/features/tracker/index.ts",
		);
		for (const name of [
			"TrackerProgressBar.tsx",
			"TrackerProjectCard.tsx",
			"TrackerProjectsTab.tsx",
			"TrackerConfirmDialog.tsx",
			"TrackerProjectHeader.tsx",
			"TrackerProjectCreateModal.tsx",
			"TrackerTabs.tsx",
			"TrackerChangelog.tsx",
			"TrackerDateFields.tsx",
			"TrackerProperties.tsx",
			"TrackerPhaseEditor.tsx",
			"trackerAuxiliaryState.ts",
			"trackerRowPickerOptions.tsx",
			"trackerRowKebabMenuChrome.ts",
			"TrackerRowShell.tsx",
			"TrackerRowMemberLabel.tsx",
			"TrackerRowDatePopover.tsx",
			"TrackerRowKebabMenuFields.tsx",
			"TrackerRowKebabMenu.tsx",
			"TrackerRowKebabTrigger.tsx",
			"useTrackerRowOpenPicker.ts",
			"TrackerRow.tsx",
			"TrackerSection.tsx",
			"TrackerPhaseSection.tsx",
			"TrackerPhaseSectionRows.tsx",
			"TrackerCreateModal.tsx",
			"useTrackerCreateModal.ts",
			"trackerCreateLock.ts",
			"TrackerCreateMetadataFields.tsx",
			"trackerCreatePickerOptions.tsx",
		]) {
			assert.ok(
				existsSync(join(repoRoot, `client/src/features/tracker/${name}`)),
				`expected features/tracker home client/src/features/tracker/${name}`,
			);
		}
		for (const name of [
			"TrackerCreateModal.test.tsx",
			"TrackerCreateMetadataFields.test.tsx",
			"TrackerRow.test.tsx",
			"TrackerRowDatePopover.test.tsx",
			"TrackerRowKebabMenu.test.tsx",
		]) {
			assert.ok(
				existsSync(join(repoRoot, `client/src/features/tracker/${name}`)),
				`expected features/tracker test home client/src/features/tracker/${name}`,
			);
			assert.ok(
				!existsSync(join(repoRoot, `client/src/components/tracker/${name}`)),
				`expected leftover client/src/components/tracker/${name} to be gone`,
			);
		}
		assert.ok(
			!map.KERNEL_IN_WAITING.some((p) => p.endsWith("work-item-response.ts")),
		);
		assert.ok(
			existsSync(join(repoRoot, "server/src/lib/work-item-response.ts")),
		);
		assert.ok(
			!existsSync(join(repoRoot, "server/src/routes/work-item-response.ts")),
		);
		assert.ok(!map.KERNEL_IN_WAITING.some((p) => p.endsWith("work-items.ts")));
		assert.ok(!map.KERNEL_IN_WAITING.some((p) => p.endsWith("helpers.ts")));
		assert.ok(
			!map.KERNEL_IN_WAITING.some((p) => p.endsWith("vocabulary-response.ts")),
		);
		assert.ok(
			!map.KERNEL_IN_WAITING.some((p) => p.endsWith("tracker-item-parsers.ts")),
		);
		for (const name of [
			"tracker-assignees.ts",
			"tracker-activity.ts",
			"workspace-mutation-lock.ts",
			"work-item-create-metadata.ts",
			"work-item-events.ts",
		]) {
			assert.ok(
				existsSync(join(repoRoot, `server/src/lib/${name}`)),
				`expected kernel home server/src/lib/${name}`,
			);
			assert.ok(
				!existsSync(join(repoRoot, `server/src/routes/${name}`)),
				`expected leftover server/src/routes/${name} to be gone`,
			);
		}
		for (const name of [
			"card-assignees.ts",
			"card-response.ts",
			"card-response.test.ts",
			"card-response.integration.test.ts",
		]) {
			assert.ok(
				existsSync(join(repoRoot, `server/src/lib/${name}`)),
				`expected kernel home server/src/lib/${name}`,
			);
			assert.ok(
				!existsSync(join(repoRoot, `server/src/routes/${name}`)),
				`expected leftover server/src/routes/${name} to be gone`,
			);
		}
		for (const name of ["board.ts", "cards.ts", "card-create.ts"]) {
			assert.ok(
				existsSync(join(repoRoot, `server/src/routes/${name}`)),
				`expected board product router server/src/routes/${name} to remain`,
			);
		}
		assert.ok(
			existsSync(join(repoRoot, "client/src/features/my-work/index.ts")),
			"expected features/my-work public API client/src/features/my-work/index.ts",
		);
		assert.ok(
			existsSync(join(repoRoot, "server/src/modules/my-work/index.ts")),
			"expected server/src/modules/my-work/index.ts",
		);
		assert.ok(
			existsSync(join(repoRoot, "client/src/pages/MyWorkPage.tsx")),
			"expected MyWorkPage to remain under client/src/pages/MyWorkPage.tsx",
		);
		assert.ok(
			!existsSync(join(repoRoot, "client/src/features/chat")),
			"expected client/src/features/chat/ to not exist yet",
		);
		for (const name of [
			"MyWorkDetailContent.tsx",
			"MyWorkDetailSheet.tsx",
			"MyWorkDetailSheetFrame.tsx",
			"MyWorkDoneAction.tsx",
			"MyWorkDoneActionView.tsx",
			"MyWorkList.tsx",
			"MyWorkPageView.tsx",
			"MyWorkRow.tsx",
			"MyWorkRowParts.tsx",
			"MyWorkToolbar.tsx",
			"MyWorkToolbarParts.tsx",
			"myWorkDataLoader.ts",
			"myWorkDoneActionState.ts",
			"useDelayedLoading.ts",
			"useMyWorkData.ts",
			"useMyWorkDoneAction.ts",
		]) {
			assert.ok(
				existsSync(join(repoRoot, `client/src/features/my-work/${name}`)),
				`expected features/my-work home client/src/features/my-work/${name}`,
			);
			assert.ok(
				!existsSync(join(repoRoot, `client/src/components/my-work/${name}`)),
				`expected leftover client/src/components/my-work/${name} to be gone`,
			);
		}
		for (const name of [
			"MyWorkDoneAction.test.tsx",
			"MyWorkRow.test.tsx",
			"myWorkDataLoader.test.ts",
			"useDelayedLoading.test.ts",
		]) {
			assert.ok(
				existsSync(join(repoRoot, `client/src/features/my-work/${name}`)),
				`expected features/my-work test home client/src/features/my-work/${name}`,
			);
			assert.ok(
				!existsSync(join(repoRoot, `client/src/components/my-work/${name}`)),
				`expected leftover client/src/components/my-work/${name} to be gone`,
			);
		}
		assert.ok(
			existsSync(join(repoRoot, "client/src/pages/MyWorkDetailSheet.test.tsx")),
			"expected MyWorkDetailSheet.test.tsx under client/src/pages/",
		);
		assert.ok(
			!existsSync(
				join(
					repoRoot,
					"client/src/components/my-work/MyWorkDetailSheet.test.tsx",
				),
			),
			"expected leftover client/src/components/my-work/MyWorkDetailSheet.test.tsx to be gone",
		);
		for (const name of [
			"myWorkMutationReconciliation.ts",
			"myWorkMutationReconciliation.test.ts",
			"myWorkNavigation.ts",
			"myWorkOrdering.test.ts",
			"myWorkOrdering.ts",
			"myWorkSearch.test.ts",
			"myWorkSearch.ts",
			"myWorkSourceNavigation.ts",
			"myWorkStatus.ts",
			"myWorkTestSupport.ts",
			"myWorkUtils.test.ts",
			"myWorkUtils.ts",
		]) {
			assert.ok(
				existsSync(join(repoRoot, `client/src/features/my-work/${name}`)),
				`expected features/my-work home client/src/features/my-work/${name}`,
			);
			assert.ok(
				!existsSync(join(repoRoot, `client/src/lib/${name}`)),
				`expected leftover client/src/lib/${name} to be gone`,
			);
		}
		assert.ok(
			existsSync(join(repoRoot, "client/src/features/my-work/myWork.ts")),
			"expected client/src/features/my-work/myWork.ts",
		);
		assert.ok(
			!existsSync(join(repoRoot, "client/src/api/myWork.ts")),
			"expected leftover client/src/api/myWork.ts to be gone",
		);
		for (const name of [
			"my-work.ts",
			"my-work-router.ts",
			"my-work-service.ts",
			"my-work-data-source.ts",
			"my-work-query-parser.ts",
			"my-work-types.ts",
		]) {
			assert.ok(
				existsSync(join(repoRoot, `server/src/modules/my-work/${name}`)),
				`expected server/src/modules/my-work/${name}`,
			);
			assert.ok(
				!existsSync(join(repoRoot, `server/src/routes/${name}`)),
				`expected leftover server/src/routes/${name} to be gone`,
			);
		}
		assert.ok(
			existsSync(join(repoRoot, "server/src/modules/tracker/index.ts")),
			"expected server/src/modules/tracker/index.ts",
		);
		for (const name of [
			"tracker-items.ts",
			"tracker-item-create.ts",
			"tracker-item-update.ts",
			"tracker-item-read.ts",
			"tracker-item-delete.ts",
			"tracker-item-reorder.ts",
			"tracker-item-route-helpers.ts",
			"tracker-projects.ts",
			"tracker-phases.ts",
			"tracker-vocabularies.ts",
		]) {
			assert.ok(
				existsSync(join(repoRoot, `server/src/modules/tracker/${name}`)),
				`expected server/src/modules/tracker/${name}`,
			);
			assert.ok(
				!existsSync(join(repoRoot, `server/src/routes/${name}`)),
				`expected leftover server/src/routes/${name} to be gone`,
			);
		}
	});

	it("Chrome extract retargets every importer", () => {
		assert.equal(LINE_BUDGET_MAX, 300, "LINE_BUDGET_MAX must stay 300");
		assert.ok(
			existsSync(join(repoRoot, "client/src/context/BoardContext.tsx")),
			"BoardContext must remain under context/, not shared/",
		);
		for (const name of [
			"TrackerTabs.tsx",
			"TrackerChangelog.tsx",
			"TrackerRow.tsx",
		]) {
			assert.ok(
				existsSync(join(repoRoot, `client/src/components/tracker/${name}`)),
				`expected tracker stub client/src/components/tracker/${name} to remain`,
			);
		}
		const chromeHomes = [
			"PageHeader.tsx",
			"EmptyState.tsx",
			"LoadingCamel.tsx",
			"Toast.tsx",
			"Toast.test.tsx",
			"PresenceBar.tsx",
			"SuccessAnimation.tsx",
			"ToolTraceView.tsx",
			"ToolTraceView.test.tsx",
			"ToastContext.tsx",
			"ToastContext.test.tsx",
			"PresenceContext.tsx",
			"PresenceContext.test.tsx",
			"title.ts",
			"title.test.ts",
			"toolTrace.ts",
			"toolTrace.test.ts",
			"myWorkTypes.ts",
			"WorkspaceContext.tsx",
			"WorkspaceContext.test.tsx",
			"workspaceSelection.ts",
			"workspaceSelection.test.ts",
			"workspaceSwitcher.ts",
			"workspaceSwitcher.test.ts",
			"FloatingChatButton.tsx",
			"TicketIntakeChatOverlay.tsx",
			"PreviewScreen.tsx",
			"inputClass.ts",
			"AutoErrorListener.tsx",
			"TicketIntakeChatPanel.tsx",
			"TicketIntakeChatPanel.test.tsx",
			"useTicketIntakeChat.ts",
			"useTicketIntakeChat.test.ts",
			"useTicketIntakeChat.integration.test.tsx",
			"PreviewScreen.test.tsx",
			"FloatingChatButton.test.tsx",
			"AutoErrorListener.test.tsx",
			"ticketIntakeBus.ts",
			"ticketIntakeBus.test.ts",
			"agentQueue.ts",
			"agentQueue.test.ts",
		];
		for (const name of chromeHomes) {
			assert.ok(
				existsSync(join(repoRoot, `client/src/shared/${name}`)),
				`expected kernel home client/src/shared/${name}`,
			);
		}
		const chromeLeftovers = [
			"client/src/components/PageHeader.tsx",
			"client/src/components/EmptyState.tsx",
			"client/src/components/LoadingCamel.tsx",
			"client/src/components/Toast.tsx",
			"client/src/components/Toast.test.tsx",
			"client/src/components/PresenceBar.tsx",
			"client/src/components/SuccessAnimation.tsx",
			"client/src/components/ToolTrace.tsx",
			"client/src/components/ToolTrace.test.tsx",
			"client/src/context/ToastContext.tsx",
			"client/src/context/ToastContext.test.tsx",
			"client/src/context/PresenceContext.tsx",
			"client/src/context/PresenceContext.test.tsx",
			"client/src/context/WorkspaceContext.tsx",
			"client/src/context/WorkspaceContext.test.tsx",
			"client/src/lib/title.ts",
			"client/src/lib/title.test.ts",
			"client/src/lib/toolTrace.ts",
			"client/src/lib/toolTrace.test.ts",
			"client/src/lib/workspaceSelection.ts",
			"client/src/lib/workspaceSelection.test.ts",
			"client/src/lib/workspaceSwitcher.ts",
			"client/src/lib/workspaceSwitcher.test.ts",
			"client/src/lib/ticketIntakeBus.ts",
			"client/src/lib/ticketIntakeBus.test.ts",
			"client/src/lib/agentQueue.ts",
			"client/src/lib/agentQueue.test.ts",
			"client/src/types/myWork.ts",
			"client/src/hooks/useTicketIntakeChat.ts",
			"client/src/hooks/useTicketIntakeChat.test.ts",
			"client/src/hooks/useTicketIntakeChat.integration.test.tsx",
			"client/src/components/ticketIntake/FloatingChatButton.tsx",
			"client/src/components/ticketIntake/TicketIntakeChatOverlay.tsx",
			"client/src/components/ticketIntake/PreviewScreen.tsx",
			"client/src/components/ticketIntake/inputClass.ts",
			"client/src/components/ticketIntake/AutoErrorListener.tsx",
			"client/src/components/ticketIntake/ChatPanel.tsx",
			"client/src/components/ticketIntake/ChatPanel.test.tsx",
			"client/src/components/ticketIntake/PreviewScreen.test.tsx",
			"client/src/components/ticketIntake/FloatingChatButton.test.tsx",
			"client/src/components/ticketIntake/AutoErrorListener.test.tsx",
		];
		for (const path of chromeLeftovers) {
			assert.ok(
				!existsSync(join(repoRoot, path)),
				`expected leftover ${path} to be gone`,
			);
		}
	});

	it("Auth screens become page orchestrators", () => {
		for (const name of [
			"AuthPage.tsx",
			"AuthPage.test.tsx",
			"EmailGatePage.tsx",
			"EmailGatePage.test.tsx",
			"PickUsernamePage.tsx",
			"PickUsernamePage.test.tsx",
		]) {
			assert.ok(
				existsSync(join(repoRoot, `client/src/pages/${name}`)),
				`expected page home client/src/pages/${name}`,
			);
			assert.ok(
				!existsSync(join(repoRoot, `client/src/components/${name}`)),
				`expected leftover client/src/components/${name} to be gone`,
			);
		}
		assert.ok(
			!existsSync(join(repoRoot, "client/src/features/auth")),
			"expected client/src/features/auth/ to not exist yet",
		);
	});
});

describe("Cycle A — stub CLI (integration)", () => {
	it("exits 0, prints pass line, and echoes resolved base-ref and root", () => {
		const result = spawnSync(
			process.execPath,
			[cliScript, "--base-ref", "origin/main", "--root", "."],
			{ cwd: repoRoot, encoding: "utf8" },
		);
		assert.equal(result.status, 0, result.stderr || result.stdout);
		assert.match(result.stdout, /Feature module check passed\./);
		assert.match(result.stdout, /origin\/main/);
		assert.match(result.stdout, /root=\./);
	});

	it("fails loud when merge-base ref is missing (non-fixture root)", () => {
		const result = spawnSync(
			process.execPath,
			[
				cliScript,
				"--base-ref",
				"refs/no/such-ref-feature-modules-129",
				"--root",
				".",
			],
			{ cwd: repoRoot, encoding: "utf8" },
		);
		assert.equal(result.status, 1);
		const combined = `${result.stdout}\n${result.stderr}`;
		assert.match(combined, /FM-RULE-5/);
	});
});

/**
 * @param {string} cwd
 * @param {string[]} args
 */
function git(cwd, args) {
	const result = spawnSync("git", args, { cwd, encoding: "utf8" });
	assert.equal(
		result.status,
		0,
		`git ${args.join(" ")} failed: ${result.stderr}`,
	);
	return result.stdout.trim();
}

/**
 * @param {string} dirPrefix
 * @param {(dir: string) => void} run
 */
function withTempGitRepo(dirPrefix, run) {
	const dir = mkdtempSync(join(repoRoot, dirPrefix));
	try {
		git(dir, ["init"]);
		git(dir, ["config", "user.email", "fm@test.local"]);
		git(dir, ["config", "user.name", "FM Test"]);
		run(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

describe("Cycle Git — real git binary (integration)", () => {
	it("collects name-status from merge-base through real git", () => {
		withTempGitRepo(".tmp-fm-git-", (dir) => {
			writeFileSync(join(dir, "keep.ts"), "// keep\n");
			writeFileSync(join(dir, "modify-me.ts"), "// v1\n");
			writeFileSync(join(dir, "rename-me.ts"), "// rename\n");
			writeFileSync(join(dir, "copy-src.ts"), "// copy\n");
			writeFileSync(join(dir, "delete-me.ts"), "// delete\n");
			writeFileSync(join(dir, "noise.md"), "# doc\n");
			git(dir, ["add", "."]);
			git(dir, ["commit", "-m", "base"]);

			writeFileSync(join(dir, "modify-me.ts"), "// v2\n");
			writeFileSync(join(dir, "brand-new.ts"), "// new\n");
			git(dir, ["mv", "rename-me.ts", "renamed.ts"]);
			writeFileSync(
				join(dir, "copied.ts"),
				readFileSync(join(dir, "copy-src.ts"), "utf8"),
			);
			rmSync(join(dir, "delete-me.ts"));
			git(dir, ["add", "-A"]);
			git(dir, ["commit", "-m", "changes"]);

			const baseRef = git(dir, ["rev-parse", "HEAD~1"]);
			const result = collectGitDiff(dir, baseRef);

			assert.deepEqual(result.new.sort(), ["brand-new.ts"].sort());
			assert.deepEqual(result.modified, ["modify-me.ts"]);
			assert.ok(
				result.renamed.some(
					(r) => r.from === "rename-me.ts" && r.to === "renamed.ts",
				),
			);
			assert.ok(result.deleted.includes("delete-me.ts"));
			assert.ok(
				result.copied.some(
					(c) => c.from === "copy-src.ts" && c.to === "copied.ts",
				),
			);
			assert.equal(result.sourceFiles.length, 4);
			assert.ok(!result.sourceFiles.includes("noise.md"));
		});
	});

	it("fails loud when base ref is missing", () => {
		withTempGitRepo(".tmp-fm-git-miss-", (dir) => {
			writeFileSync(join(dir, "solo.ts"), "// solo\n");
			git(dir, ["add", "solo.ts"]);
			git(dir, ["commit", "-m", "solo"]);

			assert.throws(
				() => collectGitDiff(dir, "refs/no/such-base-fm-129"),
				/FM-RULE-5/,
			);
		});
	});

	it("reports zero source files when HEAD equals merge-base", () => {
		withTempGitRepo(".tmp-fm-git-empty-", (dir) => {
			writeFileSync(join(dir, "only.ts"), "// only\n");
			git(dir, ["add", "only.ts"]);
			git(dir, ["commit", "-m", "only"]);
			const head = git(dir, ["rev-parse", "HEAD"]);

			const result = collectGitDiff(dir, head);
			assert.deepEqual(result.sourceFiles, []);
			assert.deepEqual(result.new, []);
			assert.deepEqual(result.modified, []);
		});
	});
});

describe("Cycle B — shared kernel file exists (unit)", () => {
	it("client/src/shared/index.ts is a valid empty ESM module", () => {
		const sharedIndex = join(repoRoot, "client/src/shared/index.ts");
		assert.ok(existsSync(sharedIndex), "client/src/shared/index.ts must exist");
		const contents = readFileSync(sharedIndex, "utf8").trim();
		assert.equal(contents, "export {};");
	});
});
