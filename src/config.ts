import path from "node:path";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

export interface AgentConfig {
    sql: {
        server: string;
        database: string;
        user?: string;
        password?: string;
        encrypt: boolean;
        trustServerCertificate: boolean;
        connectionTimeout: number;
        requestTimeout: number;
        pool: {
            max: number;
            min: number;
            idleTimeoutMillis: number;
        };
    };
    api: {
        url: string;
        apiKey: string;
        deviceId: string;
        timeoutMs: number;
        maxRetries: number;
        initialRetryDelayMs: number;
        maxRetryDelayMs: number;
    };
    sync: {
        intervalMs: number;
        batchSize: number;
        timezone: string;
        dataPath: string;
        stateFile: string;
        dbFile: string;
    };
    health: {
        host: string;
        port: number;
        enabled: boolean;
    };
    logging: {
        level: "debug" | "info" | "warn" | "error";
        dir: string;
        maxFiles: number;
    };
}

export function loadConfig(): AgentConfig {
    const isProd = process.env.NODE_ENV === "production";
    const apiUrl = process.env.API_URL || "http://127.0.0.1:8000/api/integrations/essl/attendance";

    // Enforce HTTPS in production
    if (isProd && !apiUrl.startsWith("https://")) {
        throw new Error(
            `Security violation: Non-HTTPS API URL is prohibited in production: ${apiUrl}`
        );
    }

    const dataDir = path.resolve(process.env.DATA_DIR || "./data");
    const logsDir = path.resolve(process.env.LOG_DIR || "./logs");

    return {
        sql: {
            server: process.env.SQL_SERVER || "localhost\\SQLEXPRESS",
            database: process.env.SQL_DATABASE || "etimetracklitenew",
            user: process.env.SQL_USER || "sa",
            password: process.env.SQL_PASSWORD || "",
            encrypt: process.env.SQL_ENCRYPT === "true",
            trustServerCertificate: process.env.SQL_TRUST_SERVER_CERTIFICATE !== "false",
            connectionTimeout: parseInt(process.env.SQL_CONNECTION_TIMEOUT || "15000", 10),
            requestTimeout: parseInt(process.env.SQL_REQUEST_TIMEOUT || "30000", 10),
            pool: {
                max: 10,
                min: 1,
                idleTimeoutMillis: 30000,
            },
        },
        api: {
            url: apiUrl,
            apiKey: process.env.API_KEY || "",
            deviceId: process.env.DEVICE_ID || "office-essl",
            timeoutMs: parseInt(process.env.API_TIMEOUT_MS || "20000", 10),
            maxRetries: parseInt(process.env.API_MAX_RETRIES || "5", 10),
            initialRetryDelayMs: parseInt(process.env.API_RETRY_DELAY_MS || "5000", 10),
            maxRetryDelayMs: parseInt(process.env.API_MAX_RETRY_DELAY_MS || "120000", 10),
        },
        sync: {
            intervalMs: parseInt(process.env.SYNC_INTERVAL || "30000", 10),
            batchSize: parseInt(process.env.BATCH_SIZE || "1000", 10),
            timezone: process.env.TIMEZONE || "Asia/Kolkata",
            dataPath: dataDir,
            stateFile: path.join(dataDir, "sync-state.json"),
            dbFile: path.join(dataDir, "sync-state.db"),
        },
        health: {
            host: process.env.HEALTH_HOST || "127.0.0.1",
            port: parseInt(process.env.HEALTH_PORT || "8765", 10),
            enabled: process.env.HEALTH_ENABLED !== "false",
        },
        logging: {
            level: (process.env.LOG_LEVEL as "debug" | "info" | "warn" | "error") || "info",
            dir: logsDir,
            maxFiles: parseInt(process.env.LOG_MAX_FILES || "14", 10),
        },
    };
}
