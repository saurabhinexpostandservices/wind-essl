import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { ApiClient, ApiError } from "../src/api/api-client.js";
import { Logger } from "../src/logging/logger.js";

describe("ApiClient", () => {
    let originalFetch: typeof globalThis.fetch;
    const logger = new Logger("./tests/temp-logs", "debug");
    const testConfig = {
        url: "https://api.example.com/api/integrations/essl/attendance",
        apiKey: "test-secret-key",
        deviceId: "office-essl",
        timeoutMs: 2000,
        maxRetries: 3,
        initialRetryDelayMs: 20,
        maxRetryDelayMs: 50,
    };

    beforeEach(() => {
        originalFetch = globalThis.fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        logger.close();
    });

    test("checkHealth returns ok when server responds 200", async () => {
        globalThis.fetch = async () => {
            return new Response(JSON.stringify({ success: true, status: "ok" }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        };

        const client = new ApiClient(testConfig, logger);
        const res = await client.checkHealth();

        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.status, "ok");
    });

    test("sendBatch succeeds on 200 OK", async () => {
        globalThis.fetch = async () => {
            return new Response(
                JSON.stringify({
                    success: true,
                    received: 2,
                    inserted: 2,
                    duplicates: 0,
                    failed: 0,
                }),
                {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                }
            );
        };

        const client = new ApiClient(testConfig, logger);
        const res = await client.sendBatch({
            deviceId: "office-essl",
            records: [
                { empCode: "ESS104", logDateTime: "2025-06-09T13:33:55", direction: "out", deviceName: "TD" },
            ],
        });

        assert.strictEqual(res.success, true);
        assert.strictEqual(res.inserted, 2);
    });

    test("sendBatch throws non-retryable error on HTTP 401 Unauthorized", async () => {
        let callCount = 0;
        globalThis.fetch = async () => {
            callCount++;
            return new Response(JSON.stringify({ message: "Invalid API key" }), {
                status: 401,
                headers: { "Content-Type": "application/json" },
            });
        };

        const client = new ApiClient(testConfig, logger);
        let caught: any = null;

        try {
            await client.sendBatch({ deviceId: "test", records: [] });
        } catch (err) {
            caught = err;
        }

        assert.ok(caught instanceof ApiError);
        assert.strictEqual(caught.statusCode, 401);
        assert.strictEqual(caught.isRetryable, false);
        // Should NOT retry 401!
        assert.strictEqual(callCount, 1);
    });

    test("sendBatch retries on transient HTTP 500 and succeeds on second attempt", async () => {
        let callCount = 0;
        globalThis.fetch = async () => {
            callCount++;
            if (callCount === 1) {
                return new Response("Internal Server Error", { status: 500 });
            }
            return new Response(
                JSON.stringify({
                    success: true,
                    received: 1,
                    inserted: 1,
                    duplicates: 0,
                    failed: 0,
                }),
                { status: 200, headers: { "Content-Type": "application/json" } }
            );
        };

        const client = new ApiClient(testConfig, logger);
        const res = await client.sendBatch({ deviceId: "test", records: [] });

        assert.strictEqual(callCount, 2);
        assert.strictEqual(res.success, true);
        assert.strictEqual(res.inserted, 1);
    });
});
