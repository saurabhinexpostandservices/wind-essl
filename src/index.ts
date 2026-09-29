#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { getLogger } from "./logging/logger.js";
import { SqlServerDatabase } from "./database/sqlserver.js";
import { StateManager } from "./sync/state-manager.js";
import { ApiClient } from "./api/api-client.js";
import { BatchSender } from "./sync/batch-sender.js";
import { SyncEngine } from "./sync/sync-engine.js";
import { HealthServer } from "./health/health.js";

async function main() {
    const args = process.argv.slice(2);
    const command = args[0] || "start";

    const config = loadConfig();
    const logger = getLogger(config.logging);

    const db = new SqlServerDatabase(config.sql, logger);
    const stateManager = new StateManager(config.sync.dataPath, logger);
    const apiClient = new ApiClient(config.api, logger);
    const batchSender = new BatchSender(apiClient, config.api.deviceId, logger);
    const syncEngine = new SyncEngine(config, db, stateManager, batchSender, logger, apiClient);
    const healthServer = new HealthServer(config, db, stateManager, syncEngine, apiClient, logger);

    const gracefulShutdown = async (signal: string) => {
        logger.info(`Received ${signal}. Performing graceful shutdown...`);
        syncEngine.stop();
        healthServer.stop();
        await db.disconnect();
        stateManager.close();
        logger.info("Application shutdown complete.");
        process.exit(0);
    };

    process.on("SIGINT", () => gracefulShutdown("SIGINT"));
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("uncaughtException", (err) => {
        logger.error("Uncaught exception in agent process", err);
    });
    process.on("unhandledRejection", (reason) => {
        logger.error("Unhandled promise rejection in agent process", reason);
    });

    try {
        switch (command) {
            case "status": {
                // Section 29: Diagnostic status command
                const isSqlConnected = await db.testConnection();
                const vpsHealth = await apiClient.checkHealth();
                const state = stateManager.getState();
                let pendingCount = 0;

                if (isSqlConnected.ok) {
                    const cursor = state.initialized && state.lastLogDateTime ? {
                        lastLogDateTime: state.lastLogDateTime,
                        lastEmpCode: state.lastEmpCode!,
                        lastDirection: state.lastDirection!,
                        lastDeviceName: state.lastDeviceName!,
                    } : null;
                    const allowed = await syncEngine.getAllowedEmployees();
                    pendingCount = await db.getPendingCount(cursor, allowed, config.sync.startDate || undefined);
                }

                console.log("\n==========================================");
                console.log("       eSSL Attendance Agent Status       ");
                console.log("==========================================");
                console.log(`Service:             ${state.initialized ? "Initialized" : "Pending First Run"}`);
                console.log(`SQL Server:          ${isSqlConnected.ok ? "Connected" : `Disconnected (${isSqlConnected.message})`}`);
                console.log(`Database:            ${config.sql.database}`);
                console.log(`Table:               dbo.GREYTIP`);
                console.log(`VPS:                 ${vpsHealth.ok ? "Connected" : `Disconnected (${vpsHealth.message})`}`);
                console.log(`Last successful sync:${state.lastSuccessfulSync ? new Date(state.lastSuccessfulSync).toLocaleString() : "Never"}`);
                console.log(`Records synchronized:${state.totalSent.toLocaleString()}`);
                console.log(`Current batch:       0`);
                console.log(`Pending:             ${pendingCount > 0 ? `Yes (${pendingCount.toLocaleString()} records)` : "No"}`);
                console.log("==========================================\n");

                await db.disconnect();
                stateManager.close();
                process.exit(0);
                break;
            }

            case "sync": {
                const isDryRun = args.includes("--dry-run");
                const isFullSync = args.includes("--full");

                if (isDryRun) {
                    // Section 28: Dry Run
                    await syncEngine.runDryRun();
                } else {
                    if (isFullSync) {
                        // Section 27: Full synchronization
                        logger.warn("Initiating FULL synchronization...");
                        syncEngine.resetForFullSync();
                    }
                    logger.info("Executing manual synchronization cycle...");
                    const result = await syncEngine.runSyncCycle();
                    logger.info(
                        `Sync finished. Processed ${result.recordsProcessed} records across ${result.batchesProcessed} batches.`
                    );
                }

                await db.disconnect();
                stateManager.close();
                process.exit(0);
                break;
            }

            case "test-sql": {
                logger.info("Testing SQL Server connection...");
                const res = await db.testConnection();
                if (res.ok) {
                    logger.info(`SQL Server Connection: SUCCESS (${res.message})`);
                    const count = await db.getTotalCount();
                    logger.info(`Total records currently in dbo.GREYTIP: ${count}`);
                } else {
                    logger.error(`SQL Server Connection: FAILED - ${res.message}`);
                }
                await db.disconnect();
                process.exit(res.ok ? 0 : 1);
                break;
            }

            case "test-vps": {
                logger.info("Testing VPS API connection...");
                const res = await apiClient.checkHealth();
                if (res.ok) {
                    logger.info(`VPS API Connection: SUCCESS (Status: ${res.status})`);
                } else {
                    logger.error(`VPS API Connection: FAILED - ${res.message}`);
                }
                process.exit(res.ok ? 0 : 1);
                break;
            }

            case "start":
            default: {
                logger.info("Starting eSSL Attendance Sync Agent Service...");

                // Initial connection verification
                try {
                    await db.connect();
                } catch (err) {
                    logger.warn("Initial SQL Server connection failed. Will retry automatically during sync cycles.", err);
                }

                // Start local management & health server
                if (config.health.enabled) {
                    healthServer.start();
                }

                // Start continuous background polling
                syncEngine.start();
                break;
            }
        }
    } catch (err: any) {
        logger.error("Fatal initialization error", err);
        process.exit(1);
    }
}

main();
