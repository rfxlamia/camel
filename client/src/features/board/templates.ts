// Column color palette names (must match server validation and ColumnView)
const COLUMN_COLORS = [
	"powder-blue",
	"pale-sky",
	"light-cyan",
	"frozen-water",
	"turquoise",
] as const;

export type ColumnColor = (typeof COLUMN_COLORS)[number];

export type TemplateColumn = {
	title: string;
	color: ColumnColor;
	wipLimit: number | null;
	policy: string;
	isDone: boolean;
	isSignable?: boolean;
	signableAssigneeId?: number | null;
};

export type WorkspaceTemplate = {
	id: string;
	name: string;
	tagline: string;
	columns: TemplateColumn[];
};

export const WORKSPACE_TEMPLATES: WorkspaceTemplate[] = [
	{
		id: "software-dev",
		name: "Software Dev",
		tagline: "Ship code, track work",
		columns: [
			{
				title: "Backlog",
				color: "powder-blue",
				wipLimit: null,
				policy: "Ideas & requests, not yet scheduled.",
				isDone: false,
			},
			{
				title: "To Do",
				color: "pale-sky",
				wipLimit: null,
				policy: "Ready to pick up next.",
				isDone: false,
			},
			{
				title: "In Progress",
				color: "light-cyan",
				wipLimit: 3,
				policy: "Actively being worked on.",
				isDone: false,
			},
			{
				title: "In Review",
				color: "frozen-water",
				wipLimit: 2,
				policy: "Awaiting review or QA.",
				isDone: false,
			},
			{
				title: "Done",
				color: "turquoise",
				wipLimit: null,
				policy: "Shipped and verified.",
				isDone: true,
			},
		],
	},
	{
		id: "firmware-hardware",
		name: "Firmware / Hardware",
		tagline: "Build & test units",
		columns: [
			{
				title: "Backlog",
				color: "powder-blue",
				wipLimit: null,
				policy: "Requests & ideas, not yet scheduled.",
				isDone: false,
			},
			{
				title: "Design",
				color: "pale-sky",
				wipLimit: null,
				policy: "Schematics & specs in progress.",
				isDone: false,
			},
			{
				title: "Implementation",
				color: "light-cyan",
				wipLimit: 2,
				policy: "Building the unit.",
				isDone: false,
			},
			{
				title: "Bench Test",
				color: "frozen-water",
				wipLimit: 2,
				policy: "Validation on the bench.",
				isDone: false,
			},
			{
				title: "Shipped",
				color: "turquoise",
				wipLimit: null,
				policy: "Released to production.",
				isDone: true,
			},
		],
	},
	{
		id: "management-ops",
		name: "Management / Ops",
		tagline: "Plan & run ops",
		columns: [
			{
				title: "To Plan",
				color: "powder-blue",
				wipLimit: null,
				policy: "Needs scoping before scheduling.",
				isDone: false,
			},
			{
				title: "This Week",
				color: "pale-sky",
				wipLimit: 5,
				policy: "Committed for this week.",
				isDone: false,
			},
			{
				title: "In Progress",
				color: "light-cyan",
				wipLimit: 3,
				policy: "Currently being executed.",
				isDone: false,
			},
			{
				title: "Blocked",
				color: "frozen-water",
				wipLimit: null,
				policy: "Stuck — needs unblocking.",
				isDone: false,
			},
			{
				title: "Done",
				color: "turquoise",
				wipLimit: null,
				policy: "Completed.",
				isDone: true,
			},
		],
	},
	{
		id: "purchasing",
		name: "Purchasing",
		tagline: "Track procurement",
		columns: [
			{
				title: "Requested",
				color: "powder-blue",
				wipLimit: null,
				policy: "Requested, pending review.",
				isDone: false,
			},
			{
				title: "Approval",
				color: "pale-sky",
				wipLimit: null,
				policy: "Awaiting budget sign-off.",
				isDone: false,
			},
			{
				title: "Ordered",
				color: "light-cyan",
				wipLimit: null,
				policy: "PO placed with supplier.",
				isDone: false,
			},
			{
				title: "Received",
				color: "frozen-water",
				wipLimit: null,
				policy: "Goods received, pending check.",
				isDone: false,
			},
			{
				title: "Closed",
				color: "turquoise",
				wipLimit: null,
				policy: "Paid and closed.",
				isDone: true,
			},
		],
	},
	{
		id: "bug-tracker",
		name: "Bug Tracker",
		tagline: "Triage to resolution",
		columns: [
			{
				title: "New",
				color: "powder-blue",
				wipLimit: null,
				policy: "Reported, not yet triaged.",
				isDone: false,
			},
			{
				title: "Triaged",
				color: "pale-sky",
				wipLimit: null,
				policy: "Confirmed & prioritized.",
				isDone: false,
			},
			{
				title: "Fixing",
				color: "light-cyan",
				wipLimit: 3,
				policy: "Fix in progress.",
				isDone: false,
			},
			{
				title: "Verifying",
				color: "frozen-water",
				wipLimit: 2,
				policy: "Fix under verification.",
				isDone: false,
			},
			{
				title: "Resolved",
				color: "turquoise",
				wipLimit: null,
				policy: "Verified & closed.",
				isDone: true,
			},
		],
	},
];
