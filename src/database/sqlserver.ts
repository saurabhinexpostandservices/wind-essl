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

    public async getPendingCount(
        cursor: AttendanceCursor | null,
        allowedEmpCodes?: string[],
        minStartDate?: Date | string
    ): Promise<number> {
        const allowed = allowedEmpCodes && allowedEmpCodes.length > 0
            ? allowedEmpCodes.map((c) => c.toUpperCase())
            : null;

        if (this.isMock) {
            this.initMockDb();
            let whereClause = "1=1";
            const params: any[] = [];

            if (cursor && cursor.lastLogDateTime) {
                const dateStr = cursor.lastLogDateTime instanceof Date
                    ? cursor.lastLogDateTime.toISOString()
                    : new Date(cursor.lastLogDateTime).toISOString();
                whereClause += ` AND (
                    LogDateTime > ?
                    OR (LogDateTime = ? AND EmpCode > ?)
                    OR (LogDateTime = ? AND EmpCode = ? AND Direction > ?)
                    OR (LogDateTime = ? AND EmpCode = ? AND Direction = ? AND DeviceName > ?)
                )`;
                params.push(
                    dateStr,
                    dateStr, cursor.lastEmpCode,
                    dateStr, cursor.lastEmpCode, cursor.lastDirection,
                    dateStr, cursor.lastEmpCode, cursor.lastDirection, cursor.lastDeviceName
                );
            } else if (minStartDate) {
                const minStr = minStartDate instanceof Date ? minStartDate.toISOString() : new Date(minStartDate).toISOString();
                whereClause += ` AND LogDateTime >= ?`;
                params.push(minStr);
            }

            if (allowed && allowed.length > 0) {
                const placeholders = allowed.map(() => "?").join(",");
                whereClause += ` AND EmpCode IN (${placeholders})`;
                params.push(...allowed);
            }

            const stmt = this.mockDb.prepare(`SELECT COUNT(*) AS pending FROM dbo_GREYTIP WHERE ${whereClause}`);
            const row = stmt.get(...params);
            return row?.pending || 0;
        }

        const pool = await this.connect();
        const request = pool.request();

        let whereClause = "1=1";

        if (cursor && cursor.lastLogDateTime) {
            const dateVal = cursor.lastLogDateTime instanceof Date
                ? cursor.lastLogDateTime
                : new Date(cursor.lastLogDateTime);
            request.input("lastLogDateTime", sql.DateTime, dateVal);
            request.input("lastEmpCode", sql.NVarChar, cursor.lastEmpCode);
            request.input("lastDirection", sql.NVarChar, cursor.lastDirection);
            request.input("lastDeviceName", sql.NVarChar, cursor.lastDeviceName);
            whereClause += ` AND (
                LogDateTime > @lastLogDateTime
                OR (LogDateTime = @lastLogDateTime AND EmpCode > @lastEmpCode)
                OR (LogDateTime = @lastLogDateTime AND EmpCode = @lastEmpCode AND Direction > @lastDirection)
                OR (LogDateTime = @lastLogDateTime AND EmpCode = @lastEmpCode AND Direction = @lastDirection AND DeviceName > @lastDeviceName)
            )`;
        } else if (minStartDate) {
            const minDateVal = minStartDate instanceof Date ? minStartDate : new Date(minStartDate);
            request.input("minStartDate", sql.DateTime, minDateVal);
            whereClause += ` AND LogDateTime >= @minStartDate`;
        }

        if (allowed && allowed.length > 0) {
            const paramNames = allowed.map((code, idx) => {
                const pName = `emp_${idx}`;
                request.input(pName, sql.NVarChar, code);
                return `@${pName}`;
            });
            whereClause += ` AND EmpCode IN (${paramNames.join(",")})`;
        }

        const queryStr = `SELECT COUNT(*) AS pending FROM dbo.GREYTIP WHERE ${whereClause}`;
        const result = await request.query(queryStr);
        return result.recordset[0]?.pending || 0;
    }

    public async fetchBatch(
        batchSize: number,
        cursor: AttendanceCursor | null,
        allowedEmpCodes?: string[],
        minStartDate?: Date | string
    ): Promise<RawAttendanceRow[]> {
        const allowed = allowedEmpCodes && allowedEmpCodes.length > 0
            ? allowedEmpCodes.map((c) => c.toUpperCase())
            : null;

        if (this.isMock) {
            this.initMockDb();
            let whereClause = "1=1";
            const params: any[] = [];

            if (cursor && cursor.lastLogDateTime) {
                const dateStr = cursor.lastLogDateTime instanceof Date
                    ? cursor.lastLogDateTime.toISOString()
                    : new Date(cursor.lastLogDateTime).toISOString();
                whereClause += ` AND (
                    LogDateTime > ?
                    OR (LogDateTime = ? AND EmpCode > ?)
                    OR (LogDateTime = ? AND EmpCode = ? AND Direction > ?)
                    OR (LogDateTime = ? AND EmpCode = ? AND Direction = ? AND DeviceName > ?)
                )`;
                params.push(
                    dateStr,
                    dateStr, cursor.lastEmpCode,
                    dateStr, cursor.lastEmpCode, cursor.lastDirection,
                    dateStr, cursor.lastEmpCode, cursor.lastDirection, cursor.lastDeviceName
                );
            } else if (minStartDate) {
                const minStr = minStartDate instanceof Date ? minStartDate.toISOString() : new Date(minStartDate).toISOString();
                whereClause += ` AND LogDateTime >= ?`;
                params.push(minStr);
            }

            if (allowed && allowed.length > 0) {
                const placeholders = allowed.map(() => "?").join(",");
                whereClause += ` AND EmpCode IN (${placeholders})`;
                params.push(...allowed);
            }

            const query = `
                SELECT EmpCode, LogDateTime, Direction, DeviceName
                FROM dbo_GREYTIP
                WHERE ${whereClause}
                ORDER BY LogDateTime ASC, EmpCode ASC, Direction ASC, DeviceName ASC
                LIMIT ?
            `;
            params.push(batchSize);
            const rows: any[] = this.mockDb.prepare(query).all(...params);
            return rows;
        }

        const pool = await this.connect();
        const request = pool.request();
        request.input("batchSize", sql.Int, batchSize);

        let whereClause = "1=1";

        if (cursor && cursor.lastLogDateTime) {
            const dateVal = cursor.lastLogDateTime instanceof Date
                ? cursor.lastLogDateTime
                : new Date(cursor.lastLogDateTime);
            request.input("lastLogDateTime", sql.DateTime, dateVal);
            request.input("lastEmpCode", sql.NVarChar, cursor.lastEmpCode);
            request.input("lastDirection", sql.NVarChar, cursor.lastDirection);
            request.input("lastDeviceName", sql.NVarChar, cursor.lastDeviceName);
            whereClause += ` AND (
                LogDateTime > @lastLogDateTime
                OR (LogDateTime = @lastLogDateTime AND EmpCode > @lastEmpCode)
                OR (LogDateTime = @lastLogDateTime AND EmpCode = @lastEmpCode AND Direction > @lastDirection)
                OR (LogDateTime = @lastLogDateTime AND EmpCode = @lastEmpCode AND Direction = @lastDirection AND DeviceName > @lastDeviceName)
            )`;
        } else if (minStartDate) {
            const minDateVal = minStartDate instanceof Date ? minStartDate : new Date(minStartDate);
            request.input("minStartDate", sql.DateTime, minDateVal);
            whereClause += ` AND LogDateTime >= @minStartDate`;
        }

        if (allowed && allowed.length > 0) {
            const paramNames = allowed.map((code, idx) => {
                const pName = `emp_${idx}`;
                request.input(pName, sql.NVarChar, code);
                return `@${pName}`;
            });
            whereClause += ` AND EmpCode IN (${paramNames.join(",")})`;
        }

        const queryStr = `
            SELECT TOP (@batchSize)
                EmpCode,
                LogDateTime,
                Direction,
                DeviceName
            FROM dbo.GREYTIP
            WHERE ${whereClause}
            ORDER BY
                LogDateTime ASC,
                EmpCode ASC,
                Direction ASC,
                DeviceName ASC
        `;

        const result = await request.query(queryStr);
        let rows: RawAttendanceRow[] = result.recordset || [];

        // Additional in-memory verification guarantee
        if (allowed && allowed.length > 0) {
            const allowedSet = new Set(allowed);
            rows = rows.filter((r) => allowedSet.has(r.EmpCode.toUpperCase()));
        }
        if (minStartDate) {
            const minMs = new Date(minStartDate).getTime();
            rows = rows.filter((r) => new Date(r.LogDateTime).getTime() >= minMs);
        }

        return rows;
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
