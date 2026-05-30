const fs = require('fs');
let code = fs.readFileSync('app/admin/page.tsx', 'utf8');

// Global styling replacements for sleek dark mode
code = code.replace(/bg-\[#FFFFFF\]/g, 'bg-slate-950');
code = code.replace(/bg-white/g, 'bg-slate-900');
code = code.replace(/bg-\[#E5E5E5\]/g, 'bg-slate-800/50 border border-slate-700/50 backdrop-blur-md');
code = code.replace(/bg-\[#D9D9D9\]/g, 'bg-slate-900/60 backdrop-blur-xl border border-slate-800');
code = code.replace(/bg-\[#999999\]/g, 'bg-slate-800');
code = code.replace(/bg-black/g, 'bg-blue-600 hover:bg-blue-500');
code = code.replace(/text-black/g, 'text-white');
code = code.replace(/text-gray-500/g, 'text-slate-400');
code = code.replace(/text-gray-400/g, 'text-slate-500');
code = code.replace(/text-gray-600/g, 'text-slate-300');
code = code.replace(/border-\[#E5E5E5\]/g, 'border-slate-800');
code = code.replace(/border-\[#999999\]/g, 'border-slate-800');
code = code.replace(/border-b-\[4px\]/g, 'border-b');
code = code.replace(/shadow-sm/g, 'shadow-lg shadow-black/20');
code = code.replace(/shadow-inner/g, 'shadow-inner shadow-black/40');
code = code.replace(/bg-\[#8CC665\]/g, 'bg-emerald-500');
code = code.replace(/bg-\[#EB645B\]/g, 'bg-rose-500');
code = code.replace(/accent-black/g, 'accent-blue-500');

fs.writeFileSync('app/admin/page.tsx', code);
console.log('Refactoring complete.');
