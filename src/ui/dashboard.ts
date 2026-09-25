export function getDashboardHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>eSSL Attendance Sync Manager</title>
    <style>
        :root {
            --primary: #2563eb;
            --primary-hover: #1d4ed8;
            --bg: #f8fafc;
            --card-bg: #ffffff;
            --text: #0f172a;
            --text-muted: #64748b;
            --border: #e2e8f0;
            --success: #16a34a;
            --danger: #dc2626;
            --warning: #f59e0b;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background: var(--bg);
            color: var(--text);
            line-height: 1.5;
            padding: 24px;
        }
        .container { max-width: 1000px; margin: 0 auto; }
        header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 24px;
            padding-bottom: 16px;
            border-bottom: 1px solid var(--border);
        }
        h1 { font-size: 1.5rem; font-weight: 700; color: #1e293b; }
        .badge {
            display: inline-flex;
            align-items: center;
            padding: 4px 10px;
            border-radius: 9999px;
            font-size: 0.75rem;
            font-weight: 600;
        }
        .badge-success { background: #dcfce7; color: #15803d; }
        .badge-danger { background: #fee2e2; color: #b91c1c; }
        .badge-warning { background: #fef3c7; color: #b45309; }

        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 24px; }
        .card {
            background: var(--card-bg);
            border-radius: 8px;
            padding: 20px;
            border: 1px solid var(--border);
            box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        }
        .card-title { font-size: 0.85rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; margin-bottom: 8px; }
        .card-val { font-size: 1.5rem; font-weight: 700; }

        .actions {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            margin-bottom: 24px;
        }
        button {
            padding: 9px 16px;
            border-radius: 6px;
            font-weight: 600;
            font-size: 0.875rem;
            cursor: pointer;
            border: 1px solid transparent;
            transition: all 0.2s ease;
        }
        .btn-primary { background: var(--primary); color: #fff; }
        .btn-primary:hover { background: var(--primary-hover); }
        .btn-secondary { background: #fff; border-color: var(--border); color: #334155; }
        .btn-secondary:hover { background: #f1f5f9; }
        .btn-danger { background: var(--danger); color: #fff; }

        .panel {
            background: var(--card-bg);
            border-radius: 8px;
            border: 1px solid var(--border);
            margin-bottom: 24px;
            overflow: hidden;
        }
        .panel-header {
            padding: 16px 20px;
            border-bottom: 1px solid var(--border);
            font-weight: 700;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .panel-body { padding: 20px; }

        .logs-box {
            background: #0f172a;
            color: #e2e8f0;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            font-size: 0.8rem;
            padding: 16px;
            border-radius: 6px;
            height: 280px;
            overflow-y: auto;
            white-space: pre-wrap;
        }

        #action-status {
            margin-bottom: 16px;
            padding: 12px;
            border-radius: 6px;
            display: none;
            font-size: 0.875rem;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <div>
                <h1>eSSL Biometric Attendance Sync Agent</h1>
                <p style="color: var(--text-muted); font-size: 0.85rem;">Local Windows Background Service</p>
            </div>
            <div>
                <span id="service-badge" class="badge badge-success">Running</span>
            </div>
        </header>

        <div id="action-status"></div>

        <div class="grid">
            <div class="card">
                <div class="card-title">SQL Server</div>
                <div id="sql-status" class="card-val" style="font-size: 1.1rem;">Checking...</div>
                <div id="db-name" style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">etimetracklitenew</div>
            </div>
            <div class="card">
                <div class="card-title">VPS API Status</div>
                <div id="vps-status" class="card-val" style="font-size: 1.1rem;">Checking...</div>
                <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">Team Management</div>
            </div>
            <div class="card">
                <div class="card-title">Total Records Sent</div>
                <div id="total-sent" class="card-val">0</div>
                <div id="last-sync-time" style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">Last: Never</div>
            </div>
            <div class="card">
                <div class="card-title">Pending In Backlog</div>
                <div id="pending-records" class="card-val">0</div>
                <div id="sync-state-mode" style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">Idle</div>
            </div>
        </div>

        <div class="actions">
            <button class="btn-primary" onclick="triggerSync()">Run Sync Now</button>
            <button class="btn-secondary" onclick="testSql()">Test SQL Connection</button>
            <button class="btn-secondary" onclick="testVps()">Test VPS Connection</button>
            <button class="btn-secondary" onclick="refreshData()">Refresh Status</button>
        </div>

        <div class="panel">
            <div class="panel-header">
                <span>Live Event Logs</span>
                <button class="btn-secondary" style="padding: 4px 10px; font-size: 0.75rem;" onclick="fetchLogs()">Clear/Reload</button>
            </div>
            <div class="panel-body">
                <div id="logs" class="logs-box">Loading logs...</div>
            </div>
        </div>
    </div>

    <script>
        function showMsg(msg, isError) {
            const el = document.getElementById('action-status');
            el.style.display = 'block';
            el.style.background = isError ? '#fee2e2' : '#dcfce7';
            el.style.color = isError ? '#b91c1c' : '#15803d';
            el.textContent = msg;
            setTimeout(() => { el.style.display = 'none'; }, 6000);
        }

        async function refreshData() {
            try {
                const res = await fetch('/api/status');
                const data = await res.json();
                
                document.getElementById('sql-status').textContent = data.sqlServer === 'connected' ? 'Connected' : 'Disconnected';
                document.getElementById('sql-status').style.color = data.sqlServer === 'connected' ? 'var(--success)' : 'var(--danger)';
                document.getElementById('db-name').textContent = data.database;

                document.getElementById('vps-status').textContent = data.vps === 'connected' ? 'Online' : (data.vps || 'Offline');
                document.getElementById('vps-status').style.color = data.vps === 'connected' ? 'var(--success)' : 'var(--danger)';

                document.getElementById('total-sent').textContent = data.recordsSent.toLocaleString();
                document.getElementById('last-sync-time').textContent = data.lastSync ? new Date(data.lastSync).toLocaleTimeString() : 'Never';

                document.getElementById('pending-records').textContent = (data.pendingCount || 0).toLocaleString();
                document.getElementById('sync-state-mode').textContent = data.pending ? 'Syncing...' : 'Idle';

                fetchLogs();
            } catch (err) {
                console.error(err);
            }
        }

        async function triggerSync() {
            try {
                showMsg('Triggering manual synchronization cycle...', false);
                const res = await fetch('/api/sync/run', { method: 'POST' });
                const data = await res.json();
                showMsg('Sync completed: ' + data.recordsProcessed + ' records processed across ' + data.batchesProcessed + ' batches.', false);
                refreshData();
            } catch (err) {
                showMsg('Failed to trigger sync: ' + err.message, true);
            }
        }

        async function testSql() {
            try {
                showMsg('Testing SQL Server connection...', false);
                const res = await fetch('/api/test/sql', { method: 'POST' });
                const data = await res.json();
                showMsg(data.ok ? 'SQL Server test successful: ' + data.message : 'SQL Server test failed: ' + data.message, !data.ok);
                refreshData();
            } catch (err) {
                showMsg('SQL test request failed: ' + err.message, true);
            }
        }

        async function testVps() {
            try {
                showMsg('Testing VPS API connection...', false);
                const res = await fetch('/api/test/vps', { method: 'POST' });
                const data = await res.json();
                showMsg(data.ok ? 'VPS connection successful: status=' + data.status : 'VPS connection failed: ' + data.message, !data.ok);
                refreshData();
            } catch (err) {
                showMsg('VPS test request failed: ' + err.message, true);
            }
        }

        async function fetchLogs() {
            try {
                const res = await fetch('/api/logs');
                const data = await res.json();
                const box = document.getElementById('logs');
                box.textContent = (data.logs || []).join('\\n');
                box.scrollTop = box.scrollHeight;
            } catch (err) {
                console.error(err);
            }
        }

        // Initial load & periodic poll
        refreshData();
        setInterval(refreshData, 10000);
    </script>
</body>
</html>`;
}
