const express = require('express');

const router = express.Router();

function getExpectedSecret() {
  return process.env.ACTIVITY_ADMIN_SECRET || process.env.DEBUG_EMAIL_SECRET || 'debug123';
}

function resolveProvidedSecret(req) {
  const querySecret = typeof req.query?.secret === 'string' ? req.query.secret : '';
  const headerSecret = typeof req.headers['x-activity-secret'] === 'string' ? req.headers['x-activity-secret'] : '';
  return querySecret || headerSecret || '';
}

router.get('/activity', (req, res) => {
  const providedSecret = resolveProvidedSecret(req);
  const expectedSecret = getExpectedSecret();

  if (!providedSecret || providedSecret !== expectedSecret) {
    return res.status(403).send('Forbidden');
  }

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Activity Admin Dashboard</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0b1220;
      --surface: #121a2b;
      --surface-2: #172036;
      --border: #26324d;
      --text: #e5e7eb;
      --muted: #9ca3af;
      --accent: #3b82f6;
      --good: #34d399;
      --warn: #f59e0b;
      --violet: #a78bfa;
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, Segoe UI, Roboto, Arial, sans-serif;
      background: linear-gradient(180deg, var(--bg), #0f172a 70%);
      color: var(--text);
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 24px;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 16px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }

    .title {
      margin: 0;
      font-size: 28px;
      font-weight: 700;
    }

    .subtitle {
      margin: 6px 0 0;
      color: var(--muted);
      font-size: 14px;
    }

    .controls {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
    }

    select, button {
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      border-radius: 10px;
      padding: 10px 12px;
      font-size: 14px;
    }

    button {
      background: var(--accent);
      border-color: transparent;
      cursor: pointer;
      font-weight: 600;
    }

    button:disabled { opacity: 0.7; cursor: not-allowed; }

    .grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 14px;
    }

    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 14px;
    }

    .metric-title {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin: 0;
    }

    .metric-value {
      margin: 8px 0 0;
      font-size: 28px;
      font-weight: 700;
      line-height: 1.1;
    }

    .sections {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 12px;
    }

    .section-title {
      margin: 0 0 10px;
      font-size: 16px;
    }

    .list-row {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      padding: 9px 10px;
      border-radius: 10px;
      background: var(--surface-2);
      border: 1px solid var(--border);
      margin-bottom: 8px;
      font-size: 14px;
    }

    .table-wrap {
      overflow-x: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }

    th, td {
      text-align: left;
      padding: 10px;
      border-bottom: 1px solid var(--border);
      white-space: nowrap;
    }

    th { color: var(--muted); font-weight: 600; }

    .error {
      margin-bottom: 12px;
      color: #fca5a5;
      font-size: 14px;
    }

    .muted { color: var(--muted); }

    @media (max-width: 980px) {
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .sections { grid-template-columns: 1fr; }
    }

    @media (max-width: 560px) {
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <h1 class="title">Activity Admin Dashboard</h1>
        <p class="subtitle">Private analytics view. Not visible in the public website navigation.</p>
      </div>
      <div class="controls">
        <select id="daysSelect">
          <option value="7">Last 7 days</option>
          <option value="14">Last 14 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
        <button id="refreshBtn" type="button">Refresh</button>
      </div>
    </div>

    <div id="error" class="error" style="display:none"></div>

    <div class="grid">
      <div class="card">
        <p class="metric-title">Registered users</p>
        <p class="metric-value" id="registeredUsers">0</p>
      </div>
      <div class="card">
        <p class="metric-title">Logged-in users today</p>
        <p class="metric-value" id="loggedOnUsersToday" style="color: var(--good)">0</p>
      </div>
      <div class="card">
        <p class="metric-title">Clicks today</p>
        <p class="metric-value" id="clicksToday" style="color: var(--warn)">0</p>
      </div>
      <div class="card">
        <p class="metric-title">Unique visitors today</p>
        <p class="metric-value" id="uniqueVisitorsToday" style="color: var(--violet)">0</p>
      </div>
    </div>

    <div class="sections">
      <div class="card">
        <h2 class="section-title">What users opened</h2>
        <div id="topPages"></div>
      </div>
      <div class="card">
        <h2 class="section-title">What they used</h2>
        <div id="topElements"></div>
      </div>
    </div>

    <div class="card">
      <h2 class="section-title">Visitors per day</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Day</th>
              <th>Visitors</th>
              <th>Logged users</th>
              <th>Page views</th>
              <th>Clicks</th>
            </tr>
          </thead>
          <tbody id="dailyTable"></tbody>
        </table>
      </div>
    </div>
  </div>

  <script>
    const url = new URL(window.location.href);
    const secret = url.searchParams.get('secret') || '';

    const els = {
      error: document.getElementById('error'),
      daysSelect: document.getElementById('daysSelect'),
      refreshBtn: document.getElementById('refreshBtn'),
      registeredUsers: document.getElementById('registeredUsers'),
      loggedOnUsersToday: document.getElementById('loggedOnUsersToday'),
      clicksToday: document.getElementById('clicksToday'),
      uniqueVisitorsToday: document.getElementById('uniqueVisitorsToday'),
      topPages: document.getElementById('topPages'),
      topElements: document.getElementById('topElements'),
      dailyTable: document.getElementById('dailyTable')
    };

    function renderList(target, rows, leftKey, rightKey, emptyText) {
      if (!Array.isArray(rows) || rows.length === 0) {
        target.innerHTML = '<div class="muted">' + emptyText + '</div>';
        return;
      }
      target.innerHTML = rows
        .map((row) => {
          const left = String(row[leftKey] || '—');
          const right = Number(row[rightKey] || 0);
          return '<div class="list-row"><span>' + left + '</span><strong>' + right + '</strong></div>';
        })
        .join('');
    }

    function renderDaily(rows) {
      if (!Array.isArray(rows) || rows.length === 0) {
        els.dailyTable.innerHTML = '<tr><td class="muted" colspan="5">No data yet.</td></tr>';
        return;
      }

      els.dailyTable.innerHTML = rows
        .map((row) => {
          const day = new Date(row.day);
          const dayText = Number.isNaN(day.getTime()) ? '—' : day.toLocaleDateString();
          return '<tr>' +
            '<td>' + dayText + '</td>' +
            '<td>' + Number(row.uniqueVisitors || 0) + '</td>' +
            '<td>' + Number(row.uniqueUsers || 0) + '</td>' +
            '<td>' + Number(row.pageViewCount || 0) + '</td>' +
            '<td>' + Number(row.clickCount || 0) + '</td>' +
          '</tr>';
        })
        .join('');
    }

    async function loadSummary() {
      els.error.style.display = 'none';
      els.error.textContent = '';
      els.refreshBtn.disabled = true;
      els.refreshBtn.textContent = 'Loading...';

      try {
        const days = Number(els.daysSelect.value || '7');
        const response = await fetch('/api/activity/summary?days=' + days + '&secret=' + encodeURIComponent(secret), {
          headers: { 'x-activity-secret': secret }
        });
        const data = await response.json();

        if (!response.ok || !data?.ok) {
          throw new Error(data?.error || 'Failed to load summary');
        }

        els.registeredUsers.textContent = Number(data.registeredUsers || 0);
        els.loggedOnUsersToday.textContent = Number(data.loggedOnUsersToday || 0);
        els.clicksToday.textContent = Number(data.clicksToday || 0);
        els.uniqueVisitorsToday.textContent = Number(data.uniqueVisitorsToday || 0);

        renderList(els.topPages, data.topPages, 'pagePath', 'views', 'No page data yet.');
        renderList(els.topElements, data.topElements, 'element', 'clicks', 'No click data yet.');
        renderDaily(data.daily);
      } catch (error) {
        els.error.style.display = 'block';
        els.error.textContent = error?.message || 'Failed to load summary';
      } finally {
        els.refreshBtn.disabled = false;
        els.refreshBtn.textContent = 'Refresh';
      }
    }

    els.refreshBtn.addEventListener('click', loadSummary);
    loadSummary();
  </script>
</body>
</html>`;

  return res.status(200).send(html);
});

module.exports = router;
