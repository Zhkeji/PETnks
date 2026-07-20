/**
 * Webhook 集成模块
 * 支持: 飞书/钉钉/企业微信/自定义HTTP
 */
class WebhookService {
  constructor(db) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS webhooks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT DEFAULT 'CUSTOM' CHECK(type IN ('FEISHU','DINGTALK','WECOM','CUSTOM')),
        url TEXT NOT NULL,
        secret TEXT DEFAULT '',
        events TEXT DEFAULT '[]',
        status INTEGER DEFAULT 1,
        last_triggered_at DATETIME,
        fail_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS webhook_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        webhook_id INTEGER REFERENCES webhooks(id),
        event TEXT NOT NULL,
        payload TEXT DEFAULT '',
        response_code INTEGER,
        response_body TEXT DEFAULT '',
        success INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  /**
   * 注册 Webhook
   */
  register(data) {
    this.db.prepare('INSERT INTO webhooks (name, type, url, secret, events) VALUES (?,?,?,?,?)').run(
      data.name, data.type || 'CUSTOM', data.url, data.secret || '', JSON.stringify(data.events || [])
    );
  }

  /**
   * 触发事件
   */
  async trigger(event, payload) {
    const hooks = this.db.prepare("SELECT * FROM webhooks WHERE status = 1").all();
    const matching = hooks.filter(h => {
      const events = JSON.parse(h.events || '[]');
      return events.length === 0 || events.includes(event) || events.includes('*');
    });

    for (const hook of matching) {
      try {
        const body = this._formatPayload(hook, event, payload);
        const resp = await fetch(hook.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10000)
        });
        const respText = await resp.text().catch(() => '');
        this.db.prepare('INSERT INTO webhook_logs (webhook_id, event, payload, response_code, response_body, success) VALUES (?,?,?,?,?,?)').run(
          hook.id, event, JSON.stringify(payload), resp.status, respText.slice(0, 1000), resp.ok ? 1 : 0
        );
        this.db.prepare('UPDATE webhooks SET last_triggered_at = CURRENT_TIMESTAMP, fail_count = 0 WHERE id = ?').run(hook.id);
      } catch (err) {
        this.db.prepare('INSERT INTO webhook_logs (webhook_id, event, payload, response_code, response_body, success) VALUES (?,?,?,?,?,?)').run(
          hook.id, event, JSON.stringify(payload), 0, err.message, 0
        );
        this.db.prepare('UPDATE webhooks SET fail_count = fail_count + 1 WHERE id = ?').run(hook.id);
      }
    }
  }

  /**
   * 格式化消息体
   */
  _formatPayload(hook, event, data) {
    const timestamp = new Date().toISOString();
    if (hook.type === 'FEISHU') {
      return { msg_type: 'interactive', card: { header: { title: { tag: 'plain_text', content: `[${event}] 三角洲护航` } }, elements: [{ tag: 'div', text: { tag: 'plain_text', content: data.message || JSON.stringify(data) } }] } };
    }
    if (hook.type === 'DINGTALK') {
      return { msgtype: 'text', text: { content: `[${event}] ${data.message || JSON.stringify(data)}` } };
    }
    if (hook.type === 'WECOM') {
      return { msgtype: 'text', text: { content: `[${event}] ${data.message || JSON.stringify(data)}` } };
    }
    return { event, data, timestamp };
  }

  list() { return this.db.prepare('SELECT * FROM webhooks ORDER BY created_at DESC').all(); }
  delete(id) { this.db.prepare('DELETE FROM webhooks WHERE id = ?').run(id); }
  update(id, data) {
    const fields = ['name','type','url','secret','events','status'];
    const u = []; const p = [];
    fields.forEach(f => { if (data[f] !== undefined) { u.push(`${f}=?`); p.push(data[f]); } });
    if (!u.length) return;
    p.push(id);
    this.db.prepare(`UPDATE webhooks SET ${u.join(',')} WHERE id=?`).run(...p);
  }
  logs(id, limit = 50) { return this.db.prepare('SELECT * FROM webhook_logs WHERE webhook_id = ? ORDER BY created_at DESC LIMIT ?').all(id, limit); }
}

module.exports = WebhookService;
