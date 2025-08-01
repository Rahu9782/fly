
import React, { useState, useEffect } from 'react';
import { Copy, Check } from 'lucide-react';

interface AirlangOutputProps {
    code: string;
    isLoading: boolean;
}

export const AirlangOutput: React.FC<AirlangOutputProps> = ({ code, isLoading }) => {
    const [isCopied, setIsCopied] = useState(false);

    useEffect(() => {
        if (!code) {
            setIsCopied(false);
        }
    }, [code]);

    const handleCopy = () => {
        if (code) {
            navigator.clipboard.writeText(code);
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
        }
    };
    
    if (isLoading) {
        return (
             <div className="space-y-4 animate-pulse">
                <div className="h-5 bg-gray-700 rounded-full w-full"></div>
                <div className="h-5 bg-gray-600 rounded-full w-2/3"></div>
                <div className="h-5 bg-gray-700 rounded-full w-full"></div>
                <div className="h-5 bg-gray-600 rounded-full w-3/4"></div>
            </div>
        )
    }

    if (!code) {
        return <div className="text-gray-500 italic text-center py-12">AIRlang code will appear here...</div>;
    }

    return (
        <div 
            className="relative group animate-fade-in-item" 
            key={code} 
            style={{ opacity: 0 }}
        >
            <pre className="bg-[#18191F] text-cyan-300 p-4 rounded-xl text-sm font-mono overflow-x-auto border-2 border-[#4A4E69]">
                <code>{code}</code>
            </pre>
            <button
                onClick={handleCopy}
                className="absolute top-3 right-3 p-2 bg-[#242631] text-gray-400 hover:bg-cyan-500/10 hover:text-white rounded-full transition-all opacity-50 group-hover:opacity-100"
                aria-label="Copy code"
            >
                {isCopied ? <Check className="h-5 w-5 text-green-400" /> : <Copy className="h-5 w-5" />}
            </button>
        </div>
    );
};