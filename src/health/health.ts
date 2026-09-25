import http from "node:http";
import { AgentConfig } from "../config.js";
import { SqlServerDatabase } from "../database/sqlserver.js";
import { StateManager } from "../sync/state-manager.js";
import { SyncEngine } from "../sync/sync-engine.js";
import { ApiClient } from "../api/api-client.js";
import { Logger } from "../logging/logger.js";
import { getDashboardHtml } from "../ui/dashboard.js";

export class HealthServer {
    private server: http.Server | null = null;
    private config: AgentConfig;
    private db: SqlServerDatabase;
    private stateManager: StateManager;
    private syncEngine: SyncEngine;
    private apiClient: ApiClient;
    private logger: Logger;

    constructor(
        config: AgentConfig,
        db: SqlServerDatabase,
        stateManager: StateManager,
        syncEngine: SyncEngine,
        apiClient: ApiClient,
        logger: Logger
    ) {
        this.config = config;
        this.db = db;
        this.stateManager = stateManager;
        this.syncEngine = syncEngine;
        this.apiClient = apiClient;
        this.logger = logger;
    }

    public start(): void {
        const { host, port } = this.config.health;

        this.server = http.createServer(async (req, res) => {
            const url = new URL(req.url || "/", `http://${req.headers.host || host}`);
            const pathname = url.pathname;
            const method = req.method;

            // Security: strictly reject non-loopback host headers
            const clientIp = req.socket.remoteAddress || "";
            if (!clientIp.includes("127.0.0.1") && !clientIp.includes("::1") && !clientIp.includes("localhost")) {
                res.writeHead(403, { "Content-Type": "text/plain" });
                res.end("Forbidden: Local loopback access only");
                return;
            }

            try {
                // Section 19: Windows Agent Health diagnostic endpoint
                if (method === "GET" && pathname === "/health") {
                    const isSqlConnected = await this.db.isConnected();
                    const state = this.stateManager.getState();
                    const status = await this.syncEngine.getStatus();

                    const healthData = {
                        status: isSqlConnected ? "ok" : "degraded",
                        sqlServer: isSqlConnected ? "connected" : "disconnected",
                        database: this.config.sql.database,
                        lastSync: state.lastSuccessfulSync,
                        pending: status.isSyncing,
                        recordsSent: state.totalSent,
                    };

                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify(healthData, null, 2));
                    return;
                }

                // Section 22: Local Web UI Dashboard
                if (method === "GET" && pathname === "/") {
                    res.writeHead(200, { "Content-Type": "text/html" });
                    res.end(getDashboardHtml());
                    return;
                }

                // API: Detailed status
                if (method === "GET" && pathname === "/api/status") {
                    const isSqlConnected = await this.db.isConnected();
                    const state = this.stateManager.getState();
                    const status = await this.syncEngine.getStatus();
                    const vpsHealth = await this.apiClient.checkHealth();

                    const fullStatus = {
                        status: "ok",
                        sqlServer: isSqlConnected ? "connected" : "disconnected",
                        database: this.config.sql.database,
                        vps: vpsHealth.ok ? "connected" : vpsHealth.message,
                        lastSync: state.lastSuccessfulSync,
                        pending: status.isSyncing,
                        pendingCount: status.pendingRecords,
                        recordsSent: state.totalSent,
                    };

                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify(fullStatus));
                    return;
                }

                // API: Logs endpoint
                if (method === "GET" && pathname === "/api/logs") {
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ logs: this.logger.getRecentLogs() }));
                    return;
                }

                // API: Trigger sync
                if (method === "POST" && pathname === "/api/sync/run") {
                    const result = await this.syncEngine.runSyncCycle();
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify(result));
                    return;
                }

                // API: Test SQL
                if (method === "POST" && pathname === "/api/test/sql") {
                    const result = await this.db.testConnection();
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify(result));
                    return;
                }

                // API: Test VPS
                if (method === "POST" && pathname === "/api/test/vps") {
                    const result = await this.apiClient.checkHealth();
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify(result));
                    return;
                }

                // 404
                res.writeHead(404, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Not Found" }));
            } catch (err: any) {
                this.logger.error("Error in health server handler", err);
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: err?.message || "Internal server error" }));
            }
        });

        this.server.listen(port, host, () => {
            this.logger.info(`Local Management UI & Health server running at http://${host}:${port}`);
        });

        this.server.on("error", (err) => {
            this.logger.error(`Health server error on port ${port}`, err);
        });
    }

    public stop(): void {
        if (this.server) {
            this.server.close();
            this.server = null;
        }
    }
}
