import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { SyncEngine } from "../src/sync/sync-engine.js";
import { StateManager } from "../src/sync/state-manager.js";
import { BatchSender } from "../src/sync/batch-sender.js";
import { SqlServerDatabase } from "../src/database/sqlserver.js";
import { Logger } from "../src/logging/logger.js";
import { AgentConfig } from "../src/config.js";

describe("SyncEngine", () => {
    const testDir = path.resolve("./tests/temp-data-sync");
    const testLogs = path.resolve("./tests/temp-logs-sync");
    let logger: Logger;
    let stateManager: StateManager;

    const mockConfig: AgentConfig = {
        sql: {
            server: "localhost\\SQLEXPRESS",
            database: "etimetracklitenew",
            encrypt: false,
            trustServerCertificate: true,
            connectionTimeout: 1000,
            requestTimeout: 1000,
            pool: { max: 1, min: 1, idleTimeoutMillis: 1000 },
        },
        api: {
            url: "https://example.com/api/integrations/essl/attendance",
            apiKey: "key",
            deviceId: "office-essl",
            timeoutMs: 1000,
            maxRetries: 1,
            initialRetryDelayMs: 10,
            maxRetryDelayMs: 10,
        },
        sync: {
            intervalMs: 10000,
            batchSize: 2, // Small batch size to test pagination / backlog draining
            timezone: "Asia/Kolkata",
            dataPath: testDir,
            stateFile: path.join(testDir, "sync-state.json"),
            dbFile: path.join(testDir, "sync-state.db"),
        },
        health: { host: "127.0.0.1", port: 8765, enabled: false },
        logging: { level: "debug", dir: testLogs, maxFiles: 1 },
    };

    beforeEach(() => {
        if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
        if (fs.existsSync(testLogs)) fs.rmSync(testLogs, { recursive: true, force: true });
        logger = new Logger(testLogs, "debug");
        stateManager = new StateManager(testDir, logger);
    });

    afterEach(() => {
        stateManager.close();
        logger.close();
        if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
        if (fs.existsSync(testLogs)) fs.rmSync(testLogs, { recursive: true, force: true });
    });

    test("Dry run previews data without sending to VPS or modifying state", async () => {
        let sendCalled = false;
        const mockDb = {
            getTotalCount: async () => 5,
            getPendingCount: async () => 5,
            fetchBatch: async () => [
                { EmpCode: "ESS104", LogDateTime: "2025-06-09T13:33:55", Direction: "out", DeviceName: "TD" },
            ],
            isConnected: async () => true,
        } as unknown as SqlServerDatabase;

        const mockSender = {
            send: async () => {
                sendCalled = true;
                return { success: true, received: 1, inserted: 1, duplicates: 0, failed: 0 };
            },
        } as unknown as BatchSender;

        const engine = new SyncEngine(mockConfig, mockDb, stateManager, mockSender, logger);
        const result = await engine.runDryRun();

        assert.strictEqual(result.totalInDb, 5);
        assert.strictEqual(result.pendingCount, 5);
        assert.strictEqual(result.sampleBatchSize, 1);
        assert.strictEqual(sendCalled, false); // Crucial: dry run must never send!
        assert.strictEqual(stateManager.getState().initialized, false); // State must remain uninitialized
    });

    test("Sync cycle drains backlog across multiple batches and advances cursor", async () => {
        // Mock dataset of 5 records (with batchSize = 2, requires 3 batches: 2 + 2 + 1)
        const mockRows = [
            { EmpCode: "ESS101", LogDateTime: "2025-06-09T10:00:00", Direction: "in", DeviceName: "TD" },
            { EmpCode: "ESS102", LogDateTime: "2025-06-09T10:05:00", Direction: "in", DeviceName: "TD" },
            { EmpCode: "ESS103", LogDateTime: "2025-06-09T10:10:00", Direction: "in", DeviceName: "TD" },
            { EmpCode: "ESS104", LogDateTime: "2025-06-09T10:15:00", Direction: "out", DeviceName: "TD" },
            { EmpCode: "ESS105", LogDateTime: "2025-06-09T10:20:00", Direction: "out", DeviceName: "TD" },
        ];

        let cursorPosition = 0;
        const mockDb = {
            fetchBatch: async (batchSize: number) => {
                const slice = mockRows.slice(cursorPosition, cursorPosition + batchSize);
                cursorPosition += slice.length;
                return slice;
            },
            isConnected: async () => true,
        } as unknown as SqlServerDatabase;

        let sentBatchesCount = 0;
        const mockSender = {
            send: async (rows: any[]) => {
                sentBatchesCount++;
                return { success: true, received: rows.length, inserted: rows.length, duplicates: 0, failed: 0 };
            },
        } as unknown as BatchSender;

        const engine = new SyncEngine(mockConfig, mockDb, stateManager, mockSender, logger);
        const result = await engine.runSyncCycle();

        assert.strictEqual(result.batchesProcessed, 3);
        assert.strictEqual(result.recordsProcessed, 5);
        assert.strictEqual(sentBatchesCount, 3);

        const state = stateManager.getState();
        assert.strictEqual(state.initialized, true);
        assert.strictEqual(state.lastEmpCode, "ESS105");
        assert.strictEqual(state.totalSent, 5);
    });

    test("Sync cycle stops and does NOT advance cursor when VPS reports failure", async () => {
        const mockRows = [
            { EmpCode: "ESS101", LogDateTime: "2025-06-09T10:00:00", Direction: "in", DeviceName: "TD" },
        ];

        const mockDb = {
            fetchBatch: async () => mockRows,
            isConnected: async () => true,
        } as unknown as SqlServerDatabase;

        const mockSender = {
            send: async () => {
                return { success: false, received: 1, inserted: 0, duplicates: 0, failed: 1 };
            },
        } as unknown as BatchSender;

        const engine = new SyncEngine(mockConfig, mockDb, stateManager, mockSender, logger);
        const result = await engine.runSyncCycle();

        assert.strictEqual(result.recordsProcessed, 0);

        // Cursor must NOT have advanced!
        const state = stateManager.getState();
        assert.strictEqual(state.initialized, false);
        assert.strictEqual(state.lastLogDateTime, null);
        assert.strictEqual(state.totalSent, 0);
    });
});
