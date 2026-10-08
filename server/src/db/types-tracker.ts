import type { Generated, Json, Timestamp } from "./types.js";

export interface TrackerEvents {
	actor_id: number | null;
	created_at: Generated<Timestamp>;
	event_type: string;
	id: Generated<number>;
	payload: Generated<Json>;
	tracker_item_id: number | null;
	workspace_id: number;
}

export interface TrackerItemAssignees {
	tracker_item_id: number;
	user_id: number;
}

export interface TrackerItemLabels {
	tracker_item_id: number;
	vocabulary_id: number;
}

export interface TrackerItems {
	completed_at: Timestamp | null;
	created_at: Generated<Timestamp>;
	deleted_at: Timestamp | null;
	description: Generated<string>;
	end_date: Timestamp | null;
	id: Generated<number>;
	key_number: number;
	migrated_to_id: number | null;
	phase_id: number | null;
	position: number | null;
	priority_id: number | null;
	project_id: number | null;
	start_date: Timestamp | null;
	status_id: number;
	title: string;
	updated_at: Generated<Timestamp>;
	version: Generated<number>;
	workspace_id: number;
}

export interface TrackerPhases {
	created_at: Generated<Timestamp>;
	deleted_at: Timestamp | null;
	end_date: Timestamp | null;
	id: Generated<number>;
	name: string;
	position: number;
	project_id: number;
	start_date: Timestamp | null;
	subtitle: Generated<string>;
	updated_at: Generated<Timestamp>;
	version: Generated<number>;
}

export interface TrackerProjects {
	created_at: Generated<Timestamp>;
	deleted_at: Timestamp | null;
	end_date: Timestamp | null;
	id: Generated<number>;
	name: string;
	position: number;
	start_date: Timestamp | null;
	updated_at: Generated<Timestamp>;
	version: Generated<number>;
	workspace_id: number;
}

export interface TrackerVocabularies {
	category: string | null;
	colour: string;
	created_at: Generated<Timestamp>;
	id: Generated<number>;
	kind: string;
	name: string;
	position: number;
	slot: "backlog" | "todo" | "in_progress" | "done" | "canceled" | null;
	workspace_id: number;
}
