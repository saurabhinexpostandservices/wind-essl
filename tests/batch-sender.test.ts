import { test, describe } from "node:test";
import assert from "node:assert";
import { BatchSender } from "../src/sync/batch-sender.js";
import { Logger } from "../src/logging/logger.js";
import { ApiClient } from "../src/api/api-client.js";

describe("BatchSender", () => {
    const logger = new Logger("./tests/temp-logs", "debug");
    const mockApiClient = {} as ApiClient;
    const sender = new BatchSender(mockApiClient, "office-essl", logger);

    test("transformRows maps SQL Server rows to clean API records", () => {
        const rows = [
            {
                EmpCode: "ESS104",
                LogDateTime: new Date("2025-06-09T13:33:55"),
                Direction: "out",
                DeviceName: "TD",
            },
            {
                EmpCode: " ESS118 ",
                LogDateTime: "2025-06-09 13:35:52.000",
                Direction: "IN",
                DeviceName: " MainDoor ",
            },
            {
                EmpCode: "ESS043",
                LogDateTime: "2025-06-09 13:41:36",
                Direction: "invalid-direction",
                DeviceName: "TD",
            },
        ];

        const records = sender.transformRows(rows);

        assert.strictEqual(records.length, 3);

        // Record 1
        assert.strictEqual(records[0].empCode, "ESS104");
        assert.strictEqual(records[0].direction, "out");
        assert.strictEqual(records[0].deviceName, "TD");

        // Record 2 trimmed and normalized
        assert.strictEqual(records[1].empCode, "ESS118");
        assert.strictEqual(records[1].direction, "in");
        assert.strictEqual(records[1].deviceName, "MainDoor");
        assert.strictEqual(records[1].logDateTime, "2025-06-09T13:35:52");

        // Record 3 invalid direction defaults to unknown
        assert.strictEqual(records[2].direction, "unknown");
    });
});
