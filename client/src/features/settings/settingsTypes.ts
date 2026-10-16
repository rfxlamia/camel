export interface Setting {
	key: string;
	textValue: string | null;
	boolValue: boolean | null;
	version: number;
	updatedAt: string;
}

export interface SettingsMap {
	boardName: string;
	logoPath: string;
	version: number;
}
