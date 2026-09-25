export interface RawAttendanceRow {
    EmpCode: string;
    LogDateTime: Date | string;
    Direction: string;
    DeviceName: string;
}

export interface AttendanceCursor {
    lastLogDateTime: Date | string;
    lastEmpCode: string;
    lastDirection: string;
    lastDeviceName: string;
}

export const SQL_QUERIES = {
    /**
     * Test connection and table existence
     */
    TEST_CONNECTION: `
        SELECT TOP 1 1 AS ok 
        FROM dbo.GREYTIP
    `,

    /**
     * Total count of records in dbo.GREYTIP
     */
    GET_TOTAL_COUNT: `
        SELECT COUNT(*) AS total 
        FROM dbo.GREYTIP
    `,

    /**
     * Fetch initial batch without cursor
     */
    FETCH_INITIAL_BATCH: `
        SELECT TOP (@batchSize)
            EmpCode,
            LogDateTime,
            Direction,
            DeviceName
        FROM dbo.GREYTIP
        ORDER BY
            LogDateTime ASC,
            EmpCode ASC,
            Direction ASC,
            DeviceName ASC
    `,

    /**
     * Fetch incremental batch using deterministic cursor
     */
    FETCH_INCREMENTAL_BATCH: `
        SELECT TOP (@batchSize)
            EmpCode,
            LogDateTime,
            Direction,
            DeviceName
        FROM dbo.GREYTIP
        WHERE (
            LogDateTime > @lastLogDateTime
            OR (LogDateTime = @lastLogDateTime AND EmpCode > @lastEmpCode)
            OR (LogDateTime = @lastLogDateTime AND EmpCode = @lastEmpCode AND Direction > @lastDirection)
            OR (LogDateTime = @lastLogDateTime AND EmpCode = @lastEmpCode AND Direction = @lastDirection AND DeviceName > @lastDeviceName)
        )
        ORDER BY
            LogDateTime ASC,
            EmpCode ASC,
            Direction ASC,
            DeviceName ASC
    `,

    /**
     * Count records pending synchronization after current cursor
     */
    COUNT_PENDING_AFTER_CURSOR: `
        SELECT COUNT(*) AS pending
        FROM dbo.GREYTIP
        WHERE (
            LogDateTime > @lastLogDateTime
            OR (LogDateTime = @lastLogDateTime AND EmpCode > @lastEmpCode)
            OR (LogDateTime = @lastLogDateTime AND EmpCode = @lastEmpCode AND Direction > @lastDirection)
            OR (LogDateTime = @lastLogDateTime AND EmpCode = @lastEmpCode AND Direction = @lastDirection AND DeviceName > @lastDeviceName)
        )
    `,
};
