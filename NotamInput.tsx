import React from 'react';
import { Rocket, XCircle } from 'lucide-react';

interface NotamInputProps {
    value: string;
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    onAnalyze: () => void;
    onClear: () => void;
    isLoading: boolean;
}

export const NotamInput: React.FC<NotamInputProps> = ({ value, onChange, onAnalyze, onClear, isLoading }) => {
    return (
        <div className="bg-[#242631] rounded-2xl p-6 shadow-2xl shadow-black/20">
            <label htmlFor="notam-input" className="block text-xl font-bold text-white mb-4">
                Raw NOTAM Input
            </label>
            
            <textarea
                id="notam-input"
                value={value}
                onChange={onChange}
                placeholder="(G2571/25 NOTAMN..."
                className="w-full h-64 bg-[#18191F] border-2 border-gray-600 rounded-xl p-4 text-gray-300 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50 transition-shadow duration-300 resize-y"
                disabled={isLoading}
            />

            <div className="mt-5 flex flex-col sm:flex-row gap-4">
                <button
                    onClick={onAnalyze}
                    disabled={isLoading || !value.trim()}
                    className="w-full sm:w-auto flex-grow inline-flex items-center justify-center px-8 py-3 text-base font-bold rounded-full shadow-lg text-white bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 focus:outline-none focus:ring-4 focus:ring-cyan-500/50 disabled:bg-gray-600 disabled:from-gray-600 disabled:to-gray-700 disabled:cursor-not-allowed transition-all duration-300 transform hover:scale-105"
                >
                    {isLoading ? (
                        <>
                            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Analyzing...
                        </>
                    ) : (
                        <>
                            <Rocket className="mr-2 -ml-1 h-5 w-5" />
                            Analyze & Generate
                        </>
                    )}
                </button>
                 <button
                    onClick={onClear}
                    disabled={isLoading || !value.trim()}
                    className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-3 text-base font-bold rounded-full text-gray-300 bg-transparent border-2 border-gray-600 hover:bg-gray-700 hover:text-white focus:outline-none focus:ring-4 focus:ring-gray-500/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    <XCircle className="mr-2 -ml-1 h-5 w-5" />
                    Clear
                </button>
            </div>
        </div>
    );
};