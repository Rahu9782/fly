
import React, { useState, useCallback } from 'react';
import { NotamInput } from './components/NotamInput';
import { ParsedOutput } from './components/ParsedOutput';
import { AirlangOutput } from './components/AirlangOutput';
import { AlertTriangle, ClipboardList, FileText } from 'lucide-react';
import { ParsedNotam, NotamType, AreaDefinition } from './types';
import { parseNotamWithAI } from './services/geminiService';
import { formatAirlangDate } from './utils/dateFormatter';

const MONTH_INDEX_MAP: { [key: string]: number } = {
    "JAN": 0, "FEB": 1, "MAR": 2, "APR": 3, "MAY": 4, "JUN": 5, 
    "JUL": 6, "AUG": 7, "SEP": 8, "OCT": 9, "NOV": 10, "DEC": 11
};

const WEEK_DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];


const formatAirlangCoordinate = (coord: string): string => {
    // Matches DDMMSSN/S and DDDMMSS E/W, and returns DDMMN/S and DDDMMW/E
    const match = coord.match(/^(\d{4})\d*([NS])(\d{5})\d*([EW])$/);
    if (match) {
        const [, latDegMin, latDir, lonDegMin, lonDir] = match;
        return `${latDegMin}${latDir}${lonDegMin}${lonDir}+A+P`;
    }
    // Fallback for unexpected formats.
    return `${coord}+A+P`;
};

const feetToFlightLevel = (feet: number): string => {
    const fl = Math.round(feet / 100);
    return `FL${String(fl).padStart(3, '0')}`;
};

const generateAirlang = (data: ParsedNotam): { code: string; error?: string } => {
    let timeDef = '';

    if (data.recurringSchedule && data.recurringSchedule.clauses?.length > 0) {
        const { timeDefName, clauses } = data.recurringSchedule;
        const name = timeDefName || 'DURATION';
        const overallStartFmt = data.startTime ? formatAirlangDate(data.startTime) : 'INVALID_START_DATE';
        const overallEndFmt = data.endTime ? formatAirlangDate(data.endTime) : 'INVALID_END_DATE';
        
        const firstClause = clauses[0];
        const isDailySameTime = clauses.length === 7 && clauses.every(c => c.startTime === firstClause.startTime && c.endTime === firstClause.endTime);

        if (isDailySameTime) {
            // Simplified format for DAILY schedules with consistent times
            const startTimeFmt = `${firstClause.startTime.slice(0, 2)}:${firstClause.startTime.slice(2)}`;
            const endTimeFmt = `${firstClause.endTime.slice(0, 2)}:${firstClause.endTime.slice(2)}`;
            timeDef = `TIMEDEF ${name} = ${overallStartFmt} TO ${overallEndFmt}: (${startTimeFmt} TO ${endTimeFmt});`;
        } else {
            const scheduleClauses = clauses.map(clause => {
                const startTimeFmt = `${clause.startTime.slice(0, 2)}:${clause.startTime.slice(2)}`;
                const endTimeFmt = `${clause.endTime.slice(0, 2)}:${clause.endTime.slice(2)}`;
                const crossesMidnight = parseInt(clause.startTime, 10) >= parseInt(clause.endTime, 10);
                const currentDay = clause.day.toUpperCase();

                if (crossesMidnight) {
                    const dayIndex = WEEK_DAYS.indexOf(currentDay);
                    const nextDay = WEEK_DAYS[(dayIndex + 1) % 7];
                    return `${currentDay} ${startTimeFmt} TO ${nextDay} ${endTimeFmt}`;
                } else {
                    return `${currentDay} ${startTimeFmt} TO ${currentDay} ${endTimeFmt}`;
                }
            });

            if (scheduleClauses.length > 0) {
                const timeDefPrefix = `TIMEDEF ${name} = ${overallStartFmt} TO ${overallEndFmt}: `;
                const padding = ' '.repeat(timeDefPrefix.length + 1); // +1 for the opening parenthesis
                const scheduleString = scheduleClauses.join(`,\n${padding}`);
                timeDef = `${timeDefPrefix}(${scheduleString});`;
            } else {
                timeDef = `TIMEDEF ${name} = ${overallStartFmt} TO ${overallEndFmt};`;
            }
        }
    } else if (data.dailyScheduleWithRanges && data.dailyScheduleWithRanges.length > 0 && data.startTime) {
        const yearStr = data.startTime.substring(0, 2);
        const startYear = 2000 + parseInt(yearStr, 10);
        const startMonthIndex = parseInt(data.startTime.substring(2, 4), 10) - 1;

        const sortedSchedule = [...data.dailyScheduleWithRanges].sort((a, b) => {
            const monthAIndex = a.month ? MONTH_INDEX_MAP[a.month.toUpperCase()] : startMonthIndex;
            const monthBIndex = b.month ? MONTH_INDEX_MAP[b.month.toUpperCase()] : startMonthIndex;

            let yearA = startYear;
            let yearB = startYear;

            if (monthAIndex < startMonthIndex) yearA += 1;
            if (monthBIndex < startMonthIndex) yearB += 1;

            const dateA = new Date(Date.UTC(yearA, monthAIndex, a.startDay));
            const dateB = new Date(Date.UTC(yearB, monthBIndex, b.startDay));

            const dateComparison = dateA.getTime() - dateB.getTime();
            if (dateComparison !== 0) return dateComparison;

            const startTimeA = a.timeRanges?.[0]?.startTime ?? '0000';
            const startTimeB = b.timeRanges?.[0]?.startTime ?? '0000';
            return startTimeA.localeCompare(startTimeB);
        });

        const scheduleClauses = sortedSchedule.map(entry => {
            const entryMonthIndex = entry.month ? MONTH_INDEX_MAP[entry.month.toUpperCase()] : startMonthIndex;
            let entryYear = startYear;
            if (entryMonthIndex < startMonthIndex) {
                entryYear += 1;
            }

            const entryMonthStr = MONTHS[entryMonthIndex].toUpperCase();
            const startDayStr = String(entry.startDay).padStart(2, '0');
            const endDayStr = String(entry.endDay).padStart(2, '0');
            
            const linePrefix = `${startDayStr} ${entryMonthStr} ${entryYear} TO ${endDayStr} ${entryMonthStr} ${entryYear}:`;

            const timeClauses = entry.timeRanges.map(range => {
                const startTimeFmt = `${range.startTime.slice(0, 2)}:${range.startTime.slice(2)}`;
                const endTimeFmt = `${range.endTime.slice(0, 2)}:${range.endTime.slice(2)}`;
                return `(${startTimeFmt} TO ${endTimeFmt})`;
            });
            
            const timePadding = ' '.repeat(linePrefix.length + 1);
            const timeClausesStr = timeClauses.join(`,\n${timePadding}`);

            return `${linePrefix}${timeClausesStr}`;
        });

        const timeDefPrefix = 'TIMEDEF DURATION = ';
        const mainPadding = ' '.repeat(timeDefPrefix.length);
        timeDef = `${timeDefPrefix}${scheduleClauses.join(`,\n${mainPadding}`)};`;
    } else if (data.detailedSchedule && data.detailedSchedule.length > 0 && data.startTime) {
        const yearStr = data.startTime.substring(0, 2);
        const startMonthIndex = parseInt(data.startTime.substring(2, 4), 10) - 1;
        const startYear = 2000 + parseInt(yearStr, 10);
        
        const clauses = data.detailedSchedule.flatMap(entry => {
            return entry.timeRanges.map(range => {
                const startTimeFmt = `${range.startTime.slice(0, 2)}:${range.startTime.slice(2)}`;
                const endTimeFmt = `${range.endTime.slice(0, 2)}:${range.endTime.slice(2)}`;
                const isOvernight = parseInt(range.startTime, 10) >= parseInt(range.endTime, 10);
    
                const startDate = new Date(Date.UTC(startYear, startMonthIndex, entry.day));
                
                const endDate = new Date(startDate);
                if (isOvernight) {
                    endDate.setUTCDate(endDate.getUTCDate() + 1);
                }
    
                const formatAirlangDateTime = (d: Date, time: string) => {
                    const day = String(d.getUTCDate()).padStart(2, '0');
                    const month = MONTHS[d.getUTCMonth()].toUpperCase();
                    const year = d.getUTCFullYear();
                    return `${day} ${month} ${year} ${time}`;
                };
                
                const startStr = formatAirlangDateTime(startDate, startTimeFmt);
                const endStr = formatAirlangDateTime(endDate, endTimeFmt);
    
                return `${startStr} TO ${endStr}`;
            });
        });
    
        const sortedClauses = clauses.sort((a, b) => {
            const startA_str = a.split(' TO ')[0]; // "29 JUL 2025 22:00"
            const startB_str = b.split(' TO ')[0];
    
            const partsA = startA_str.match(/(\d{2}) (\w{3}) (\d{4}) (\d{2}):(\d{2})/);
            const partsB = startB_str.match(/(\d{2}) (\w{3}) (\d{4}) (\d{2}):(\d{2})/);
    
            if (!partsA || !partsB) return 0;
    
            const dateA = new Date(Date.UTC(
                parseInt(partsA[3]),
                MONTH_INDEX_MAP[partsA[2]],
                parseInt(partsA[1]),
                parseInt(partsA[4]),
                parseInt(partsA[5])
            ));
            const dateB = new Date(Date.UTC(
                parseInt(partsB[3]),
                MONTH_INDEX_MAP[partsB[2]],
                parseInt(partsB[1]),
                parseInt(partsB[4]),
                parseInt(partsB[5])
            ));
    
            return dateA.getTime() - dateB.getTime();
        });
        
        const timeDefPrefix = 'TIMEDEF DURATION = ';
        const mainPadding = ' '.repeat(timeDefPrefix.length);
        timeDef = `${timeDefPrefix}${sortedClauses.join(`,\n${mainPadding}`)};`;
    } else if (data.complexSchedule && data.startTime && data.complexSchedule.dateRanges.length > 0 && data.complexSchedule.timeRanges.length > 0) {
        const { dateRanges, timeRanges } = data.complexSchedule;
        
        const yearStr = data.startTime.substring(0, 2);
        const monthIndex = parseInt(data.startTime.substring(2, 4), 10) - 1;
        const year = 2000 + parseInt(yearStr, 10);
        const month = MONTHS[monthIndex];
        
        const sortedDateRanges = [...dateRanges].sort((a, b) => a.startDay - b.startDay);

        const timeClauses = timeRanges.map(range => {
            const startTimeFmt = `${range.startTime.slice(0, 2)}:${range.startTime.slice(2)}`;
            const endTimeFmt = `${range.endTime.slice(0, 2)}:${range.endTime.slice(2)}`;
            return `(${startTimeFmt} TO ${endTimeFmt})`;
        });
    
        const scheduleClauses = sortedDateRanges.map(dr => {
            const startDay = String(dr.startDay).padStart(2, '0');
            const endDay = String(dr.endDay).padStart(2, '0');
    
            const earliestTime = timeRanges[0].startTime;
            const latestTime = timeRanges[timeRanges.length - 1].endTime;
            const earliestTimeFmt = `${earliestTime.slice(0, 2)}:${earliestTime.slice(2)}`;
            const latestTimeFmt = `${latestTime.slice(0, 2)}:${latestTime.slice(2)}`;
            
            const linePrefix = `${startDay} ${month} ${year} ${earliestTimeFmt} TO ${endDay} ${month} ${year} ${latestTimeFmt}: `;
            const timePadding = ' '.repeat(linePrefix.length);
    
            const timeClausesStr = timeClauses.join(`,\n${timePadding}`);
    
            return `${linePrefix}${timeClausesStr}`;
        });
    
        const timeDefPrefix = 'TIMEDEF DURATION = ';
        const mainPadding = ' '.repeat(timeDefPrefix.length);
        timeDef = `${timeDefPrefix}${scheduleClauses.join(`,\n${mainPadding}`)};`;
    } else if (data.multiTimeRangeSchedule && data.multiTimeRangeSchedule.length > 0 && data.startTime && data.endTime) {
        const overallStartFmt = formatAirlangDate(data.startTime);
        const overallEndFmt = formatAirlangDate(data.endTime);

        const scheduleClauses = data.multiTimeRangeSchedule.map(range => {
            const startTimeFmt = `${range.startTime.slice(0, 2)}:${range.startTime.slice(2)}`;
            const endTimeFmt = `${range.endTime.slice(0, 2)}:${range.endTime.slice(2)}`;
            return `(${startTimeFmt} TO ${endTimeFmt})`;
        });
        
        const timeDefPrefix = `TIMEDEF DURATION = ${overallStartFmt} TO ${overallEndFmt}:`;
        const padding = ' '.repeat(timeDefPrefix.length + 1);
        const scheduleString = scheduleClauses.join(`,\n${padding}`);
        timeDef = `${timeDefPrefix}${scheduleString};`;

    } else if (data.parsedSchedule && data.parsedSchedule.length > 0) {
        // Handle special DLY case
        if (data.parsedSchedule[0]?.month === 'DLY') {
            const schedule = data.parsedSchedule[0];
            const startTimeFmt = `${schedule.startTime.slice(0, 2)}:${schedule.startTime.slice(2)}`;
            const endTimeFmt = `${schedule.endTime.slice(0, 2)}:${schedule.endTime.slice(2)}`;
            const overallStartFmt = data.startTime ? formatAirlangDate(data.startTime) : 'INVALID_START_DATE';
            const overallEndFmt = data.endTime ? formatAirlangDate(data.endTime) : 'INVALID_END_DATE';
            timeDef = `TIMEDEF DURATION = ${overallStartFmt} TO ${overallEndFmt}: (${startTimeFmt} TO ${endTimeFmt});`;
        } else {
             // Sort schedule chronologically
            const sortedSchedule = [...data.parsedSchedule].sort((a, b) => {
                let startYear = 2024; // Default
                let startMonthIndex = 0; // Default
                if (data.startTime && /^\d{10}$/.test(data.startTime)) {
                    startYear = 2000 + parseInt(data.startTime.substring(0, 2), 10);
                    startMonthIndex = parseInt(data.startTime.substring(2, 4), 10) - 1;
                }
                
                const monthA = MONTH_INDEX_MAP[a.month.toUpperCase()];
                const monthB = MONTH_INDEX_MAP[b.month.toUpperCase()];

                let yearA = startYear;
                let yearB = startYear;

                if (monthA < startMonthIndex) yearA += 1;
                if (monthB < startMonthIndex) yearB += 1;

                const dateA = new Date(Date.UTC(yearA, monthA, a.day));
                const dateB = new Date(Date.UTC(yearB, monthB, b.day));

                const dateComparison = dateA.getTime() - dateB.getTime();
                if (dateComparison !== 0) return dateComparison;

                // If dates are the same, sort by start time
                return a.startTime.localeCompare(b.startTime);
            });

            const formattedClauses = sortedSchedule.map(clause => {
                const startTime = `${clause.startTime.slice(0,2)}:${clause.startTime.slice(2)}`;
                const endTime = `${clause.endTime.slice(0,2)}:${clause.endTime.slice(2)}`;
                const monthUpperCase = clause.month.toUpperCase();
                return `${String(clause.day).padStart(2, '0')} ${monthUpperCase}: (${startTime} TO ${endTime})`
            });
            
            const padding = 'TIMEDEF DURATION = '.length;
            timeDef = `TIMEDEF DURATION = ${formattedClauses.join(`,\n${' '.repeat(padding)}`)};`;
        }

    } else if (data.startTime && data.endTime) {
        timeDef = `TIMEDEF DURATION = ${formatAirlangDate(data.startTime)} TO ${formatAirlangDate(data.endTime)};`;
    } else {
        return { 
            code: '', 
            error: "Unable to generate AIRlang: Time definition is missing (e.g., B/C fields or schedule)." 
        };
    }

    let ruleDef = '';
    
    let effectiveNotamType = data.notamType;
    if (data.notamType === NotamType.UNKNOWN && data.areaDefinitions && data.areaDefinitions.length > 0) {
        effectiveNotamType = NotamType.RESTRICTED_AREA_ACTIVATION;
    }

    const handleAreaActivation = (type: 'DANGER' | 'MILITARY' | 'RESTRICTED') => {
        if (data.aerodromes && data.aerodromes.length > 0 && data.areaDefinitions && data.areaDefinitions.length > 0) {
            const areaRules = data.areaDefinitions.map((area: AreaDefinition, index: number) => {
                const lowerFL = feetToFlightLevel(area.lowerAltitudeFeet);
                const upperFL = feetToFlightLevel(area.upperAltitudeFeet);
                
                // Per user examples, lower bound 'SFC' (FL000) should be represented as FL001
                const effectiveLowerFL = lowerFL === 'FL000' ? 'FL001' : lowerFL;
                
                let geometryDef = '';
                if (area.polygon && area.polygon.length > 0) {
                    const polygonCoords = area.polygon
                        .map(formatAirlangCoordinate)
                        .join(',\n            ');
                    geometryDef = `POLYGON(${polygonCoords})`;
                } else if (area.circle) {
                    const centerCoord = formatAirlangCoordinate(area.circle.center);
                    geometryDef = `CIRCLE(${centerCoord}, ${area.circle.radiusNM} NM)`;
                } else {
                    return `// ERROR: Area ${index + 1} has no valid geometry (polygon or circle).`;
                }

                const hasMultipleAreas = data.areaDefinitions.length > 1;
                const areaSuffix = hasMultipleAreas ? String.fromCharCode('A'.charCodeAt(0) + index) : '';
                const notamIdPart = data.notamId || 'NO_ID';
                const aerodromesStr = [...data.aerodromes].sort().join(',');
                const areaDefName = `"${aerodromesStr}_${notamIdPart}${areaSuffix}"`;
    
                return `AREADEF ${areaDefName}\n    ${effectiveLowerFL} TO ${upperFL}\n    TYPE(${type})\n    ${geometryDef}\n    ACTIVE DURATION;`;
            });
            ruleDef = areaRules.join('\n\n');
        }
    };

    switch (effectiveNotamType) {
        case NotamType.RUNWAY_CLOSURE:
            if (data.aerodromes?.[0] && data.affectedElement) {
                const runwayDesignator = data.affectedElement.replace(/^RWY\s+/i, '');
                ruleDef = `RWYDEF ${data.aerodromes[0]} ${runwayDesignator} CLOSED DURATION;`;
            }
            break;
        case NotamType.TAXIWAY_CLOSURE:
            if (data.aerodromes?.[0] && data.affectedElement) ruleDef = `TWYDEF ${data.aerodromes[0]} ${data.affectedElement} CLOSED DURATION;`;
            break;
        case NotamType.APRON_CLOSURE:
            if (data.aerodromes?.[0] && data.affectedElement) ruleDef = `APRONDEF ${data.aerodromes[0]} ${data.affectedElement} CLOSED DURATION;`;
            break;
        case NotamType.NAVAID_UNSERVICEABLE:
             if (data.aerodromes?.[0] && data.affectedElement) ruleDef = `NAVAID ${data.aerodromes[0]} ${data.affectedElement} U/S DURATION;`;
            break;
        case NotamType.LIGHTING_FAILURE:
             if (data.aerodromes?.[0] && data.affectedElement) ruleDef = `LIGHTING ${data.aerodromes[0]} ${data.affectedElement} U/S DURATION;`;
            break;
        case NotamType.AIRSPACE_ACTIVATION:
            if (data.airspaceType && data.airspaceId) ruleDef = `AIRSPACE ${data.airspaceId} TYPE ${data.airspaceType} ACTIVE DURATION;`;
            break;
        case NotamType.DANGER_AREA_ACTIVATION:
            handleAreaActivation('DANGER');
            break;
        case NotamType.MILITARY_AREA_ACTIVATION:
            handleAreaActivation('MILITARY');
            break;
        case NotamType.RESTRICTED_AREA_ACTIVATION:
            handleAreaActivation('RESTRICTED');
            break;
        default:
            return {
                code: `// AI Analysis complete, but no specific rule generated.\n// Reason: ${data.reason || 'Unknown'}\n${timeDef}`,
                error: "Could not determine a known NOTAM type to generate a specific AIRlang rule."
            };
    }
    
    if (!ruleDef) {
        return {
            code: `// Rule generation failed. Please check the parsed output for missing information.\n${timeDef}`,
            error: "Failed to generate a complete AIRlang rule. The AI parsed the data, but required elements were missing or couldn't be identified."
        };
    }

    if (data.recurringSchedule && data.recurringSchedule.timeDefName) {
        ruleDef = ruleDef.replace(/DURATION/g, data.recurringSchedule.timeDefName);
    }

    return { code: `${timeDef}\n\n${ruleDef}` };
};

const App: React.FC = () => {
    const [notamText, setNotamText] = useState<string>('');
    const [parsedData, setParsedData] = useState<ParsedNotam | null>(null);
    const [airlangCode, setAirlangCode] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    const handleAnalyze = useCallback(async () => {
        if (!notamText.trim()) {
            setError("Please enter a NOTAM to analyze.");
            return;
        }
        setIsLoading(true);
        setError(null);
        setParsedData(null);
        setAirlangCode('');

        try {
            const data = await parseNotamWithAI(notamText);
            setParsedData(data);
            const result = generateAirlang(data);
            if (result.error) {
                setError(result.error);
            }
            setAirlangCode(result.code);
        } catch (e) {
            console.error(e);
            setError(e instanceof Error ? `An error occurred: ${e.message}` : "An unknown error occurred during analysis.");
        } finally {
            setIsLoading(false);
        }
    }, [notamText]);
    
    const handleClear = useCallback(() => {
        setNotamText('');
        setParsedData(null);
        setAirlangCode('');
        setError(null);
    }, []);

    return (
        <div className="min-h-screen bg-[#18191F] font-sans p-4 sm:p-8 lg:p-12">
            <div className="max-w-screen-2xl mx-auto">
                <header className="mb-12">
                    <div className="flex justify-center items-baseline gap-4">
                         <h1 className="text-5xl font-black bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent" style={{ fontFamily: "'Inter', sans-serif" }}>
                            FLYLANG
                        </h1>
                        <p className="text-lg text-gray-400">
                            I speak fluent NOTAM
                        </p>
                    </div>
                </header>

                <main className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div className="flex flex-col gap-8 animate-fade-in-up" style={{ opacity: 0 }}>
                        <NotamInput 
                            value={notamText}
                            onChange={(e) => setNotamText(e.target.value)}
                            onAnalyze={handleAnalyze}
                            onClear={handleClear}
                            isLoading={isLoading}
                        />

                        {error && (
                            <div className="bg-red-500/10 border border-red-500/30 text-red-300 p-4 rounded-xl flex items-start gap-3">
                                <AlertTriangle className="h-5 w-5 mt-0.5 flex-shrink-0 text-red-400" />
                                <span className="font-medium">{error}</span>
                            </div>
                        )}

                        <div className="bg-[#242631] rounded-2xl shadow-2xl shadow-black/20">
                            <div className="p-5 border-b border-white/10">
                                <h2 className="flex items-center gap-3 text-lg font-bold text-white">
                                    <ClipboardList className="h-6 w-6 text-cyan-400" />
                                    <span>NOTAM Analysis</span>
                                </h2>
                            </div>
                            <div className="p-6">
                                <ParsedOutput data={parsedData} isLoading={isLoading} />
                            </div>
                        </div>
                    </div>

                    <div 
                        className="bg-[#242631] rounded-2xl shadow-2xl shadow-black/20 animate-fade-in-up" 
                        style={{ opacity: 0, animationDelay: '200ms' }}
                    >
                        <div className="p-5 border-b border-white/10">
                            <h2 className="flex items-center gap-3 text-lg font-bold text-white">
                                <FileText className="h-6 w-6 text-cyan-400" />
                                <span>Generated AIRlang Code</span>
                            </h2>
                        </div>
                        <div className="p-6">
                           <AirlangOutput code={airlangCode} isLoading={isLoading} />
                        </div>
                    </div>
                </main>
                 <footer className="text-center mt-12 py-6">
                    <p className="text-gray-500 text-sm">
                        Powered by Gemini AI. Flylang is a tool to assist, not replace, expert analysis.
                    </p>
                </footer>
            </div>
        </div>
    );
};

export default App;
