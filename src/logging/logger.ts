import fs from "node:fs";
import path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITIES: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

export class Logger {
    private logDir: string;
    private minLevel: LogLevel;
    private maxFiles: number;
    private recentLogs: string[] = [];
    private maxRecentLogs = 200;
    private currentLogDate = "";
    private currentLogStream: fs.WriteStream | null = null;

    constructor(logDir: string = "./logs", minLevel: LogLevel = "info", maxFiles: number = 14) {
        this.logDir = path.resolve(logDir);
        this.minLevel = minLevel;
        this.maxFiles = maxFiles;
        this.ensureLogDir();
    }

    private ensureLogDir() {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }

    private getLogDateString(): string {
        const d = new Date();
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    private getFormattedTimestamp(): string {
        const d = new Date();
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        const hours = String(d.getHours()).padStart(2, "0");
        const mins = String(d.getMinutes()).padStart(2, "0");
        const secs = String(d.getSeconds()).padStart(2, "0");
        return `${year}-${month}-${day} ${hours}:${mins}:${secs}`;
    }

    private sanitize(message: string): string {
        // Redact any passwords, secrets, bearer tokens, or API keys from logs
        return message
            .replace(/(password\s*[:=]\s*['"]?)([^'"\s,;]+)/gi, "$1***REDACTED***")
            .replace(/(apiKey\s*[:=]\s*['"]?)([^'"\s,;]+)/gi, "$1***REDACTED***")
            .replace(/(Bearer\s+)([A-Za-z0-9._~+/-]+=*)/gi, "$1***REDACTED***")
            .replace(/(X-API-Key\s*[:=]\s*['"]?)([^'"\s,;]+)/gi, "$1***REDACTED***");
    }

    private getStream(): fs.WriteStream {
        const today = this.getLogDateString();
        if (today !== this.currentLogDate || !this.currentLogStream) {
            if (this.currentLogStream) {
                this.currentLogStream.end();
            }
            this.currentLogDate = today;
            this.ensureLogDir();
            const logFilePath = path.join(this.logDir, `agent-${today}.log`);
            this.currentLogStream = fs.createWriteStream(logFilePath, { flags: "a" });
            this.currentLogStream.on("error", () => {
                // Ignore stream write errors gracefully (e.g. during test cleanup)
            });
            this.cleanOldLogs();
        }
        return this.currentLogStream;
    }

    private cleanOldLogs() {
        try {
            const files = fs
                .readdirSync(this.logDir)
                .filter((f) => f.startsWith("agent-") && f.endsWith(".log"))
                .sort();

            while (files.length > this.maxFiles) {
                const oldest = files.shift();
                if (oldest) {
                    fs.unlinkSync(path.join(this.logDir, oldest));
                }
            }
        } catch {
            // Ignore rotation cleanup failures
        }
    }

    private write(level: LogLevel, message: string, meta?: unknown) {
        if (LEVEL_PRIORITIES[level] < LEVEL_PRIORITIES[this.minLevel]) {
            return;
        }

        const timestamp = this.getFormattedTimestamp();
        let formattedMessage = this.sanitize(message);

        if (meta !== undefined) {
            if (meta instanceof Error) {
                formattedMessage += `\n${meta.stack || meta.message}`;
            } else if (typeof meta === "object") {
                try {
                    formattedMessage += ` ${this.sanitize(JSON.stringify(meta))}`;
                } catch {
                    formattedMessage += ` [Object]`;
                }
            } else {
                formattedMessage += ` ${this.sanitize(String(meta))}`;
            }
        }

        const logLine = `${timestamp} ${level.toUpperCase()} ${formattedMessage}`;

        // Console output
        if (level === "error") {
            console.error(logLine);
        } else if (level === "warn") {
            console.warn(logLine);
        } else {
            console.log(logLine);
        }

        // File output
        try {
            const stream = this.getStream();
            stream.write(logLine + "\n");
        } catch {
            // Safe fallback if file write fails
        }

        // Keep in-memory ring buffer
        this.recentLogs.push(logLine);
        if (this.recentLogs.length > this.maxRecentLogs) {
            this.recentLogs.shift();
        }
    }

    public debug(message: string, meta?: unknown) {
        this.write("debug", message, meta);
    }

    public info(message: string, meta?: unknown) {
        this.write("info", message, meta);
    }

    public warn(message: string, meta?: unknown) {
        this.write("warn", message, meta);
    }

    public error(message: string, meta?: unknown) {
        this.write("error", message, meta);
    }

    public getRecentLogs(): string[] {
        return [...this.recentLogs];
    }

    public close() {
        if (this.currentLogStream) {
            this.currentLogStream.end();
            this.currentLogStream = null;
        }
    }
}

// Global logger instance
let defaultLogger: Logger | null = null;

export function getLogger(config?: { dir: string; level: LogLevel; maxFiles: number }): Logger {
    if (!defaultLogger) {
        defaultLogger = new Logger(
            config?.dir || "./logs",
            config?.level || "info",
            config?.maxFiles || 14
        );
    }
    return defaultLogger;
}
