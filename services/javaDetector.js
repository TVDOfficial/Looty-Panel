const { execSync, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');

function detectJavaInstallations() {
    const installations = [];
    const seen = new Set();

    // Check JAVA_HOME
    if (process.env.JAVA_HOME) {
        const javaPath = path.join(process.env.JAVA_HOME, 'bin', 'java.exe');
        if (fs.existsSync(javaPath)) {
            const info = getJavaVersion(javaPath);
            if (info && !seen.has(javaPath.toLowerCase())) {
                installations.push(info);
                seen.add(javaPath.toLowerCase());
            }
        }
    }

    // Check PATH
    try {
        const whereOutput = execSync('where java', { encoding: 'utf-8', timeout: 5000 }).trim();
        for (const line of whereOutput.split('\n')) {
            const javaPath = line.trim();
            if (javaPath && fs.existsSync(javaPath) && !seen.has(javaPath.toLowerCase())) {
                const info = getJavaVersion(javaPath);
                if (info) {
                    installations.push(info);
                    seen.add(javaPath.toLowerCase());
                }
            }
        }
    } catch (e) {
        // 'where java' might fail if not in PATH
    }

    // Check common install directories
    for (const searchPath of config.JAVA_SEARCH_PATHS) {
        if (!fs.existsSync(searchPath)) continue;
        try {
            const entries = fs.readdirSync(searchPath, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const javaPath = path.join(searchPath, entry.name, 'bin', 'java.exe');
                    if (fs.existsSync(javaPath) && !seen.has(javaPath.toLowerCase())) {
                        const info = getJavaVersion(javaPath);
                        if (info) {
                            installations.push(info);
                            seen.add(javaPath.toLowerCase());
                        }
                    }
                }
            }
        } catch (e) {
            // Skip directories we can't read
        }
    }

    return installations;
}

function getJavaVersion(javaPath) {
    try {
        const output = execSync(`"${javaPath}" -version 2>&1`, { encoding: 'utf-8', timeout: 10000 });
        const match = output.match(/(?:java|openjdk)\s+version\s+"([^"]+)"/i) ||
            output.match(/(?:java|openjdk)\s+(\d+[\.\d]*)/i);
        if (match) {
            const version = match[1];
            const majorMatch = version.match(/^1\.(\d+)/) || version.match(/^(\d+)/);
            const majorVersion = majorMatch ? parseInt(majorMatch[1]) : 0;
            return {
                path: javaPath,
                version,
                majorVersion,
                display: `Java ${majorVersion} (${version})`,
            };
        }
    } catch (e) {
        // Failed to get version
    }
    return null;
}

function validateJavaForMC(javaPath, mcVersion) {
    const info = getJavaVersion(javaPath);
    if (!info) return { valid: false, error: 'Could not detect Java version' };

    // MC 1.17+ requires Java 16+, 1.18+ requires Java 17+, 1.20.5+ requires Java 21+
    const [major, minor] = mcVersion.split('.').map(Number);
    let requiredJava = 8;
    if (major >= 1 && minor >= 21) requiredJava = 21;
    else if (major >= 1 && minor >= 18) requiredJava = 17;
    else if (major >= 1 && minor >= 17) requiredJava = 16;

    if (info.majorVersion < requiredJava) {
        return {
            valid: false,
            error: `Minecraft ${mcVersion} requires Java ${requiredJava}+, but found Java ${info.majorVersion}`,
        };
    }

    return { valid: true, info };
}

module.exports = { detectJavaInstallations, getJavaVersion, validateJavaForMC };
