/**
 * 漏斗分析模块
 */
class FunnelAnalytics {
  constructor(db) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS funnel_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        session_id TEXT DEFAULT '',
        event TEXT NOT NULL,
        page TEXT DEFAULT '',
        referrer TEXT DEFAULT '',
        device TEXT DEFAULT '',
        ip TEXT DEFAULT '',
        extra TEXT DEFAULT '{}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_funnel_event ON funnel_events(event, created_at);
      CREATE INDEX IF NOT EXISTS idx_funnel_user ON funnel_events(user_id, created_at);
    `);
  }

  track(userId, event, data = {}) {
    this.db.prepare('INSERT INTO funnel_events (user_id, session_id, event, page, referrer, device, ip, extra) VALUES (?,?,?,?,?,?,?,?)').run(
      userId || null, data.session_id || '', event, data.page || '', data.referrer || '', data.device || '', data.ip || '', JSON.stringify(data.extra || {})
    );
  }

  /**
   * 漏斗分析
   */
  analyze(steps, startDate, endDate) {
    let dateFilter = '';
    const params = [];
    if (startDate) { dateFilter += ' AND created_at >= ?'; params.push(startDate); }
    if (endDate) { dateFilter += ' AND created_at <= ?'; params.push(endDate + ' 23:59:59'); }

    const results = steps.map(step => {
      const count = this.db.prepare(`SELECT COUNT(DISTINCT user_id) as c FROM funnel_events WHERE event = ?${dateFilter}`).get(step, ...params).c;
      return { step, count };
    });

    // 计算转化率
    for (let i = 1; i < results.length; i++) {
      results[i].conversionRate = results[0].count > 0 ? ((results[i].count / results[0].count) * 100).toFixed(1) + '%' : '0%';
      results[i].stepRate = results[i - 1].count > 0 ? ((results[i].count / results[i - 1].count) * 100).toFixed(1) + '%' : '0%';
    }

    return results;
  }

  /**
   * 热门页面
   */
  topPages(limit = 10, days = 7) {
    return this.db.prepare(`
      SELECT page, COUNT(*) as views, COUNT(DISTINCT user_id) as unique_users
      FROM funnel_events WHERE page != '' AND created_at >= datetime('now', '-${days} days')
      GROUP BY page ORDER BY views DESC LIMIT ?
    `).all(limit);
  }

  /**
   * 设备分布
   */
  deviceStats(days = 7) {
    return this.db.prepare(`
      SELECT device, COUNT(*) as count FROM funnel_events
      WHERE device != '' AND created_at >= datetime('now', '-${days} days')
      GROUP BY device ORDER BY count DESC
    `).all();
  }

  /**
   * 用户来源
   */
  referrerStats(limit = 10, days = 7) {
    return this.db.prepare(`
      SELECT referrer, COUNT(*) as count FROM funnel_events
      WHERE referrer != '' AND created_at >= datetime('now', '-${days} days')
      GROUP BY referrer ORDER BY count DESC LIMIT ?
    `).all(limit);
  }
}

module.exports = FunnelAnalytics;
