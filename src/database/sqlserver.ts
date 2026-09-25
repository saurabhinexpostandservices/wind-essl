import { createRequire } from "node:module";
import sql from "mssql";
import { AgentConfig } from "../config.js";
import { Logger } from "../logging/logger.js";
import { SQL_QUERIES, RawAttendanceRow, AttendanceCursor } from "./queries.js";

const require = createRequire(import.meta.url);

export class SqlServerDatabase {
    private pool: sql.ConnectionPool | null = null;
    private config: AgentConfig["sql"];
    private logger: Logger;
    private isConnecting = false;
    private isMock = false;
    private mockDb: any = null;

    constructor(config: AgentConfig["sql"], logger: Logger) {
        this.config = config;
        this.logger = logger;
        this.isMock =
            this.config.server.toUpperCase() === "MOCK" ||
            process.env.SQL_MOCK === "true";
    }

    private initMockDb() {
        if (!this.mockDb) {
            const { DatabaseSync } = require("node:sqlite");
            // In-memory or file-based mock database for local environment testing
            const mockDbPath = process.env.MOCK_DB_PATH || ":memory:";
            this.mockDb = new DatabaseSync(mockDbPath);
            this.mockDb.exec(`
                CREATE TABLE IF NOT EXISTS dbo_GREYTIP (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    EmpCode TEXT NOT NULL,
                    LogDateTime TEXT NOT NULL,
                    Direction TEXT NOT NULL,
                    DeviceName TEXT NOT NULL
                );
            `);

            // Seed default eTimeTrackLite records if empty
            const count = this.mockDb.prepare("SELECT COUNT(*) AS c FROM dbo_GREYTIP").get().c;
            if (count === 0) {
                const insert = this.mockDb.prepare(`
                    INSERT INTO dbo_GREYTIP (EmpCode, LogDateTime, Direction, DeviceName)
                    VALUES (?, ?, ?, ?)
                `);
                insert.run("ESS104", new Date("2025-06-09 13:33:55").toISOString(), "out", "TD");
                insert.run("ESS104", new Date("2025-06-09 13:34:08").toISOString(), "out", "TD");
                insert.run("ESS118", new Date("2025-06-09 13:35:52").toISOString(), "out", "TD");
                insert.run("ESS043", new Date("2025-06-09 13:41:36").toISOString(), "out", "TD");
                insert.run("ESS030", new Date("2025-06-09 13:43:16").toISOString(), "out", "TD");
            }
        }
    }

    public addMockRecord(empCode: string, logDateTime: string, direction: string, deviceName: string) {
        if (!this.isMock) return;
        this.initMockDb();
        const stmt = this.mockDb.prepare(`
            INSERT INTO dbo_GREYTIP (EmpCode, LogDateTime, Direction, DeviceName)
            VALUES (?, ?, ?, ?)
        `);
        stmt.run(empCode, new Date(logDateTime).toISOString(), direction, deviceName);
    }

    private buildMssqlConfig(): sql.config {
        let server = this.config.server;
        let instanceName: string | undefined = undefined;

        if (server.includes("\\")) {
            const parts = server.split("\\");
            server = parts[0] === "." ? "localhost" : parts[0];
            instanceName = parts[1];
        }

        return {
            server,
            database: this.config.database,
            user: this.config.user,
            password: this.config.password,
            connectionTimeout: this.config.connectionTimeout,
            requestTimeout: this.config.requestTimeout,
            pool: this.config.pool,
            options: {
                encrypt: this.config.encrypt,
                trustServerCertificate: this.config.trustServerCertificate,
                instanceName,
                useUTC: false, // Maintain local wall-clock time from SQL Server
            },
        };
    }

    public async connect(): Promise<sql.ConnectionPool | any> {
        if (this.isMock) {
            this.initMockDb();
            this.logger.info("Connected to Simulated eTimeTrackLite SQL Server (Mock Mode for Local Testing)");
            return this.mockDb;
        }

        if (this.pool && this.pool.connected) {
            return this.pool;
        }

        if (this.isConnecting) {
            while (this.isConnecting) {
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
            if (this.pool && this.pool.connected) {
                return this.pool;
            }
        }

        this.isConnecting = true;
        try {
            this.logger.info(`Connecting to SQL Server: ${this.config.server} (Database: ${this.config.database})`);
            const mssqlConfig = this.buildMssqlConfig();
            this.pool = await new sql.ConnectionPool(mssqlConfig).connect();

            this.pool.on("error", (err) => {
                this.logger.error("SQL Server pool encountered an unexpected error", err);
            });

            this.logger.info("SQL Server connected successfully");
            return this.pool;
        } catch (err) {
            this.logger.error("SQL Server connection failure", err);
            throw err;
        } finally {
            this.isConnecting = false;
        }
    }

    public async isConnected(): Promise<boolean> {
        if (this.isMock) return true;
        return !!(this.pool && this.pool.connected);
    }

    public async testConnection(): Promise<{ ok: boolean; message: string }> {
        if (this.isMock) {
            this.initMockDb();
            return { ok: true, message: "Connected to Simulated dbo.GREYTIP (Mock Mode)" };
        }
        try {
            const pool = await this.connect();
            const request = pool.request();
            await request.query(SQL_QUERIES.TEST_CONNECTION);
            return { ok: true, message: "Connected and verified dbo.GREYTIP access" };
        } catch (err: any) {
            return { ok: false, message: err?.message || String(err) };
        }
    }

    public async getTotalCount(): Promise<number> {
        if (this.isMock) {
            this.initMockDb();
            const row = this.mockDb.prepare("SELECT COUNT(*) AS total FROM dbo_GREYTIP").get();
            return row?.total || 0;
        }

        const pool = await this.connect();
        const request = pool.request();
        const result = await request.query(SQL_QUERIES.GET_TOTAL_COUNT);
        return result.recordset[0]?.total || 0;
    }

    public async getPendingCount(cursor: AttendanceCursor | null): Promise<number> {
        if (this.isMock) {
            this.initMockDb();
            if (!cursor || !cursor.lastLogDateTime) {
                return this.getTotalCount();
            }
            const dateStr =
                cursor.lastLogDateTime instanceof Date
                    ? cursor.lastLogDateTime.toISOString()
                    : new Date(cursor.lastLogDateTime).toISOString();

            const stmt = this.mockDb.prepare(`
                SELECT COUNT(*) AS pending
                FROM dbo_GREYTIP
                WHERE (
                    LogDateTime > ?
                    OR (LogDateTime = ? AND EmpCode > ?)
                    OR (LogDateTime = ? AND EmpCode = ? AND Direction > ?)
                    OR (LogDateTime = ? AND EmpCode = ? AND Direction = ? AND DeviceName > ?)
                )
            `);
            const row = stmt.get(
                dateStr,
                dateStr, cursor.lastEmpCode,
                dateStr, cursor.lastEmpCode, cursor.lastDirection,
                dateStr, cursor.lastEmpCode, cursor.lastDirection, cursor.lastDeviceName
            );
            return row?.pending || 0;
        }

        const pool = await this.connect();
        const request = pool.request();

        if (!cursor || !cursor.lastLogDateTime) {
            return await this.getTotalCount();
        }

        const dateVal =
            cursor.lastLogDateTime instanceof Date
                ? cursor.lastLogDateTime
                : new Date(cursor.lastLogDateTime);

        request.input("lastLogDateTime", sql.DateTime, dateVal);
        request.input("lastEmpCode", sql.NVarChar, cursor.lastEmpCode);
        request.input("lastDirection", sql.NVarChar, cursor.lastDirection);
        request.input("lastDeviceName", sql.NVarChar, cursor.lastDeviceName);

        const result = await request.query(SQL_QUERIES.COUNT_PENDING_AFTER_CURSOR);
        return result.recordset[0]?.pending || 0;
    }

    public async fetchBatch(
        batchSize: number,
        cursor: AttendanceCursor | null
    ): Promise<RawAttendanceRow[]> {
        if (this.isMock) {
            this.initMockDb();
            if (!cursor || !cursor.lastLogDateTime) {
                const stmt = this.mockDb.prepare(`
                    SELECT EmpCode, LogDateTime, Direction, DeviceName
                    FROM dbo_GREYTIP
                    ORDER BY LogDateTime ASC, EmpCode ASC, Direction ASC, DeviceName ASC
                    LIMIT ?
                `);
                return stmt.all(batchSize);
            }

            const dateStr =
                cursor.lastLogDateTime instanceof Date
                    ? cursor.lastLogDateTime.toISOString()
                    : new Date(cursor.lastLogDateTime).toISOString();

            const stmt = this.mockDb.prepare(`
                SELECT EmpCode, LogDateTime, Direction, DeviceName
                FROM dbo_GREYTIP
                WHERE (
                    LogDateTime > ?
                    OR (LogDateTime = ? AND EmpCode > ?)
                    OR (LogDateTime = ? AND EmpCode = ? AND Direction > ?)
                    OR (LogDateTime = ? AND EmpCode = ? AND Direction = ? AND DeviceName > ?)
                )
                ORDER BY LogDateTime ASC, EmpCode ASC, Direction ASC, DeviceName ASC
                LIMIT ?
            `);
            return stmt.all(
                dateStr,
                dateStr, cursor.lastEmpCode,
                dateStr, cursor.lastEmpCode, cursor.lastDirection,
                dateStr, cursor.lastEmpCode, cursor.lastDirection, cursor.lastDeviceName,
                batchSize
            );
        }

        const pool = await this.connect();
        const request = pool.request();
        request.input("batchSize", sql.Int, batchSize);

        if (!cursor || !cursor.lastLogDateTime) {
            const result = await request.query(SQL_QUERIES.FETCH_INITIAL_BATCH);
            return result.recordset || [];
        }

        const dateVal =
            cursor.lastLogDateTime instanceof Date
                ? cursor.lastLogDateTime
                : new Date(cursor.lastLogDateTime);

        request.input("lastLogDateTime", sql.DateTime, dateVal);
        request.input("lastEmpCode", sql.NVarChar, cursor.lastEmpCode);
        request.input("lastDirection", sql.NVarChar, cursor.lastDirection);
        request.input("lastDeviceName", sql.NVarChar, cursor.lastDeviceName);

        const result = await request.query(SQL_QUERIES.FETCH_INCREMENTAL_BATCH);
        return result.recordset || [];
    }

    public async disconnect(): Promise<void> {
        if (this.isMock) {
            if (this.mockDb) {
                try {
                    this.mockDb.close();
                } catch {}
                this.mockDb = null;
            }
            return;
        }

        if (this.pool) {
            try {
                await this.pool.close();
                this.logger.info("SQL Server connection pool closed");
            } catch (err) {
                this.logger.error("Error closing SQL Server pool", err);
            }
            this.pool = null;
        }
    }
}
