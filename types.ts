
export enum NotamType {
    RUNWAY_CLOSURE = "RUNWAY_CLOSURE",
    TAXIWAY_CLOSURE = "TAXIWAY_CLOSURE",
    APRON_CLOSURE = "APRON_CLOSURE",
    NAVAID_UNSERVICEABLE = "NAVAID_UNSERVICEABLE",
    LIGHTING_FAILURE = "LIGHTING_FAILURE",
    AIRSPACE_ACTIVATION = "AIRSPACE_ACTIVATION",
    DANGER_AREA_ACTIVATION = "DANGER_AREA_ACTIVATION",
    MILITARY_AREA_ACTIVATION = "MILITARY_AREA_ACTIVATION",
    RESTRICTED_AREA_ACTIVATION = "RESTRICTED_AREA_ACTIVATION",
    UNKNOWN = "UNKNOWN"
}

export interface ScheduleEntry {
    day: number;
    month: string; // 3-letter uppercase abbreviation, e.g., "NOV"
    startTime: string; // HHMM
    endTime: string; // HHMM
}

export interface RecurringScheduleClause {
    day: string; // "MON", "TUE", etc.
    startTime: string; // HHMM
    endTime: string; // HHMM
}

export interface RecurringSchedule {
    timeDefName: string | null;
    clauses: RecurringScheduleClause[];
}

export interface CircleDefinition {
    center: string; // Coordinate string e.g., '380930N0013321W'
    radiusNM: number;
}

export interface AreaDefinition {
    polygon?: string[]; // Array of coordinate strings
    circle?: CircleDefinition;
    upperAltitudeFeet: number;
    lowerAltitudeFeet: number; // For SFC, this will be 0
}

export interface TimeRange {
    startTime: string; // HHMM
    endTime: string; // HHMM
}

export interface ComplexScheduleDateRange {
    startDay: number;
    endDay: number;
}

export interface ComplexSchedule {
    dateRanges: ComplexScheduleDateRange[];
    timeRanges: TimeRange[];
}

export interface DetailedScheduleEntry {
    day: number;
    timeRanges: TimeRange[];
}

export interface DailyScheduleWithRangesEntry {
    month?: string; // e.g. "JUL"
    startDay: number;
    endDay: number;
    timeRanges: TimeRange[];
}

export interface ParsedNotam {
    notamId: string | null;
    aerodromes: string[] | null;
    startTime: string | null; // YYMMDDhhmm
    endTime: string | null; // YYMMDDhhmm
    parsedSchedule: ScheduleEntry[] | null;
    recurringSchedule: RecurringSchedule | null;
    multiTimeRangeSchedule: TimeRange[] | null;
    complexSchedule: ComplexSchedule | null;
    detailedSchedule: DetailedScheduleEntry[] | null;
    dailyScheduleWithRanges: DailyScheduleWithRangesEntry[] | null;
    notamType: NotamType;
    affectedElement: string | null; // e.g., "05/23", "TWY A", "ILS"
    reason: string | null; // e.g., "WIP", "MAINTENANCE"
    airspaceType: string | null; // e.g., "DANGER", "RESTRICTED", "TRA"
    airspaceId: string | null; // e.g., "D123"
    areaDefinitions: AreaDefinition[] | null;
}
