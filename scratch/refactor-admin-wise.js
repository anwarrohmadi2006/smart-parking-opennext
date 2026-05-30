const fs = require('fs');
const file = 'app/admin/page.tsx';
let code = fs.readFileSync(file, 'utf8');

// Global styling replacements for Wise design
code = code.replace(/bg-slate-50/g, 'bg-wise-canvas-soft');
code = code.replace(/bg-slate-900/g, 'bg-wise-ink');
code = code.replace(/bg-white/g, 'bg-wise-canvas');
code = code.replace(/text-slate-800/g, 'text-wise-ink');
code = code.replace(/text-slate-700/g, 'text-wise-ink');
code = code.replace(/text-slate-600/g, 'text-wise-body');
code = code.replace(/text-slate-500/g, 'text-wise-mute');
code = code.replace(/text-slate-400/g, 'text-wise-mute');
code = code.replace(/text-white/g, 'text-wise-canvas');
code = code.replace(/border-slate-100/g, 'border-wise-canvas-soft');
code = code.replace(/border-slate-200/g, 'border-wise-canvas-soft');
code = code.replace(/border-slate-800/g, 'border-wise-ink');
code = code.replace(/shadow-sm/g, 'shadow-[0_8px_30px_rgb(0,0,0,0.04)]');

// Dashboard Cards (White cards on Sage Canvas)
code = code.replace(/rounded-2xl/g, 'rounded-[24px]');
code = code.replace(/rounded-xl/g, 'rounded-[16px]');
code = code.replace(/rounded-lg/g, 'rounded-[12px]');

// Primary Buttons (Blue to Lime Green)
code = code.replace(/bg-blue-600 hover:bg-blue-700 text-white/g, 'bg-wise-primary hover:bg-wise-primary-active text-wise-ink font-semibold border-none');
code = code.replace(/text-blue-600/g, 'text-wise-primary'); // text accent
code = code.replace(/text-blue-500/g, 'text-wise-primary'); 
code = code.replace(/bg-blue-100 text-blue-700/g, 'bg-wise-primary-pale text-wise-ink-deep'); // badge
code = code.replace(/bg-blue-50 text-blue-700/g, 'bg-wise-primary-pale text-wise-ink-deep'); // badge

// Secondary/Positive/Negative
code = code.replace(/bg-emerald-600 hover:bg-emerald-700 text-white/g, 'bg-wise-positive hover:bg-wise-positive-deep text-white font-semibold');
code = code.replace(/bg-rose-500 hover:bg-rose-600 text-white/g, 'bg-wise-negative hover:bg-wise-negative-deep text-white font-semibold');
code = code.replace(/bg-red-500 hover:bg-red-600 text-white/g, 'bg-wise-negative hover:bg-wise-negative-deep text-white font-semibold');
code = code.replace(/text-emerald-500/g, 'text-wise-positive');
code = code.replace(/text-emerald-600/g, 'text-wise-positive');
code = code.replace(/bg-emerald-100 text-emerald-700/g, 'bg-wise-primary-pale text-wise-positive-deep'); // success badge
code = code.replace(/bg-emerald-50 text-emerald-700/g, 'bg-wise-primary-pale text-wise-positive-deep');
code = code.replace(/bg-red-100 text-red-700/g, 'bg-wise-negative-bg text-white'); // error badge
code = code.replace(/bg-red-50 text-red-700/g, 'bg-wise-negative-bg text-white');
code = code.replace(/bg-yellow-100 text-yellow-700/g, 'bg-wise-warning text-wise-warning-content'); // warning badge

// Sidebar
code = code.replace(/bg-slate-800/g, 'bg-[#20221e]');
code = code.replace(/text-slate-300/g, 'text-wise-canvas-soft');

// Sidebar logic
code = code.replace(/bg-blue-600 text-white/g, 'bg-wise-primary text-wise-ink');

// Emojis replacement
code = code.replace(/🤖/g, '');
code = code.replace(/✅/g, '');
code = code.replace(/⚠/g, '');
code = code.replace(/🔴/g, '');
code = code.replace(/🌧/g, '');
code = code.replace(/☀/g, '');
code = code.replace(/🚨/g, '');
code = code.replace(/↗/g, '');
code = code.replace(/↘/g, '');
code = code.replace(/➡/g, '');
code = code.replace(/👍/g, '');
code = code.replace(/👎/g, '');

fs.writeFileSync(file, code);
console.log('Admin Page refactored');
