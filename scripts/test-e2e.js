#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

console.log("================================================================");
console.log("🚀 STARTING COMPLETE END-TO-END eSSL SYSTEM INTEGRATION TEST");
console.log("================================================================\n");

const VPS_PORT = 9988;
const AGENT_PORT = 8765;
const TEST_API_KEY = "test-secret-integration-key-xyz-1234567890";
const MOCK_DB_PATH = path.join(rootDir, "data", "test-mock-etimetracklite.db");

// In-memory VPS DB store for attendance events
const storedAttendanceEvents = new Map();
let vpsHealthy = true;

// 1. Create a simulated VPS server hosting the eSSL integration endpoints
const vpsServer = http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://127.0.0.1:${VPS_PORT}`);

    // GET /api/integrations/essl/health
    if (req.method === "GET" && url.pathname === "/api/integrations/essl/health") {
        if (!vpsHealthy) {
            res.writeHead(503, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "maintenance", message: "VPS unavailable" }));
            return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, service: "essl-attendance", status: "ok" }));
        return;
    }

    // POST /api/integrations/essl/attendance
    if (req.method === "POST" && url.pathname === "/api/integrations/essl/attendance") {
        if (!vpsHealthy) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ message: "Simulated Database Connection Failure" }));
            return;
        }

        const apiKey = req.headers["x-api-key"] || req.headers["authorization"]?.replace("Bearer ", "");
        if (apiKey !== TEST_API_KEY) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, message: "Invalid API key" }));
            return;
        }

        let bodyStr = "";
        req.on("data", (chunk) => { bodyStr += chunk; });
        req.on("end", () => {
            const payload = JSON.parse(bodyStr);
            const records = payload.records || [];
            let inserted = 0;
            let duplicates = 0;

            for (const r of records) {
                const key = `${r.empCode}_${r.logDateTime}_${r.direction}_${r.deviceName}`;
                if (storedAttendanceEvents.has(key)) {
                    duplicates++;
                } else {
                    storedAttendanceEvents.set(key, { ...r, ingestedAt: new Date().toISOString() });
                    inserted++;
                }
            }

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
                success: true,
                received: records.length,
                inserted,
                duplicates,
                failed: 0,
                details: { insertedCount: inserted, duplicateCount: duplicates, failedCount: 0 }
            }));
        });
        return;
    }

    res.writeHead(404);
    res.end();
});

await new Promise((resolve) => vpsServer.listen(VPS_PORT, "127.0.0.1", resolve));
console.log(`[1/8] ✅ VPS Integration API Server listening on http://127.0.0.1:${VPS_PORT}`);

// Configure environment variables for the Agent
process.env.SQL_SERVER = "MOCK";
process.env.MOCK_DB_PATH = MOCK_DB_PATH;
process.env.API_URL = `http://127.0.0.1:${VPS_PORT}/api/integrations/essl/attendance`;
process.env.API_KEY = TEST_API_KEY;
process.env.DATA_DIR = path.join(rootDir, "data");
process.env.LOG_DIR = path.join(rootDir, "logs");
process.env.BATCH_SIZE = "1000";
process.env.API_MAX_RETRIES = "1";
process.env.API_RETRY_DELAY_MS = "10";
process.env.HEALTH_PORT = String(AGENT_PORT);
process.env.HEALTH_HOST = "127.0.0.1";

// Clean any previous test data
if (fs.existsSync(MOCK_DB_PATH)) fs.unlinkSync(MOCK_DB_PATH);
const stateFile = path.join(rootDir, "data", "sync-state.json");
const stateDb = path.join(rootDir, "data", "sync-state.db");
if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
if (fs.existsSync(stateDb)) fs.unlinkSync(stateDb);

// Dynamically load the built agent modules
const { SqlServerDatabase } = await import("../dist/database/sqlserver.js");
const { StateManager } = await import("../dist/sync/state-manager.js");
const { ApiClient } = await import("../dist/api/api-client.js");
const { BatchSender } = await import("../dist/sync/batch-sender.js");
const { SyncEngine } = await import("../dist/sync/sync-engine.js");
const { HealthServer } = await import("../dist/health/health.js");
const { Logger } = await import("../dist/logging/logger.js");
const { loadConfig } = await import("../dist/config.js");

const config = loadConfig();
const logger = new Logger(config.logging.dir, "info");
const db = new SqlServerDatabase(config.sql, logger);
const stateManager = new StateManager(config.sync.dataPath, logger);
const apiClient = new ApiClient(config.api, logger);
const batchSender = new BatchSender(apiClient, config.api.deviceId, logger);
const syncEngine = new SyncEngine(config, db, stateManager, batchSender, logger);
const healthServer = new HealthServer(config, db, stateManager, syncEngine, apiClient, logger);

healthServer.start();
console.log(`[2/8] ✅ Local Windows Agent Management & Health Server listening on http://127.0.0.1:${AGENT_PORT}`);

// Verify connections
const sqlTest = await db.testConnection();
assert.strictEqual(sqlTest.ok, true, "SQL Server test failed");
const vpsTest = await apiClient.checkHealth();
assert.strictEqual(vpsTest.ok, true, "VPS Health check failed");
console.log("[3/8] ✅ Both SQL Server (Simulated dbo.GREYTIP) and VPS API connections verified OK");

// Step 4: Dry Run Verification
console.log("[4/8] 🧪 Testing Dry Run mode...");
const dryRunResult = await syncEngine.runDryRun();
assert.strictEqual(dryRunResult.totalInDb, 5, "Expected 5 initial records in dbo.GREYTIP");
assert.strictEqual(dryRunResult.pendingCount, 5, "Expected 5 pending records");
assert.strictEqual(storedAttendanceEvents.size, 0, "Dry run must NOT store events on VPS");
assert.strictEqual(stateManager.getState().initialized, false, "Dry run must NOT advance cursor");
console.log("       ✅ Dry run correctly previewed records without altering state or sending data");

// Step 5: Initial Full Synchronization
console.log("[5/8] 🧪 Testing Initial Synchronization backlog processing...");
const initialSync = await syncEngine.runSyncCycle();
assert.strictEqual(initialSync.recordsProcessed, 5, "Expected 5 records processed");
assert.strictEqual(storedAttendanceEvents.size, 5, "Expected 5 events stored on VPS");
assert.strictEqual(stateManager.getState().totalSent, 5, "State totalSent should be 5");
assert.strictEqual(stateManager.getState().initialized, true, "State must be initialized");
console.log("       ✅ 5 records synchronized from eTimeTrackLite to VPS successfully");

// Step 6: Idempotency & Duplicate Protection Verification
console.log("[6/8] 🧪 Testing Idempotency (Re-running sync without state advance)...");
// Force an identical sync request
const mockRows = await db.fetchBatch(5, null);
const duplicateResponse = await batchSender.send(mockRows);
assert.strictEqual(duplicateResponse.received, 5);
assert.strictEqual(duplicateResponse.inserted, 0, "Zero new rows should be inserted on duplicate send");
assert.strictEqual(duplicateResponse.duplicates, 5, "All 5 rows must be detected as duplicates");
assert.strictEqual(storedAttendanceEvents.size, 5, "VPS total events must still be exactly 5");
console.log("       ✅ Idempotency verified: re-sending batch created 0 duplicates (5 skipped)");

// Step 7: Incremental Real-time Sync of New Punch
console.log("[7/8] 🧪 Testing Incremental Sync when a new biometric punch arrives...");
db.addMockRecord("ESS104", "2026-09-25 18:10:25.000", "out", "TD");
const pendingBefore = await db.getPendingCount({
    lastLogDateTime: stateManager.getState().lastLogDateTime,
    lastEmpCode: stateManager.getState().lastEmpCode,
    lastDirection: stateManager.getState().lastDirection,
    lastDeviceName: stateManager.getState().lastDeviceName,
});
assert.strictEqual(pendingBefore, 1, "Expected 1 new pending record after punch");

const incSync = await syncEngine.runSyncCycle();
assert.strictEqual(incSync.recordsProcessed, 1, "Incremental sync should process exactly 1 new record");
assert.strictEqual(stateManager.getState().totalSent, 6, "Total sent should now be 6");
assert.strictEqual(stateManager.getState().lastEmpCode, "ESS104");
assert.strictEqual(storedAttendanceEvents.size, 6, "VPS total events should now be 6");
console.log("       ✅ Incremental punch detection and sync verified: exactly 1 new record ingested");

// Step 8: Network Failure & Zero Silent Loss Protection
console.log("[8/8] 🧪 Testing Network Outage: Cursor must NOT advance when VPS is down...");
db.addMockRecord("ESS118", "2026-09-25 18:15:00.000", "in", "MainDoor");
vpsHealthy = false; // Simulate VPS crash / network disconnection

const savedCursorBeforeFailure = { ...stateManager.getState() };
await syncEngine.runSyncCycle(); // Fails because VPS is down

const cursorAfterFailure = stateManager.getState();
assert.strictEqual(cursorAfterFailure.totalSent, savedCursorBeforeFailure.totalSent, "Cursor must NOT advance on failure!");
assert.strictEqual(cursorAfterFailure.lastLogDateTime, savedCursorBeforeFailure.lastLogDateTime);
console.log("       ✅ Cursor was safely preserved during VPS failure");

console.log("       🧪 Recovering VPS connectivity...");
vpsHealthy = true; // VPS back online
await syncEngine.runSyncCycle(); // Retries and succeeds!

assert.strictEqual(stateManager.getState().totalSent, 7, "Total sent should be 7 after recovery");
assert.strictEqual(storedAttendanceEvents.size, 7, "All records delivered without loss");
console.log("       ✅ Automatic recovery succeeded with ZERO data loss!");

// Test Local Health Endpoint & Web UI
console.log("\n🧪 Testing Local Diagnostic Health Endpoint & Web UI...");
const healthResp = await fetch(`http://127.0.0.1:${AGENT_PORT}/health`);
assert.strictEqual(healthResp.status, 200);
const healthJson = await healthResp.json();
assert.strictEqual(healthJson.status, "ok");
assert.strictEqual(healthJson.sqlServer, "connected");
assert.strictEqual(healthJson.recordsSent, 7);
console.log("  ✅ GET /health returns valid diagnostic JSON:", healthJson);

const uiResp = await fetch(`http://127.0.0.1:${AGENT_PORT}/`);
assert.strictEqual(uiResp.status, 200);
const uiHtml = await uiResp.text();
assert.ok(uiHtml.includes("eSSL Attendance Sync Manager"), "Dashboard HTML title missing");
console.log("  ✅ GET / renders local Web UI Dashboard successfully");

// Cleanup
healthServer.stop();
await db.disconnect();
stateManager.close();
await new Promise((resolve) => vpsServer.close(resolve));

// Clean temp test files
if (fs.existsSync(MOCK_DB_PATH)) fs.unlinkSync(MOCK_DB_PATH);
if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
if (fs.existsSync(stateDb)) fs.unlinkSync(stateDb);

console.log("\n================================================================");
console.log("🎉 ALL END-TO-END INTEGRATION TESTS PASSED 100% SUCCESSFULLY!");
console.log("================================================================\n");
process.exit(0);
