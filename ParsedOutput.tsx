
import React from 'react';
import { ParsedNotam } from '../types';

interface ParsedOutputProps {
    data: ParsedNotam | null;
    isLoading: boolean;
}

const DetailItem: React.FC<{ label: string; value?: string | null | undefined; isBadge?: boolean; children?: React.ReactNode }> = ({ label, value, isBadge = false, children }) => {
    if (!value && !children) return null;
    return (
        <div>
            <dt className="text-sm font-medium text-gray-400 capitalize">{label}</dt>
            {value && (isBadge ? (
                 <dd className="mt-1 text-sm text-cyan-200 bg-cyan-500/10 inline-block px-3 py-1 rounded-full font-semibold">{value.replace(/_/g, ' ')}</dd>
            ) : (
                <dd className="mt-1 text-base text-gray-100 font-mono whitespace-pre-wrap">{value}</dd>
            ))}
            {children && <dd className="mt-1 text-base text-gray-100 font-mono">{children}</dd>}
        </div>
    );
};

export const ParsedOutput: React.FC<ParsedOutputProps> = ({ data, isLoading }) => {
    if (isLoading) {
        return (
            <div className="space-y-6 animate-pulse">
                <div className="flex items-center gap-4">
                    <div className="h-5 bg-gray-700 rounded-full w-1/4"></div>
                    <div className="h-5 bg-gray-600 rounded-full w-1/2"></div>
                </div>
                 <div className="flex items-center gap-4">
                    <div className="h-5 bg-gray-700 rounded-full w-1/4"></div>
                    <div className="h-5 bg-gray-600 rounded-full w-1/3"></div>
                </div>
                <div className="flex items-center gap-4">
                    <div className="h-5 bg-gray-700 rounded-full w-1/4"></div>
                    <div className="h-5 bg-gray-600 rounded-full w-3/4"></div>
                </div>
                <div className="flex items-center gap-4">
                    <div className="h-5 bg-gray-700 rounded-full w-1/4"></div>
                    <div className="h-5 bg-gray-600 rounded-full w-1/2"></div>
                </div>
            </div>
        )
    }

    if (!data) {
        return <div className="text-gray-500 italic text-center py-12">Awaiting NOTAM analysis...</div>;
    }

    const renderableItems: React.ReactNode[] = [];

    if (data.notamType) {
        renderableItems.push(<DetailItem key="notamType" label="NOTAM Type" value={data.notamType} isBadge />);
    }
    if (data.notamId) {
        renderableItems.push(<DetailItem key="notamId" label="NOTAM ID" value={data.notamId} />);
    }
    if (data.aerodromes?.length) {
        renderableItems.push(<DetailItem key="aerodromes" label="Aerodromes" value={data.aerodromes.join(', ')} />);
    }
    if (data.affectedElement) {
        renderableItems.push(<DetailItem key="affectedElement" label="Affected Element" value={data.affectedElement} />);
    }
    if (data.airspaceType) {
        renderableItems.push(<DetailItem key="airspaceType" label="Airspace Type" value={data.airspaceType} />);
    }
    if (data.airspaceId) {
        renderableItems.push(<DetailItem key="airspaceId" label="Airspace ID" value={data.airspaceId} />);
    }

    if (data.areaDefinitions && data.areaDefinitions.length > 0) {
        renderableItems.push(
            <DetailItem key="areaDefinitions" label="Defined Areas">
                <div className="space-y-4 mt-2">
                    {data.areaDefinitions.map((area, index) => (
                        <div key={index} className="bg-[#18191F] p-4 rounded-xl border border-white/10">
                            <p className="font-bold text-white">Area {index + 1}: <span className="font-semibold text-cyan-300">{area.lowerAltitudeFeet}FT - {area.upperAltitudeFeet}FT</span></p>
                            {area.polygon && <p className="mt-2 text-xs whitespace-pre-wrap break-all text-gray-400">Polygon: {area.polygon.join(', ')}</p>}
                            {area.circle && <p className="mt-2 text-xs text-gray-400">Circle: {area.circle.radiusNM}NM radius at {area.circle.center}</p>}
                        </div>
                    ))}
                </div>
            </DetailItem>
        );
    }
    
    if (data.dailyScheduleWithRanges && data.dailyScheduleWithRanges.length > 0) {
        renderableItems.push(
             <DetailItem key="dailySchedule" label="Daily Schedule with Ranges">
                 <div className="space-y-2 mt-1 text-sm font-mono">
                    {data.dailyScheduleWithRanges.map(ds => (
                        <div key={`${ds.startDay}-${ds.endDay}`}>
                            <span className="font-semibold text-gray-300">Day(s) {ds.startDay}{ds.startDay !== ds.endDay ? `-${ds.endDay}` : ''}: </span>
                            <span className="font-normal text-gray-100">{ds.timeRanges.map(tr => `${tr.startTime}-${tr.endTime}`).join(', ')}</span>
                        </div>
                    ))}
                </div>
            </DetailItem>
        );
    }

    if (data.detailedSchedule && data.detailedSchedule.length > 0) {
        renderableItems.push(
            <DetailItem key="detailedSchedule" label="Detailed Schedule">
                 <div className="space-y-2 mt-1 text-sm font-mono">
                    {data.detailedSchedule.map(ds => (
                        <div key={ds.day}>
                            <span className="font-semibold text-gray-300">Day {ds.day}: </span>
                            <span className="font-normal text-gray-100">{ds.timeRanges.map(tr => `${tr.startTime}-${tr.endTime}`).join(', ')}</span>
                        </div>
                    ))}
                </div>
            </DetailItem>
        );
    }

    if (data.complexSchedule) {
        renderableItems.push(
            <DetailItem key="complexSchedule" label="Complex Schedule">
                <div className="space-y-2 mt-1 text-sm font-mono">
                    <p><span className="font-semibold text-gray-300">Date Ranges: </span><span className="font-normal text-gray-100">{data.complexSchedule.dateRanges.map(dr => `${dr.startDay}-${dr.endDay}`).join(', ')}</span></p>
                    <p><span className="font-semibold text-gray-300">Time Ranges: </span><span className="font-normal text-gray-100">{data.complexSchedule.timeRanges.map(tr => `${tr.startTime}-${tr.endTime}`).join(', ')}</span></p>
                </div>
            </DetailItem>
        );
    }

    if (data.recurringSchedule) {
        if (data.recurringSchedule.timeDefName) {
            renderableItems.push(<DetailItem key="recScheduleName" label="Schedule Name" value={data.recurringSchedule.timeDefName} />);
        }
        const recurringClausesText = data.recurringSchedule.clauses?.map(c => `${c.day}: ${c.startTime}-${c.endTime}`).join('\n');
        if (recurringClausesText) {
            renderableItems.push(<DetailItem key="recScheduleClauses" label="Recurring Schedule" value={recurringClausesText} />);
        }
    }

    if (data.parsedSchedule && data.parsedSchedule.length > 0) {
        const scheduleText = data.parsedSchedule.map(s => `${s.day} ${s.month} ${s.startTime}-${s.endTime}`).join(', ');
        renderableItems.push(<DetailItem key="parsedSchedule" label="Parsed Date List" value={scheduleText} />);
    }
    
    if (data.startTime) {
        renderableItems.push(<DetailItem key="startTime" label="Overall Start Time (UTC)" value={data.startTime} />);
    }
    if (data.endTime) {
        renderableItems.push(<DetailItem key="endTime" label="Overall End Time (UTC)" value={data.endTime} />);
    }
    if (data.reason) {
        renderableItems.push(<DetailItem key="reason" label="Reason" value={data.reason} />);
    }

    return (
        <dl className="space-y-5">
            {renderableItems.map((item, index) => (
                <div
                    key={index} // Using index is fine as the list is static per render
                    className="animate-fade-in-item"
                    style={{ animationDelay: `${index * 100}ms`, opacity: 0 }}
                >
                    {item}
                </div>
            ))}
        </dl>
    );
};