# eSSL Biometric Attendance Synchronization Agent (Windows Service)

Production-ready, lightweight background synchronization agent connecting an on-premise **eSSL biometric attendance system running eTimeTrackLite Desktop 12.2 on Windows** to the centralized **Team Management VPS**.

---

## Architecture Overview

```text
       eSSL Biometric Device (e.g., SilkBio / K30 / TD)
                           ↓
        eTimeTrackLite Desktop 12.2 (Local Windows PC)
                           ↓
        Microsoft SQL Server Express (.\SQLEXPRESS)
                           ↓
              etimetracklitenew.dbo.GREYTIP
                           ↓
          eSSL Windows Attendance Sync Agent
         (Deterministic Cursor & Local Persistence)
                           ↓  (Outbound HTTPS only)
       Team Management REST API (VPS: /api/integrations/essl/attendance)
                           ↓
             BiometricAttendanceEvent (MongoDB)
```

### Key Security & Operational Highlights
* **Zero Inbound Ports Required**: The local agent initiates all outbound HTTPS connections. Port 1433, VPNs, and router port-forwarding are **never** exposed.
* **Deterministic Cursor Pagination**: Safely navigates `dbo.GREYTIP` even when punches occur on the exact same millisecond or second, using `(LogDateTime, EmpCode, Direction, DeviceName)`.
* **At-Least-Once Delivery & Idempotency**: The state cursor is **only** advanced after the VPS confirms successful ingestion. The VPS enforces unique compound indexing on `externalKey`, rejecting duplicate punch insertions cleanly.
* **Continuous Backlog Draining**: Drains large backlogs (e.g. 50,000 historical records) immediately in back-to-back batches without pausing, before entering standard 30-second polling mode.
* **Windows Background Service**: Runs silently in the background with automatic startup on boot and auto-restart on crashes.
* **Local Web Dashboard**: Built-in, zero-dependency management UI hosted strictly on `http://127.0.0.1:8765`.

---

## Directory Structure

```text
essl-attendance-agent/
│
├── src/
│   ├── index.ts              # CLI entry point & daemon runner
│   ├── config.ts             # Strongly-typed environment configuration
│   ├── database/
│   │   ├── sqlserver.ts      # MSSQL pool manager, reconnection, graceful shutdown
│   │   └── queries.ts        # Parameterized deterministic cursor SQL queries
│   ├── sync/
│   │   ├── sync-engine.ts    # Main orchestration loop, backlog draining, dry run
│   │   ├── state-manager.ts  # SQLite + atomic JSON state persistence
│   │   └── batch-sender.ts   # Formatting, normalization & payload dispatch
│   ├── api/
│   │   └── api-client.ts     # HTTPS client with exponential backoff retry
│   ├── logging/
│   │   └── logger.ts         # Structured daily log rotation & credential redaction
│   ├── health/
│   │   └── health.ts         # Loopback HTTP server (127.0.0.1:8765)
│   └── ui/
│       └── dashboard.ts      # Embedded HTML5 diagnostic dashboard
│
├── data/
│   ├── sync-state.db         # ACID SQLite state database
│   └── sync-state.json       # Human-readable atomic JSON mirror
│
├── logs/                     # Daily rotating logs (e.g. agent-2026-09-25.log)
├── scripts/
│   ├── install-service.ps1   # PowerShell service installer
│   ├── install-service.bat   # 1-Click Administrator installer
│   ├── uninstall-service.ps1 # Service removal script
│   ├── uninstall-service.bat # 1-Click Administrator uninstaller
│   └── winsw.xml             # WinSW service configuration template
│
├── tests/                    # Automated unit & integration tests
├── .env.example              # Environment variables template
├── package.json
├── tsconfig.json
└── README.md
```

---

## Prerequisites

1. **Windows 10 / 11 / Server 2016+**
2. **Node.js LTS (v20+ or v22+)** installed and available in PATH.
3. **Microsoft SQL Server Express** with SQL Server Authentication enabled (or Windows Authentication).
4. Access to database `etimetracklitenew` and table `dbo.GREYTIP`.

---

## Configuration (`.env`)

Copy `.env.example` to `.env` in the `essl-attendance-agent` folder:

```env
# SQL Server Configuration
SQL_SERVER=DESKTOPNAME\\SQLEXPRESS
SQL_DATABASE=etimetracklitenew
SQL_USER=sa
SQL_PASSWORD=YourStrongSqlPassword
SQL_ENCRYPT=false
SQL_TRUST_SERVER_CERTIFICATE=true
SQL_CONNECTION_TIMEOUT=15000
SQL_REQUEST_TIMEOUT=30000

# VPS Team Management API Endpoint
API_URL=https://team-api.digitalfyx.com/api/integrations/essl/attendance
API_KEY=YOUR_SECURE_LONG_RANDOM_SECRET_KEY
DEVICE_ID=office-essl

# Synchronization Parameters
SYNC_INTERVAL=30000
BATCH_SIZE=1000
TIMEZONE=Asia/Kolkata

# Local Diagnostic & Management Web UI (127.0.0.1 only)
HEALTH_PORT=8765
HEALTH_HOST=127.0.0.1

# Logging
LOG_LEVEL=info
LOG_DIR=./logs
LOG_MAX_FILES=14
```

---

## Installation & Running

### Option A: 1-Click Windows Service Setup (Recommended for Production)

1. Open PowerShell or Command Prompt as **Administrator**.
2. Run:
   ```cmd
   scripts\install-service.bat
   ```
   Or in PowerShell:
   ```powershell
   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
   .\scripts\install-service.ps1
   ```
3. The installer will:
   * Install Node.js dependencies (`npm install`)
   * Compile TypeScript (`npm run build`)
   * Create `data/` and `logs/` directories
   * Register the Windows Service named **`ESSL Attendance Sync`**
   * Configure service recovery (auto-restart on crash after 10s, 30s, 60s)
   * Configure startup mode as **Automatic**
   * Start the background service immediately

### Option B: Running from Command Line

To test or run manually without installing the Windows Service:
```bash
# Build TypeScript
npm run build

# Start background sync daemon
npm start
```

---

## CLI Diagnostic & Maintenance Commands

The agent includes full CLI capabilities:

### 1. Check System Status
```bash
node dist/index.js status
```
Output:
```text
==========================================
       eSSL Attendance Agent Status       
==========================================
Service:             Initialized
SQL Server:          Connected
Database:            etimetracklitenew
Table:               dbo.GREYTIP
VPS:                 Connected
Last successful sync: 2026-09-25 14:30:00
Records synchronized: 15,234
Current batch:       0
Pending:             No
==========================================
```

### 2. Test Connections
```bash
# Test SQL Server connectivity & count rows in dbo.GREYTIP
node dist/index.js test-sql

# Test VPS API health endpoint
node dist/index.js test-vps
```

### 3. Dry Run (Preview without sending or updating state)
```bash
node dist/index.js sync --dry-run
```
Outputs count of pending records and previews the first 10 rows without modifying the local cursor or sending data.

### 4. Full Historical Re-Synchronization
```bash
node dist/index.js sync --full
```
Safely resets the persistent cursor and ingests historical records from the beginning.

### 5. Single Incremental Sync Run
```bash
node dist/index.js sync
```

---

## Local Diagnostic Web Dashboard

When the agent is running, open a browser on the local Windows PC:
```text
http://127.0.0.1:8765
```

The embedded dashboard displays:
* Real-time SQL Server and VPS connection health
* Total synchronized records and pending backlog count
* Action buttons: **Run Sync Now**, **Test SQL Connection**, **Test VPS Connection**
* Live log viewer with instant reload

---

## Service Uninstallation

To remove the Windows service:
```cmd
scripts\uninstall-service.bat
```
Or in PowerShell:
```powershell
.\scripts\uninstall-service.ps1
```

---

## Automated Tests

Run the test suite:
```bash
npm test
```
The test suite exercises:
* SQLite & atomic JSON state persistence and restart recovery
* MSSQL deterministic cursor query generation
* Payload normalization and timezone handling
* Exponential backoff retry on transient HTTP 500 / network failures
* Strict rejection without retries on HTTP 401 / 422
* Backlog draining across multi-batch sequences
* Cursor non-advancement guarantees during failure scenarios
