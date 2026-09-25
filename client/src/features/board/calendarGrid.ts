import {
	eachDayOfInterval,
	endOfMonth,
	endOfWeek,
	format,
	isSameMonth,
	startOfMonth,
	startOfWeek,
} from "date-fns";

export interface CalendarGridCell {
	iso: string;
	inMonth: boolean;
	date: Date;
}

const WEEK_OPTS = { weekStartsOn: 0 as const };

export function buildMonthGrid(month: Date): CalendarGridCell[] {
	const monthStart = startOfMonth(month);
	const monthEnd = endOfMonth(month);
	const gridStart = startOfWeek(monthStart, WEEK_OPTS);
	const gridEnd = endOfWeek(monthEnd, WEEK_OPTS);

	return eachDayOfInterval({ start: gridStart, end: gridEnd }).map((date) => ({
		iso: format(date, "yyyy-MM-dd"),
		inMonth: isSameMonth(date, month),
		date,
	}));
}
