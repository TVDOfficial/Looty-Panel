// Fix for LootyPanel CPU display
// Changes CPU from "sum of all cores" (0-400%+) to normalized percentage (0-100%)

const fs = require('fs');
const path = require('path');

const serverManagerPath = path.join(__dirname, 'services', 'serverManager.js');

if (!fs.existsSync(serverManagerPath)) {
    console.error('Error: serverManager.js not found at', serverManagerPath);
    process.exit(1);
}

let content = fs.readFileSync(serverManagerPath, 'utf8');

// Check if already fixed
if (content.includes('os.cpus().length') && content.includes('normalized')) {
    console.log('CPU fix already applied!');
    process.exit(0);
}

// Find and replace the CPU calculation section
const oldCode = `if (prev && (now - prev.ts) > 500) {
            const deltaSec = (now - prev.ts) / 1000;
            const deltaCpu = win.cpuSeconds - prev.cpuSec;
            if (deltaSec > 0 && deltaCpu >= 0) {
                cpu = Math.round((deltaCpu / deltaSec) * 100 * 100) / 100; // % across all cores
            }
        }`;

const newCode = `if (prev && (now - prev.ts) > 500) {
            const deltaSec = (now - prev.ts) / 1000;
            const deltaCpu = win.cpuSeconds - prev.cpuSec;
            if (deltaSec > 0 && deltaCpu >= 0) {
                const numCpus = os.cpus().length || 1;
                cpu = Math.round((deltaCpu / deltaSec) * 100 / numCpus * 100) / 100; // normalized %
            }
        }`;

if (content.includes(oldCode)) {
    content = content.replace(oldCode, newCode);
    fs.writeFileSync(serverManagerPath, content, 'utf8');
    console.log('Γ£à CPU fix applied successfully!');
    console.log('   CPU will now show 0-100% instead of 0-400%+');
    console.log('');
    console.log('Please restart LootyPanel service for changes to take effect:');
    console.log('  net stop lootpanel.exe');
    console.log('  net start lootpanel.exe');
} else {
    console.error('Error: Could not find the exact code to replace.');
    console.error('The file may have been modified differently.');
    process.exit(1);
}
