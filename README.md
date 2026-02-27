# 🎮 Looty Panel

![Looty Panel Logo](public/logo_lootypanel.png)

Looty Panel is a professional, modern, and lightweight Minecraft server management panel designed for high performance and ease of use. It provides a comprehensive suite of tools to manage, monitor, and automate your Minecraft servers from a sleek web interface.

## 📸 Screenshots

<p align="center">
  <img src="public/Screenshots/Screenshot%202026-02-15%20163001.png" width="280" />
  <img src="public/Screenshots/Screenshot%202026-02-15%20163036.png" width="280" />
  <img src="public/Screenshots/Screenshot%202026-02-15%20163056.png" width="280" />
</p>
<p align="center">
  <img src="public/Screenshots/Screenshot%202026-02-15%20163122.png" width="280" />
  <img src="public/Screenshots/Screenshot%202026-02-15%20163142.png" width="280" />
  <img src="public/Screenshots/Screenshot%202026-02-15%20163156.png" width="280" />
</p>

> **Tip:** Run `npm run optimize-screenshots` before committing to compress images and reduce repo size.

---

## ✨ Features

### 🚀 Server Management
- **Multiple Server Types**: Native support for Paper, Spigot, Purpur, Vanilla, Fabric, and Forge
- **Server Rearrangement**: Drag-and-drop to reorder servers on your dashboard
- **Auto-Start**: Configure servers to automatically start when the panel boots
- **Dynamic Path Resolution**: Panel works even if you move the installation directory

### 💻 Console & Commands
- **Interactive Console**: Full real-time console access powered by WebSockets
- **Quick Commands**: Custom command buttons with drag-and-drop arrangement
  - Pre-built commands for item giving, LuckPerms integration
  - Support for placeholders like `{player}`, `{item}`, `{group}`
  - Add unlimited custom command shortcuts
- **Console Tools**: Clear console, chat mode toggle, ANSI color code stripping

### 📂 File Management
- **Web File Explorer**: Browse, edit, upload, and manage server files
- **File Search**: Quickly find files in your server directories
- **Mass Actions**: Select multiple files with checkboxes for bulk operations
- **Custom Context Menu**: Right-click files for Open, Edit, Download, Delete options
- **Drag & Drop Upload**: Easy file uploads directly in the browser

### 🧩 Plugin Management
- **Plugin Browser**: Search and download plugins directly within the panel
- **Plugin Detection**: Automatically detects installed plugins (e.g., LuckPerms)
- **One-Click Install**: Download and install plugins without leaving the panel

### 💾 Backup System
- **Automated Backups**: Schedule regular backups with cron expressions
- **One-Click Backup**: Create manual backups anytime
- **Backup Retention**: Automatic cleanup of old backups based on retention policy
- **Easy Restore**: Restore from any backup in seconds
- **Safety First**: Prevents backups while server is running (prevents file locks on Windows)

### ⏰ Task Scheduler
- **Cron-Based Scheduling**: Flexible scheduling for any task
- **Task Types**:
  - Server restart
  - Create backup
  - Send console command
  - Broadcast message to players
- **Execution History**: Track when scheduled tasks last ran

### 📊 Monitoring & Alerts
- **Real-time Monitoring**: Track CPU and Memory usage with live dashboard statistics
- **Windows Resource Metrics**: Native Windows performance monitoring with PowerShell fallback
- **Alert System**: Discord webhook and email notifications for:
  - Server crashes
  - Backup failures
  - Server restarts (optional)
- **Minecraft Query**: Check server status and player count via query protocol

### 👥 User Management
- **Multi-User Access**: Secure role-based access control
- **User Roles**: Administrator and standard user roles
- **Password Security**: BCrypt password hashing with visibility toggles

### 🔒 Security & Authentication
- **JWT-Based Authentication**: Secure token-based sessions
- **Password Hashing**: Industry-standard BCrypt encryption
- **Automatic SSL/HTTPS**: Self-signed certificate generation for secure access

### 📱 Mobile & UI
- **Mobile Optimized**: Fully responsive design with touch-friendly controls
- **Sidebar Overlay**: Optimized navigation for mobile devices
- **Modern Interface**: Clean, intuitive UI with smooth animations

### 🪟 Windows Service Integration
- **Daemon Mode**: Run as a Windows service for 24/7 operation
- **Service Installation**: Built-in Windows service installer
- **Service Monitoring**: Dashboard notification if service isn't installed

---

## 🛠️ Technology Stack

- **Backend**: Node.js, Express
- **Database**: SQLite (via SQL.js)
- **Frontend**: Vanilla JavaScript (SPA), Modern CSS3
- **Communication**: WebSockets (WS)
- **Security**: JWT, BCrypt, Node-forge (SSL)
- **Scheduling**: node-cron
- **Archiving**: archiver (backups)

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v16 or higher recommended)
- Java Runtime Environment (JRE) installed for the Minecraft versions you intend to run
- Windows (for service/daemon features) or Linux

### Installation

#### Option 1: Windows Installer (Recommended for Windows Users)

The easiest way to get started on Windows:

1. **Download the installer** from [GitHub Releases](https://github.com/TVDOfficial/Looty-Panel/releases)
   - Look for `LootyPanel-Setup.exe` in the latest release

2. **Run the installer** and follow the setup wizard
   - Choose installation location (default: `C:\Program Files\LootyPanel`)
   - Optionally install as a Windows Service (runs automatically on boot)

3. **Launch Looty Panel**:
   - Desktop shortcut or Start Menu → LootyPanel
   - Your browser will open automatically

4. **First-time setup**:
   - Create your admin account when prompted
   - Start adding your Minecraft servers!

#### Option 2: Manual Installation (Developers / Linux)

1. **Clone the repository**:
   ```bash
   git clone https://github.com/TVDOfficial/Looty-Panel.git
   cd Looty-Panel
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start the server**:
   ```bash
   npm start
   ```

4. **Access the panel**:
   Open your browser and navigate to `http://localhost:8080` (or the configured port).

### Windows Service Setup (Optional)

To run Looty Panel as a Windows service for automatic startup:

- **During installation**: Check "Install LootyPanel as a Windows Service" in the installer
- **After installation**: Go to Management → Install Windows Service in the web panel

The service will start automatically on Windows boot, allowing your servers to run 24/7 without a user logged in.

---

## 📝 Configuration

### Environment Variables

Create a `.env` file in the root directory:

```env
PORT=8080
BASE_DIR=/path/to/installation
BACKUPS_DIR=/path/to/backups
```

### Server Settings

Each server can be configured with:
- **Memory Allocation**: Set min/max RAM (e.g., `1G`, `512M`)
- **Java Arguments**: Custom JVM flags
- **Auto-Start**: Start server when panel boots
- **Working Directory**: Dynamic path resolution supported

---

## 🔔 Alert Configuration

Configure alerts in the Management section:

### Discord Webhooks
- Add your Discord webhook URL
- Choose events: Crash, Backup Fail, Restart

### Email Alerts
- SMTP server configuration
- Recipient email address
- TLS/SSL support

---

## 📖 Usage Tips

### Quick Commands
1. Open a server console
2. Click "+ Add" to create custom command buttons
3. Use placeholders like `{player}`, `{item}` for interactive prompts
4. Drag to reorder commands

### File Manager
- Right-click any file for context menu options
- Use checkboxes for mass delete/download operations
- Search box filters files in real-time

### Server Rearrangement
- On the dashboard, drag server cards to reorder
- Order is saved automatically

### Backup Best Practices
- Always stop server before backup (panel enforces this)
- Set retention policy to manage disk space
- Schedule backups during low-traffic periods

---

## 🛡️ Security Notes

- Change default admin credentials immediately after first login
- Use strong passwords (panel enforces complexity)
- Enable SSL/HTTPS for remote access
- Keep the panel behind a firewall for production use
- Regularly update dependencies with `npm audit fix`

---

## 🐛 Troubleshooting

### Server shows "stopped" but Java is running
This happens when the server is started outside the panel. To fix:
1. Stop the Java process manually
2. Start the server FROM Looty Panel
3. Enable "Auto Start" in server settings for proper tracking

### Backup fails with EBUSY error
The server must be stopped before creating backups on Windows (file lock prevention). The panel will warn you if you try to backup a running server.

### Mobile view issues
The panel is fully responsive. If you see desktop view on mobile, try:
- Clearing browser cache
- Checking "Request Desktop Site" is disabled
- Rotating device to refresh layout

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

---

## 🙏 Acknowledgments

- Built with ❤️ for the Minecraft community
- Special thanks to all contributors and testers
- Powered by open-source software

---

**Need Help?** Open an issue on GitHub or join our community discussions.

Built with ❤️ for the Minecraft community.
