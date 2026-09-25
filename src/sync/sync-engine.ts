import { AgentConfig } from "../config.js";
import { SqlServerDatabase } from "../database/sqlserver.js";
import { StateManager } from "./state-manager.js";
import { BatchSender } from "./batch-sender.js";
import { Logger } from "../logging/logger.js";
import { AttendanceCursor } from "../database/queries.js";

export interface SyncEngineStatus {
    isSyncing: boolean;
    lastSyncTime: string | null;
    totalSent: number;
    pendingRecords: number;
    currentBatch: number;
    lastError: string | null;
}

export class SyncEngine {
    private config: AgentConfig;
    private db: SqlServerDatabase;
    private stateManager: StateManager;
    private batchSender: BatchSender;
    private logger: Logger;

    private isRunning = false;
    private isSyncing = false;
    private timer: NodeJS.Timeout | null = null;
    private currentBatchCount = 0;
    private lastError: string | null = null;

    constructor(
        config: AgentConfig,
        db: SqlServerDatabase,
        stateManager: StateManager,
        batchSender: BatchSender,
        logger: Logger
    ) {
        this.config = config;
        this.db = db;
        this.stateManager = stateManager;
        this.batchSender = batchSender;
        this.logger = logger;
    }

    private getCursor(): AttendanceCursor | null {
        const state = this.stateManager.getState();
        if (
            !state.initialized ||
            !state.lastLogDateTime ||
            !state.lastEmpCode ||
            !state.lastDirection ||
            !state.lastDeviceName
        ) {
            return null;
        }

        return {
            lastLogDateTime: state.lastLogDateTime,
            lastEmpCode: state.lastEmpCode,
            lastDirection: state.lastDirection,
            lastDeviceName: state.lastDeviceName,
        };
    }

    /**
     * Perform a dry run without sending data or updating state
     */
    public async runDryRun(): Promise<{ totalInDb: number; pendingCount: number; sampleBatchSize: number }> {
        this.logger.info("Executing DRY RUN (No records will be sent to VPS, state will not change)");
        const total = await this.db.getTotalCount();
        const cursor = this.getCursor();
        const pending = await this.db.getPendingCount(cursor);
        const sampleRows = await this.db.fetchBatch(Math.min(10, this.config.sync.batchSize), cursor);

        this.logger.info(`Dry Run Summary: Total in DB: ${total} | Pending after cursor: ${pending}`);
        if (sampleRows.length > 0) {
            this.logger.info(`Preview of first ${sampleRows.length} pending records:`);
            sampleRows.forEach((r, idx) => {
                this.logger.info(
                    `  [${idx + 1}] EmpCode=${r.EmpCode}, LogDateTime=${r.LogDateTime}, Direction=${r.Direction}, DeviceName=${r.DeviceName}`
                );
            });
        } else {
            this.logger.info("No pending records to synchronize.");
        }

        return {
            totalInDb: total,
            pendingCount: pending,
            sampleBatchSize: sampleRows.length,
        };
    }

    /**
     * Reset cursor for full historical synchronization
     */
    public resetForFullSync(): void {
        this.logger.warn("Resetting persistent state for FULL synchronization");
        this.stateManager.resetCursor();
    }

    /**
     * Run a single synchronization pass (processes batches until backlog is drained)
     */
    public async runSyncCycle(): Promise<{ batchesProcessed: number; recordsProcessed: number }> {
        if (this.isSyncing) {
            this.logger.debug("Sync cycle already in progress, skipping concurrent run");
            return { batchesProcessed: 0, recordsProcessed: 0 };
        }

        this.isSyncing = true;
        this.lastError = null;
        let batchesCount = 0;
        let totalRecordsCycle = 0;

        try {
            while (true) {
                const cursor = this.getCursor();
                this.logger.debug(
                    `Reading batch of up to ${this.config.sync.batchSize} records (Cursor: ${cursor ? cursor.lastLogDateTime : "START"})`
                );

                const rows = await this.db.fetchBatch(this.config.sync.batchSize, cursor);

                if (!rows || rows.length === 0) {
                    this.logger.debug("No new records to synchronize.");
                    break;
                }

                batchesCount++;
                this.currentBatchCount = batchesCount;
                this.logger.info(
                    `Fetched batch #${batchesCount} containing ${rows.length} records from dbo.GREYTIP`
                );

                // Send to VPS - CRITICAL: Cursor is only advanced AFTER VPS responds successfully
                const vpsResponse = await this.batchSender.send(rows);

                if (vpsResponse.success || vpsResponse.failed === 0) {
                    const lastRow = rows[rows.length - 1];
                    this.stateManager.updateCursor(
                        {
                            logDateTime: lastRow.LogDateTime,
                            empCode: String(lastRow.EmpCode || "").trim(),
                            direction: String(lastRow.Direction || "").trim().toLowerCase(),
                            deviceName: String(lastRow.DeviceName || "").trim(),
                        },
                        rows.length
                    );
                    totalRecordsCycle += rows.length;
                } else {
                    const errMsg = `VPS reported batch failure: failed=${vpsResponse.failed}`;
                    this.logger.error(errMsg);
                    this.lastError = errMsg;
                    // Do NOT advance cursor
                    break;
                }

                // If rows fetched is less than batch size, backlog is cleared
                if (rows.length < this.config.sync.batchSize) {
                    this.logger.info("Backlog drained. Back to normal polling mode.");
                    break;
                }

                // If rows == batchSize, continue loop immediately to drain initial backlog
            }
        } catch (err: any) {
            this.lastError = err?.message || String(err);
            this.logger.error("Sync cycle failed", err);
        } finally {
            this.isSyncing = false;
            this.currentBatchCount = 0;
        }

        return {
            batchesProcessed: batchesCount,
            recordsProcessed: totalRecordsCycle,
        };
    }

    /**
     * Start continuous background polling
     */
    public start(): void {
        if (this.isRunning) return;
        this.isRunning = true;
        this.logger.info(`Starting Continuous Sync Engine (Interval: ${this.config.sync.intervalMs / 1000}s)`);

        const poll = async () => {
            if (!this.isRunning) return;
            try {
                await this.runSyncCycle();
            } catch (err) {
                this.logger.error("Unexpected error in poll cycle", err);
            } finally {
                if (this.isRunning) {
                    this.timer = setTimeout(poll, this.config.sync.intervalMs);
                }
            }
        };

        // Immediate first run
        poll();
    }

    /**
     * Stop continuous background polling
     */
    public stop(): void {
        this.isRunning = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.logger.info("Sync Engine background scheduler stopped");
    }

    public async getStatus(): Promise<SyncEngineStatus> {
        const state = this.stateManager.getState();
        let pending = 0;

        try {
            if (await this.db.isConnected()) {
                pending = await this.db.getPendingCount(this.getCursor());
            }
        } catch {
            // Ignore status query failure
        }

        return {
            isSyncing: this.isSyncing,
            lastSyncTime: state.lastSuccessfulSync,
            totalSent: state.totalSent,
            pendingRecords: pending,
            currentBatch: this.currentBatchCount,
            lastError: this.lastError,
        };
    }
}
