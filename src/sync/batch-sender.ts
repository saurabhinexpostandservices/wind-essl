import { RawAttendanceRow } from "../database/queries.js";
import { ApiClient, AttendanceBatchPayload, AttendanceBatchResponse, AttendancePayloadRecord } from "../api/api-client.js";
import { Logger } from "../logging/logger.js";

export class BatchSender {
    private apiClient: ApiClient;
    private deviceId: string;
    private logger: Logger;

    constructor(apiClient: ApiClient, deviceId: string, logger: Logger) {
        this.apiClient = apiClient;
        this.deviceId = deviceId;
        this.logger = logger;
    }

    /**
     * Format a Date or SQL string to local ISO representation (YYYY-MM-DDTHH:mm:ss)
     */
    private formatLocalDateTime(dateVal: Date | string): string {
        if (dateVal instanceof Date) {
            const year = dateVal.getFullYear();
            const month = String(dateVal.getMonth() + 1).padStart(2, "0");
            const day = String(dateVal.getDate()).padStart(2, "0");
            const hours = String(dateVal.getHours()).padStart(2, "0");
            const mins = String(dateVal.getMinutes()).padStart(2, "0");
            const secs = String(dateVal.getSeconds()).padStart(2, "0");
            return `${year}-${month}-${day}T${hours}:${mins}:${secs}`;
        }

        const str = String(dateVal).trim();
        // If already in ISO or SQL Server format "YYYY-MM-DD HH:mm:ss"
        if (str.includes(" ")) {
            return str.replace(" ", "T").split(".")[0];
        }
        return str;
    }

    /**
     * Transform raw SQL rows into API records
     */
    public transformRows(rows: RawAttendanceRow[]): AttendancePayloadRecord[] {
        return rows.map((row) => {
            const cleanDirection = String(row.Direction || "").trim().toLowerCase();
            const direction = ["in", "out"].includes(cleanDirection) ? cleanDirection : "unknown";

            return {
                empCode: String(row.EmpCode || "").trim(),
                logDateTime: this.formatLocalDateTime(row.LogDateTime),
                direction,
                deviceName: String(row.DeviceName || "").trim(),
            };
        });
    }

    /**
     * Send transformed batch to VPS
     */
    public async send(rows: RawAttendanceRow[]): Promise<AttendanceBatchResponse> {
        const records = this.transformRows(rows);
        const payload: AttendanceBatchPayload = {
            deviceId: this.deviceId,
            records,
        };

        this.logger.info(`Sending batch of ${records.length} records to VPS`);
        const response = await this.apiClient.sendBatch(payload);
        this.logger.info(
            `VPS response: inserted=${response.inserted} duplicates=${response.duplicates} failed=${response.failed}`
        );

        return response;
    }
}
