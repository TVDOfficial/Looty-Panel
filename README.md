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

- **🚀 Multiple Server Types**: Native support for Paper, Spigot, Purpur, Vanilla, Fabric, and Forge.
- **📊 Real-time Monitoring**: Track CPU and Memory usage with live dashboard statistics.
- **💻 Interactive Console**: Full real-time console access powered by WebSockets.
- **📂 File Management**: Integrated web-based file explorer for easy configuration and file uploads.
- **🧩 Plugin Manager**: Search, download, and manage plugins directly within the panel.
- **💾 Automated Backups**: Create and restore server backups to keep your data safe.
- **⏰ Task Scheduler**: Automate restarts, commands, and maintenance tasks.
- **👤 Multi-User Access**: Secure role-based access control for administrators and users.
- **🔒 Security First**: JWT-based authentication, password hashing, and automatic SSL/HTTPS certificate generation.

## 🛠️ Technology Stack

- **Backend**: Node.js, Express
- **Database**: SQLite (via SQL.js)
- **Frontend**: Vanilla JavaScript (SPA), Modern CSS3
- **Communication**: WebSockets (WS)
- **Security**: JWT, BCrypt, Node-forge (SSL)

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v16 or higher recommended)
- Java Runtime Environment (JRE) installed for the Minecraft versions you intend to run.

### Installation

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
   Open your browser and navigate to `http://localhost:3000`.

### First-Run Setup

Upon your first visit, Looty Panel will prompt you to create an administrator account. This ensures your panel is secure from the very first boot.

## 📝 License

Distributed under the MIT License. See `LICENSE` for more information.

---
Built with ❤️ for the Minecraft community.
