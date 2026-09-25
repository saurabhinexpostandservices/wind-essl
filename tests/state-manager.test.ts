import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { StateManager } from "../src/sync/state-manager.js";
import { Logger } from "../src/logging/logger.js";

describe("StateManager", () => {
    const testDir = path.resolve("./tests/temp-data");
    const testLogs = path.resolve("./tests/temp-logs");
    let logger: Logger;

    beforeEach(() => {
        if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
        if (fs.existsSync(testLogs)) fs.rmSync(testLogs, { recursive: true, force: true });
        logger = new Logger(testLogs, "debug");
    });

    afterEach(() => {
        logger.close();
        if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
        if (fs.existsSync(testLogs)) fs.rmSync(testLogs, { recursive: true, force: true });
    });

    test("Initial state returns defaults", () => {
        const sm = new StateManager(testDir, logger);
        const state = sm.getState();

        assert.strictEqual(state.initialized, false);
        assert.strictEqual(state.lastLogDateTime, null);
        assert.strictEqual(state.totalSent, 0);
        sm.close();
    });

    test("updateCursor advances cursor and persists to disk", () => {
        const sm = new StateManager(testDir, logger);
        const logDate = "2026-09-25T08:45:21.000Z";

        sm.updateCursor(
            {
                logDateTime: logDate,
                empCode: "ESS104",
                direction: "out",
                deviceName: "TD",
            },
            100
        );

        const state1 = sm.getState();
        assert.strictEqual(state1.initialized, true);
        assert.strictEqual(state1.lastLogDateTime, logDate);
        assert.strictEqual(state1.lastEmpCode, "ESS104");
        assert.strictEqual(state1.totalSent, 100);
        sm.close();

        // Simulate agent restart recovery: re-instantiate StateManager from same directory
        const sm2 = new StateManager(testDir, logger);
        const state2 = sm2.getState();

        assert.strictEqual(state2.initialized, true);
        assert.strictEqual(state2.lastLogDateTime, logDate);
        assert.strictEqual(state2.lastEmpCode, "ESS104");
        assert.strictEqual(state2.totalSent, 100);
        sm2.close();
    });

    test("resetCursor resets state for full synchronization", () => {
        const sm = new StateManager(testDir, logger);

        sm.updateCursor(
            {
                logDateTime: "2026-09-25T08:45:21.000Z",
                empCode: "ESS104",
                direction: "out",
                deviceName: "TD",
            },
            500
        );

        assert.strictEqual(sm.getState().totalSent, 500);

        sm.resetCursor();
        const resetState = sm.getState();

        assert.strictEqual(resetState.initialized, false);
        assert.strictEqual(resetState.lastLogDateTime, null);
        assert.strictEqual(resetState.totalSent, 0);
        sm.close();
    });
});
