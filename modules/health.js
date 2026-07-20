/**
 * 健康检查与监控模块
 */

const os = require('os');
const fs = require('fs');
const path = require('path');

class HealthCheck {
  constructor(db) {
    this.db = db;
    this.startTime = Date.now();
    this.requestCount = 0;
    this.errorCount = 0;
    this.responseTimes = [];
  }

  /**
   * 记录请求
   */
  recordRequest(duration, isError = false) {
    this.requestCount++;
    if (isError) this.errorCount++;
    this.responseTimes.push(duration);
    // 只保留最近1000条
    if (this.responseTimes.length > 1000) this.responseTimes.shift();
  }

  /**
   * 健康检查
   */
  check() {
    const uptime = Date.now() - this.startTime;
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    // 数据库检查
    let dbStatus = 'ok';
    let dbLatency = 0;
    try {
      const start = Date.now();
      this.db.prepare('SELECT 1').get();
      dbLatency = Date.now() - start;
    } catch (e) {
      dbStatus = 'error: ' + e.message;
    }

    // 响应时间统计
    const avgResponseTime = this.responseTimes.length > 0
      ? Math.round(this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length)
      : 0;

    const p95Index = Math.floor(this.responseTimes.length * 0.95);
    const sorted = [...this.responseTimes].sort((a, b) => a - b);
    const p95ResponseTime = sorted[p95Index] || 0;

    return {
      status: dbStatus === 'ok' ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: {
        ms: uptime,
        human: this._formatUptime(uptime)
      },
      system: {
        platform: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version,
        cpus: os.cpus().length,
        totalMemory: (os.totalmem() / 1024 / 1024 / 1024).toFixed(2) + ' GB',
        freeMemory: (os.freemem() / 1024 / 1024 / 1024).toFixed(2) + ' GB',
        loadAvg: os.loadavg()
      },
      process: {
        pid: process.pid,
        memory: {
          rss: (memUsage.rss / 1024 / 1024).toFixed(2) + ' MB',
          heapUsed: (memUsage.heapUsed / 1024 / 1024).toFixed(2) + ' MB',
          heapTotal: (memUsage.heapTotal / 1024 / 1024).toFixed(2) + ' MB'
        }
      },
      database: {
        status: dbStatus,
        latency: dbLatency + 'ms'
      },
      requests: {
        total: this.requestCount,
        errors: this.errorCount,
        errorRate: this.requestCount > 0 ? ((this.errorCount / this.requestCount) * 100).toFixed(2) + '%' : '0%',
        avgResponseTime: avgResponseTime + 'ms',
        p95ResponseTime: p95ResponseTime + 'ms'
      }
    };
  }

  /**
   * 简单存活检查
   */
  alive() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  /**
   * 格式化运行时间
   */
  _formatUptime(ms) {
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${d}d ${h}h ${m}m ${sec}s`;
  }
}

module.exports = HealthCheck;
