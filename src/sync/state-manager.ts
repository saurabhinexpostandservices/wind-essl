import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { Logger } from "../logging/logger.js";

const require = createRequire(import.meta.url);

export interface SyncState {
    initialized: boolean;
    lastLogDateTime: string | null;
    lastEmpCode: string | null;
    lastDirection: string | null;
    lastDeviceName: string | null;
    totalSent: number;
    lastSuccessfulSync: string | null;
}

export class StateManager {
    private jsonFilePath: string;
    private dbFilePath: string;
    private sqliteDb: any = null;
    private state: SyncState;
    private logger: Logger;

    constructor(dataDir: string, logger: Logger) {
        this.logger = logger;
        const resolvedDataDir = path.resolve(dataDir);

        if (!fs.existsSync(resolvedDataDir)) {
            fs.mkdirSync(resolvedDataDir, { recursive: true });
        }

        this.jsonFilePath = path.join(resolvedDataDir, "sync-state.json");
        this.dbFilePath = path.join(resolvedDataDir, "sync-state.db");

        this.state = this.getDefaultState();
        this.initSqlite();
        this.loadState();
    }

    private getDefaultState(): SyncState {
        return {
            initialized: false,
            lastLogDateTime: null,
            lastEmpCode: null,
            lastDirection: null,
            lastDeviceName: null,
            totalSent: 0,
            lastSuccessfulSync: null,
        };
    }

    private initSqlite() {
        try {
            // Attempt to load built-in node:sqlite (Node 22+)
            // Dynamic import or require to ensure safe fallback
            const { DatabaseSync } = require("node:sqlite");
            this.sqliteDb = new DatabaseSync(this.dbFilePath);
            this.sqliteDb.exec(`
                CREATE TABLE IF NOT EXISTS sync_state (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    state_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
            `);
        } catch {
            this.sqliteDb = null;
            this.logger.debug("Running with atomic JSON state persistence (SQLite fallback)");
        }
    }

    private loadState() {
        // Try reading from SQLite first
        if (this.sqliteDb) {
            try {
                const query = this.sqliteDb.prepare("SELECT state_json FROM sync_state WHERE id = 1");
                const row = query.get();
                if (row && row.state_json) {
                    this.state = JSON.parse(row.state_json);
                    this.saveJsonMirror(); // keep json file in sync
                    return;
                }
            } catch (err) {
                this.logger.warn("Could not read state from SQLite, attempting JSON fallback", err);
            }
        }

        // Fallback to sync-state.json
        if (fs.existsSync(this.jsonFilePath)) {
            try {
                const content = fs.readFileSync(this.jsonFilePath, "utf8");
                this.state = { ...this.getDefaultState(), ...JSON.parse(content) };
                if (this.sqliteDb) {
                    this.saveSqlite();
                }
            } catch (err) {
                this.logger.error("Error reading JSON state file, initializing clean state", err);
                this.state = this.getDefaultState();
            }
        }
    }

    private saveSqlite() {
        if (!this.sqliteDb) return;
        try {
            const stmt = this.sqliteDb.prepare(`
                INSERT INTO sync_state (id, state_json, updated_at)
                VALUES (1, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    state_json = excluded.state_json,
                    updated_at = excluded.updated_at;
            `);
            stmt.run(JSON.stringify(this.state), new Date().toISOString());
        } catch (err) {
            this.logger.error("Failed to persist state into SQLite", err);
        }
    }

    private saveJsonMirror() {
        try {
            const tempFile = `${this.jsonFilePath}.${Date.now()}.tmp`;
            fs.writeFileSync(tempFile, JSON.stringify(this.state, null, 2), "utf8");
            fs.renameSync(tempFile, this.jsonFilePath);
        } catch (err) {
            this.logger.error("Failed to write atomic JSON state mirror", err);
        }
    }

    public getState(): Readonly<SyncState> {
        return { ...this.state };
    }

    /**
     * Advance sync cursor only AFTER VPS confirmation
     */
    public updateCursor(
        lastRecord: {
            logDateTime: string | Date;
            empCode: string;
            direction: string;
            deviceName: string;
        },
        batchSentCount: number
    ) {
        const dateIso =
            lastRecord.logDateTime instanceof Date
                ? lastRecord.logDateTime.toISOString()
                : new Date(lastRecord.logDateTime).toISOString();

        this.state.initialized = true;
        this.state.lastLogDateTime = dateIso;
        this.state.lastEmpCode = lastRecord.empCode;
        this.state.lastDirection = lastRecord.direction;
        this.state.lastDeviceName = lastRecord.deviceName;
        this.state.totalSent += batchSentCount;
        this.state.lastSuccessfulSync = new Date().toISOString();

        // Transactionally save to SQLite and atomic JSON
        this.saveSqlite();
        this.saveJsonMirror();

        this.logger.info(
            `Sync cursor updated: lastLogDateTime=${this.state.lastLogDateTime} lastEmp=${this.state.lastEmpCode} totalSent=${this.state.totalSent}`
        );
    }

    /**
     * Reset cursor for full historical re-sync
     */
    public resetCursor() {
        this.state = {
            initialized: false,
            lastLogDateTime: null,
            lastEmpCode: null,
            lastDirection: null,
            lastDeviceName: null,
            totalSent: 0,
            lastSuccessfulSync: null,
        };

        this.saveSqlite();
        this.saveJsonMirror();
        this.logger.warn("Sync state has been reset for full synchronization");
    }

    public close() {
        if (this.sqliteDb) {
            try {
                this.sqliteDb.close();
            } catch {
                // Ignore close errors
            }
            this.sqliteDb = null;
        }
    }
}
