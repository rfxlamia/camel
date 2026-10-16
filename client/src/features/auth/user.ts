export interface User {
	id: number;
	username: string | null;
	displayName: string;
	emailVerified: boolean;
	needsUsername: boolean;
	/** Present on /auth/me — whether the account has a local password to change. */
	hasPassword?: boolean;
}

export interface PresenceUser extends User {
	lastSeen: string;
}
