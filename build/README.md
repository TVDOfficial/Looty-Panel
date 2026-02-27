# LootyPanel Portable Packager

This script creates a portable, self-contained LootyPanel package that users can run without installing Node.js.

## What It Creates

```
LootyPanel-Portable/
├── LootyPanel.exe          # Launcher (small C# or Go wrapper)
├── node/                   # Bundled Node.js runtime
├── app/                    # Your application code
├── data/                   # User data (servers, backups, db)
└── install-service.exe     # Optional service installer
```

## Prerequisites

1. Install NSIS (Nullsoft Scriptable Install System)
   - Download from: https://nsis.sourceforge.io/Download
   - Install with default settings

2. Download Node.js Windows Binary (zip, not installer)
   - https://nodejs.org/dist/latest/win-x64/node.exe
   - Place in `build/node/` folder

## Building

### Quick Build (Portable Folder)

```bash
npm run build:portable
```

Creates `dist/LootyPanel-Portable/` folder.

### Full Build (Installer)

```bash
npm run build:installer
```

Creates `dist/LootyPanel-Setup.exe` installer.

## How It Works

### Launcher (LootyPanel.exe)
1. Checks if `node/` exists
2. If not, shows "First Run" dialog to download Node.js
3. Starts `node app/server.js`
4. Opens browser to `http://localhost:8080`

### Service Installation
- Uses built-in `node-windows` (already in your code)
- Installer runs `install-service.exe` which calls your daemonInstaller.js
- No external dependencies needed!

## Distribution

Upload to GitHub Releases:
1. Go to GitHub repo → Releases → Draft New Release
2. Upload `LootyPanel-Setup.exe`
3. Add release notes
4. Publish

Users download → Run installer → Done!
