import { AgentConfig } from "../config.js";
import { Logger } from "../logging/logger.js";

export interface AttendancePayloadRecord {
    empCode: string;
    logDateTime: string;
    direction: string;
    deviceName: string;
}

export interface AttendanceBatchPayload {
    deviceId: string;
    records: AttendancePayloadRecord[];
}

export interface AttendanceBatchResponse {
    success: boolean;
    received: number;
    inserted: number;
    duplicates: number;
    failed: number;
    details?: {
        insertedCount?: number;
        duplicateCount?: number;
        failedCount?: number;
        errors?: Array<{
            index?: number;
            empCode?: string;
            error: string;
            message?: string;
        }>;
    };
}

export class ApiError extends Error {
    public statusCode?: number;
    public isRetryable: boolean;

    constructor(message: string, statusCode?: number, isRetryable: boolean = true) {
        super(message);
        this.name = "ApiError";
        this.statusCode = statusCode;
        this.isRetryable = isRetryable;
    }
}

export class ApiClient {
    private config: AgentConfig["api"];
    private logger: Logger;

    constructor(config: AgentConfig["api"], logger: Logger) {
        this.config = config;
        this.logger = logger;
    }

    /**
     * Check VPS health endpoint
     */
    public async checkHealth(): Promise<{ ok: boolean; status?: string; message?: string }> {
        try {
            // Determine base URL from configured endpoint
            const healthUrl = this.config.url.replace(/\/attendance\/?$/, "/health");
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);

            const res = await fetch(healthUrl, {
                method: "GET",
                signal: controller.signal,
                headers: {
                    Accept: "application/json",
                },
            });
            clearTimeout(timeout);

            if (res.ok) {
                const data: any = await res.json();
                return { ok: true, status: data.status || "ok" };
            }
            return { ok: false, message: `HTTP ${res.status}: ${res.statusText}` };
        } catch (err: any) {
            return { ok: false, message: err?.message || String(err) };
        }
    }

    /**
     * Send a batch of attendance records to VPS with exponential backoff retry for transient errors
     */
    public async sendBatch(payload: AttendanceBatchPayload): Promise<AttendanceBatchResponse> {
        let attempt = 0;
        let delayMs = this.config.initialRetryDelayMs;

        while (true) {
            attempt++;
            try {
                this.logger.debug(
                    `Sending batch of ${payload.records.length} records to VPS (Attempt ${attempt}/${this.config.maxRetries})`
                );

                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

                const response = await fetch(this.config.url, {
                    method: "POST",
                    signal: controller.signal,
                    headers: {
                        "Content-Type": "application/json",
                        Accept: "application/json",
                        "X-API-Key": this.config.apiKey,
                        Authorization: `Bearer ${this.config.apiKey}`,
                    },
                    body: JSON.stringify(payload),
                });

                clearTimeout(timeout);

                // Permanent non-retryable errors
                if ([400, 401, 403, 422].includes(response.status)) {
                    const errText = await response.text();
                    let parsed: any;
                    try {
                        parsed = JSON.parse(errText);
                    } catch {
                        parsed = { message: errText };
                    }

                    const errMsg = `VPS rejected request with HTTP ${response.status}: ${parsed.message || errText}`;
                    this.logger.error(errMsg);
                    throw new ApiError(errMsg, response.status, false);
                }

                // Transient server errors (500, 502, 503, 504, 408, 429)
                if (!response.ok) {
                    const errText = await response.text();
                    const errMsg = `VPS returned transient HTTP ${response.status}: ${errText}`;
                    this.logger.warn(errMsg);
                    throw new ApiError(errMsg, response.status, true);
                }

                const result = (await response.json()) as AttendanceBatchResponse;
                return result;
            } catch (err: any) {
                const isRetryable = err instanceof ApiError ? err.isRetryable : true;

                if (!isRetryable || attempt >= this.config.maxRetries) {
                    this.logger.error(`VPS communication failed definitively after ${attempt} attempts`, err);
                    throw err;
                }

                this.logger.warn(
                    `Transient VPS failure: ${err?.message || err}. Retrying in ${delayMs / 1000}s... (Attempt ${attempt}/${this.config.maxRetries})`
                );

                await new Promise((resolve) => setTimeout(resolve, delayMs));

                // Exponential backoff with jitter and cap
                delayMs = Math.min(delayMs * 2, this.config.maxRetryDelayMs);
            }
        }
    }
}
