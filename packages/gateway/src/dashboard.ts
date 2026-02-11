import type { FastifyInstance } from 'fastify';
import { createLogger } from '@vena/shared';

const log = createLogger('gateway:dashboard');

export interface DashboardData {
  uptime: number;
  version: string;
  agents: Array<{ id: string; name: string; provider: string; model: string; status: string }>;
  cronJobs: Array<{ name: string; schedule: string; nextRun?: string; enabled: boolean }>;
  memory: { heapUsed: number; heapTotal: number; rss: number };
  recentActivity: Array<{ timestamp: number; type: string; summary: string }>;
  usage?: {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalEstimatedCost: number;
    recordCount: number;
  };
}

export function registerDashboard(
  app: FastifyInstance,
  getStatus: () => DashboardData
): void {
  log.info('Registering dashboard routes');

  // Main dashboard page
  app.get('/dashboard', async (request, reply) => {
    reply.type('text/html').send(getDashboardHTML());
  });

  // Status API endpoint
  app.get('/dashboard/api/status', async (request, reply) => {
    try {
      const status = getStatus();
      return status;
    } catch (err) {
      log.error({ err }, 'Error getting dashboard status');
      return reply.status(500).send({ error: 'Failed to get status' });
    }
  });

  // Agents API endpoint
  app.get('/dashboard/api/agents', async (request, reply) => {
    try {
      const status = getStatus();
      return { agents: status.agents };
    } catch (err) {
      log.error({ err }, 'Error getting agents');
      return reply.status(500).send({ error: 'Failed to get agents' });
    }
  });

  // Cron jobs API endpoint
  app.get('/dashboard/api/cron', async (request, reply) => {
    try {
      const status = getStatus();
      return { cronJobs: status.cronJobs };
    } catch (err) {
      log.error({ err }, 'Error getting cron jobs');
      return reply.status(500).send({ error: 'Failed to get cron jobs' });
    }
  });

  // Memory API endpoint
  app.get('/dashboard/api/memory', async (request, reply) => {
    try {
      const status = getStatus();
      return { memory: status.memory };
    } catch (err) {
      log.error({ err }, 'Error getting memory stats');
      return reply.status(500).send({ error: 'Failed to get memory stats' });
    }
  });

  log.info('Dashboard routes registered');
}

function getDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Vena Dashboard</title>
  <style>
    :root {
      --vena-primary: #FF6B2B;
      --vena-gold: #FF9F1C;
      --vena-deep: #FF4500;
      --bg-dark: #0D1117;
      --bg-card: #161B22;
      --bg-card-hover: #1C2128;
      --text-primary: #E6EDF3;
      --text-muted: #8B949E;
      --border-color: #30363D;
      --success: #3FB950;
      --warning: #D29922;
      --error: #F85149;
      --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.3);
      --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4);
      --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.5);
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif;
      background: var(--bg-dark);
      color: var(--text-primary);
      line-height: 1.6;
      min-height: 100vh;
    }

    .header {
      background: linear-gradient(135deg, var(--vena-deep) 0%, var(--vena-primary) 100%);
      padding: 1.5rem 2rem;
      box-shadow: var(--shadow-md);
      position: sticky;
      top: 0;
      z-index: 100;
    }

    .header-content {
      max-width: 1400px;
      margin: 0 auto;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1rem;
    }

    .logo {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .logo-icon {
      width: 40px;
      height: 40px;
      background: white;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 1.5rem;
      color: var(--vena-primary);
      box-shadow: var(--shadow-sm);
    }

    .logo-text {
      font-size: 1.75rem;
      font-weight: 700;
      color: white;
      letter-spacing: -0.5px;
    }

    .uptime {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: white;
      font-size: 0.95rem;
    }

    .uptime-dot {
      width: 8px;
      height: 8px;
      background: var(--success);
      border-radius: 50%;
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 2rem;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 1.5rem;
      margin-bottom: 1.5rem;
    }

    .card {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 1.5rem;
      box-shadow: var(--shadow-sm);
      transition: all 0.3s ease;
    }

    .card:hover {
      background: var(--bg-card-hover);
      box-shadow: var(--shadow-md);
      transform: translateY(-2px);
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.25rem;
      padding-bottom: 0.75rem;
      border-bottom: 2px solid var(--vena-primary);
    }

    .card-title {
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--text-primary);
    }

    .card-badge {
      background: var(--vena-primary);
      color: white;
      padding: 0.25rem 0.75rem;
      border-radius: 12px;
      font-size: 0.85rem;
      font-weight: 600;
    }

    .stat-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 1rem;
    }

    .stat-item {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .stat-label {
      font-size: 0.85rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .stat-value {
      font-size: 1.5rem;
      font-weight: 600;
      color: var(--vena-gold);
    }

    .list {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .list-item {
      background: var(--bg-dark);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 1rem;
      transition: all 0.2s ease;
    }

    .list-item:hover {
      border-color: var(--vena-primary);
      transform: translateX(4px);
    }

    .list-item-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.5rem;
    }

    .list-item-title {
      font-weight: 600;
      color: var(--text-primary);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .status-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      display: inline-block;
    }

    .status-dot.active {
      background: var(--success);
      box-shadow: 0 0 8px var(--success);
    }

    .status-dot.inactive {
      background: var(--text-muted);
    }

    .list-item-meta {
      font-size: 0.9rem;
      color: var(--text-muted);
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
    }

    .meta-item {
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }

    .activity-item {
      background: var(--bg-dark);
      border-left: 3px solid var(--vena-primary);
      border-radius: 4px;
      padding: 0.75rem 1rem;
      transition: all 0.2s ease;
    }

    .activity-item:hover {
      background: var(--bg-card);
      border-left-color: var(--vena-gold);
    }

    .activity-time {
      font-size: 0.85rem;
      color: var(--text-muted);
      margin-bottom: 0.25rem;
    }

    .activity-content {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .activity-type {
      font-weight: 600;
      color: var(--vena-gold);
      font-size: 0.85rem;
    }

    .activity-summary {
      color: var(--text-primary);
      font-size: 0.95rem;
    }

    .empty-state {
      text-align: center;
      padding: 2rem;
      color: var(--text-muted);
      font-style: italic;
    }

    .progress-bar {
      width: 100%;
      height: 6px;
      background: var(--bg-dark);
      border-radius: 3px;
      overflow: hidden;
      margin-top: 0.5rem;
    }

    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--vena-primary), var(--vena-gold));
      transition: width 0.3s ease;
      border-radius: 3px;
    }

    .refresh-indicator {
      position: fixed;
      bottom: 2rem;
      right: 2rem;
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      padding: 0.75rem 1rem;
      border-radius: 8px;
      box-shadow: var(--shadow-lg);
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.9rem;
      color: var(--text-muted);
      opacity: 0;
      transition: opacity 0.3s ease;
    }

    .refresh-indicator.visible {
      opacity: 1;
    }

    .spinner {
      width: 16px;
      height: 16px;
      border: 2px solid var(--border-color);
      border-top-color: var(--vena-primary);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    @media (max-width: 768px) {
      .header-content {
        justify-content: center;
      }

      .container {
        padding: 1rem;
      }

      .grid {
        grid-template-columns: 1fr;
      }

      .stat-grid {
        grid-template-columns: 1fr;
      }

      .refresh-indicator {
        bottom: 1rem;
        right: 1rem;
      }
    }

    .fade-in {
      animation: fadeIn 0.4s ease;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-content">
      <div class="logo">
        <div class="logo-icon">V</div>
        <div class="logo-text">Vena Dashboard</div>
      </div>
      <div class="uptime">
        <div class="uptime-dot"></div>
        <span id="uptime-text">Uptime: --</span>
      </div>
    </div>
  </div>

  <div class="container">
    <!-- System Status -->
    <div class="grid">
      <div class="card fade-in">
        <div class="card-header">
          <div class="card-title">System Status</div>
          <div class="card-badge" id="version-badge">v0.1.0</div>
        </div>
        <div class="stat-grid">
          <div class="stat-item">
            <div class="stat-label">Uptime</div>
            <div class="stat-value" id="uptime-value">--</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Version</div>
            <div class="stat-value" id="version-value">--</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Memory Used</div>
            <div class="stat-value" id="memory-used">-- MB</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Memory Total</div>
            <div class="stat-value" id="memory-total">-- MB</div>
          </div>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" id="memory-progress" style="width: 0%"></div>
        </div>
      </div>
    </div>

    <!-- Agents -->
    <div class="card fade-in" style="animation-delay: 0.1s;">
      <div class="card-header">
        <div class="card-title">Agents</div>
        <div class="card-badge" id="agent-count">0</div>
      </div>
      <div class="list" id="agents-list">
        <div class="empty-state">No agents configured</div>
      </div>
    </div>

    <!-- Cron Jobs -->
    <div class="card fade-in" style="animation-delay: 0.2s;">
      <div class="card-header">
        <div class="card-title">Cron Jobs</div>
        <div class="card-badge" id="cron-count">0</div>
      </div>
      <div class="list" id="cron-list">
        <div class="empty-state">No scheduled jobs</div>
      </div>
    </div>

    <!-- Usage -->
    <div class="card fade-in" style="animation-delay: 0.25s;">
      <div class="card-header">
        <div class="card-title">Usage & Cost</div>
        <div class="card-badge" id="usage-badge">--</div>
      </div>
      <div class="stat-grid">
        <div class="stat-item">
          <div class="stat-label">Input Tokens</div>
          <div class="stat-value" id="usage-input">--</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Output Tokens</div>
          <div class="stat-value" id="usage-output">--</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Est. Cost</div>
          <div class="stat-value" id="usage-cost">--</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Requests</div>
          <div class="stat-value" id="usage-requests">--</div>
        </div>
      </div>
    </div>

    <!-- Recent Activity -->
    <div class="card fade-in" style="animation-delay: 0.3s;">
      <div class="card-header">
        <div class="card-title">Recent Activity</div>
      </div>
      <div class="list" id="activity-list">
        <div class="empty-state">No recent activity</div>
      </div>
    </div>
  </div>

  <div class="refresh-indicator" id="refresh-indicator">
    <div class="spinner"></div>
    <span>Refreshing...</span>
  </div>

  <script>
    let lastUpdateTime = 0;
    const REFRESH_INTERVAL = 5000;

    function formatUptime(seconds) {
      if (seconds < 60) return \`\${seconds}s\`;
      if (seconds < 3600) return \`\${Math.floor(seconds / 60)}m \${seconds % 60}s\`;
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      return \`\${hours}h \${minutes}m\`;
    }

    function formatBytes(bytes) {
      return (bytes / (1024 * 1024)).toFixed(1);
    }

    function formatTokens(tokens) {
      if (tokens >= 1000000) return (tokens / 1000000).toFixed(1) + 'M';
      if (tokens >= 1000) return (tokens / 1000).toFixed(1) + 'K';
      return String(tokens);
    }

    function formatTimestamp(timestamp) {
      const date = new Date(timestamp);
      const now = new Date();
      const diff = Math.floor((now - date) / 1000);

      if (diff < 60) return 'just now';
      if (diff < 3600) return \`\${Math.floor(diff / 60)}m ago\`;
      if (diff < 86400) return \`\${Math.floor(diff / 3600)}h ago\`;

      return date.toLocaleString();
    }

    function updateAgents(agents) {
      const list = document.getElementById('agents-list');
      const count = document.getElementById('agent-count');

      count.textContent = agents.length;

      if (agents.length === 0) {
        list.innerHTML = '<div class="empty-state">No agents configured</div>';
        return;
      }

      list.innerHTML = agents.map(agent => \`
        <div class="list-item">
          <div class="list-item-header">
            <div class="list-item-title">
              <span class="status-dot \${agent.status === 'active' ? 'active' : 'inactive'}"></span>
              \${agent.name}
            </div>
          </div>
          <div class="list-item-meta">
            <div class="meta-item">
              <span>ID:</span> <strong>\${agent.id}</strong>
            </div>
            <div class="meta-item">
              <span>Provider:</span> <strong>\${agent.provider}</strong>
            </div>
            <div class="meta-item">
              <span>Model:</span> <strong>\${agent.model}</strong>
            </div>
          </div>
        </div>
      \`).join('');
    }

    function updateCronJobs(jobs) {
      const list = document.getElementById('cron-list');
      const count = document.getElementById('cron-count');

      count.textContent = jobs.length;

      if (jobs.length === 0) {
        list.innerHTML = '<div class="empty-state">No scheduled jobs</div>';
        return;
      }

      list.innerHTML = jobs.map(job => \`
        <div class="list-item">
          <div class="list-item-header">
            <div class="list-item-title">
              <span class="status-dot \${job.enabled ? 'active' : 'inactive'}"></span>
              \${job.name}
            </div>
          </div>
          <div class="list-item-meta">
            <div class="meta-item">
              <span>Schedule:</span> <strong>\${job.schedule}</strong>
            </div>
            \${job.nextRun ? \`
              <div class="meta-item">
                <span>Next:</span> <strong>\${job.nextRun}</strong>
              </div>
            \` : ''}
          </div>
        </div>
      \`).join('');
    }

    function updateActivity(activities) {
      const list = document.getElementById('activity-list');

      if (activities.length === 0) {
        list.innerHTML = '<div class="empty-state">No recent activity</div>';
        return;
      }

      list.innerHTML = activities.slice(0, 10).map(activity => \`
        <div class="activity-item">
          <div class="activity-time">\${formatTimestamp(activity.timestamp)}</div>
          <div class="activity-content">
            <span class="activity-type">[\${activity.type}]</span>
            <span class="activity-summary">\${activity.summary}</span>
          </div>
        </div>
      \`).join('');
    }

    async function fetchStatus() {
      const indicator = document.getElementById('refresh-indicator');

      try {
        indicator.classList.add('visible');

        const response = await fetch('/dashboard/api/status');
        if (!response.ok) throw new Error('Failed to fetch status');

        const data = await response.json();

        // Update uptime
        const uptimeText = formatUptime(data.uptime);
        document.getElementById('uptime-text').textContent = \`Uptime: \${uptimeText}\`;
        document.getElementById('uptime-value').textContent = uptimeText;

        // Update version
        document.getElementById('version-badge').textContent = \`v\${data.version}\`;
        document.getElementById('version-value').textContent = data.version;

        // Update memory
        const memUsed = formatBytes(data.memory.heapUsed);
        const memTotal = formatBytes(data.memory.heapTotal);
        const memPercent = (data.memory.heapUsed / data.memory.heapTotal) * 100;

        document.getElementById('memory-used').textContent = \`\${memUsed} MB\`;
        document.getElementById('memory-total').textContent = \`\${memTotal} MB\`;
        document.getElementById('memory-progress').style.width = \`\${memPercent}%\`;

        // Update agents
        updateAgents(data.agents);

        // Update cron jobs
        updateCronJobs(data.cronJobs);

        // Update activity
        updateActivity(data.recentActivity);

        // Update usage
        if (data.usage) {
          document.getElementById('usage-input').textContent = formatTokens(data.usage.totalInputTokens);
          document.getElementById('usage-output').textContent = formatTokens(data.usage.totalOutputTokens);
          document.getElementById('usage-cost').textContent = '$' + data.usage.totalEstimatedCost.toFixed(4);
          document.getElementById('usage-requests').textContent = String(data.usage.recordCount);
          document.getElementById('usage-badge').textContent = '$' + data.usage.totalEstimatedCost.toFixed(2);
        }

        lastUpdateTime = Date.now();
      } catch (err) {
        console.error('Failed to fetch status:', err);
      } finally {
        setTimeout(() => {
          indicator.classList.remove('visible');
        }, 500);
      }
    }

    // Initial fetch
    fetchStatus();

    // Refresh every 5 seconds
    setInterval(fetchStatus, REFRESH_INTERVAL);

    // Update "time ago" labels every second
    setInterval(() => {
      const activities = document.querySelectorAll('.activity-time');
      activities.forEach(el => {
        const timestamp = el.dataset.timestamp;
        if (timestamp) {
          el.textContent = formatTimestamp(parseInt(timestamp));
        }
      });
    }, 1000);
  </script>
</body>
</html>`;
}
