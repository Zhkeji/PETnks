/**
 * 工作流自动化引擎
 */
class WorkflowEngine {
  constructor(db) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        trigger_event TEXT NOT NULL,
        conditions TEXT DEFAULT '{}',
        actions TEXT NOT NULL DEFAULT '[]',
        status INTEGER DEFAULT 1,
        last_run_at DATETIME,
        run_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS workflow_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workflow_id INTEGER,
        trigger_data TEXT DEFAULT '',
        result TEXT DEFAULT '',
        success INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 初始化默认工作流
    this._initDefaults();
  }

  _initDefaults() {
    const count = this.db.prepare('SELECT COUNT(*) as c FROM workflows').get().c;
    if (count > 0) return;
    const defaults = [
      { name: '订单超时自动取消', trigger: 'ORDER_CREATED', conditions: '{"delay_minutes":30,"status":"PENDING"}', actions: '[{"type":"CANCEL_ORDER","params":{}}]' },
      { name: '完成订单自动提醒评价', trigger: 'ORDER_COMPLETED', conditions: '{"delay_minutes":5}', actions: '[{"type":"NOTIFY_USER","params":{"title":"订单已完成","content":"请对服务进行评价","type":"ORDER"}}]' },
      { name: '新订单通知接单员', trigger: 'ORDER_PAID', conditions: '{"assign_mode":"GRAB"}', actions: '[{"type":"NOTIFY_ALL_PLAYERS","params":{"title":"新订单","content":"有新的抢单来了！","type":"ORDER"}}]' },
      { name: '退款申请通知管理员', trigger: 'REFUND_REQUESTED', conditions: '{}', actions: '[{"type":"NOTIFY_ADMIN","params":{"title":"退款申请","content":"有新的退款申请待处理","type":"ORDER"}}]' },
      { name: '接单员审核通知', trigger: 'PLAYER_APPLIED', conditions: '{}', actions: '[{"type":"NOTIFY_ADMIN","params":{"title":"接单员申请","content":"有新的接单员申请待审核","type":"SYSTEM"}}]' },
    ];
    const stmt = this.db.prepare('INSERT INTO workflows (name, trigger_event, conditions, actions) VALUES (?,?,?,?)');
    defaults.forEach(w => stmt.run(w.name, w.trigger, w.conditions, w.actions));
  }

  /**
   * 触发工作流
   */
  async execute(event, data) {
    const workflows = this.db.prepare("SELECT * FROM workflows WHERE trigger_event = ? AND status = 1").all(event);
    for (const wf of workflows) {
      try {
        const conditions = JSON.parse(wf.conditions || '{}');
        const actions = JSON.parse(wf.actions || '[]');

        // 检查条件
        if (conditions.delay_minutes) {
          // 延迟执行（简化处理：记录待执行）
          this._scheduleDelayed(wf, data, conditions.delay_minutes);
          continue;
        }
        if (conditions.status && data.status !== conditions.status) continue;
        if (conditions.assign_mode && data.assign_mode !== conditions.assign_mode) continue;

        // 执行动作
        for (const action of actions) {
          await this._executeAction(action, data);
        }

        this.db.prepare('UPDATE workflows SET last_run_at = CURRENT_TIMESTAMP, run_count = run_count + 1 WHERE id = ?').run(wf.id);
        this.db.prepare('INSERT INTO workflow_logs (workflow_id, trigger_data, result, success) VALUES (?,?,?,?)').run(wf.id, JSON.stringify(data), 'OK', 1);
      } catch (err) {
        this.db.prepare('INSERT INTO workflow_logs (workflow_id, trigger_data, result, success) VALUES (?,?,?,?)').run(wf.id, JSON.stringify(data), err.message, 0);
      }
    }
  }

  async _executeAction(action, data) {
    switch (action.type) {
      case 'NOTIFY_USER':
        if (data.user_id) {
          this.db.prepare('INSERT INTO notifications (user_id, title, content, type) VALUES (?,?,?,?)').run(
            data.user_id, action.params.title, action.params.content.replace('{order_no}', data.order_no || ''), action.params.type || 'SYSTEM'
          );
        }
        break;
      case 'NOTIFY_ALL_PLAYERS':
        const players = this.db.prepare("SELECT user_id FROM players WHERE status = 'APPROVED'").all();
        const stmt = this.db.prepare('INSERT INTO notifications (user_id, title, content, type) VALUES (?,?,?,?)');
        players.forEach(p => stmt.run(p.user_id, action.params.title, action.params.content, action.params.type || 'SYSTEM'));
        break;
      case 'NOTIFY_ADMIN':
        const admins = this.db.prepare('SELECT id FROM admins WHERE status = 1').all();
        const aStmt = this.db.prepare('INSERT INTO notifications (user_id, user_type, title, content, type) VALUES (?,?,?,?,?)');
        admins.forEach(a => aStmt.run(a.id, 'ADMIN', action.params.title, action.params.content, action.params.type || 'SYSTEM'));
        break;
      case 'CANCEL_ORDER':
        if (data.order_id && data.status === 'PENDING') {
          this.db.prepare("UPDATE orders SET order_status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND order_status = 'PENDING'").run(data.order_id);
        }
        break;
    }
  }

  _scheduleDelayed(wf, data, minutes) {
    setTimeout(async () => {
      const order = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(data.order_id);
      if (!order) return;
      const actions = JSON.parse(wf.actions || '[]');
      for (const action of actions) {
        await this._executeAction(action, { ...data, ...order });
      }
      this.db.prepare('UPDATE workflows SET last_run_at = CURRENT_TIMESTAMP, run_count = run_count + 1 WHERE id = ?').run(wf.id);
    }, minutes * 60000);
  }

  list() { return this.db.prepare('SELECT * FROM workflows ORDER BY created_at DESC').all(); }
  update(id, data) {
    if (data.status !== undefined) this.db.prepare('UPDATE workflows SET status = ? WHERE id = ?').run(data.status, id);
    if (data.actions) this.db.prepare('UPDATE workflows SET actions = ? WHERE id = ?').run(JSON.stringify(data.actions), id);
    if (data.conditions) this.db.prepare('UPDATE workflows SET conditions = ? WHERE id = ?').run(JSON.stringify(data.conditions), id);
  }
  logs(id, limit = 50) { return this.db.prepare('SELECT * FROM workflow_logs WHERE workflow_id = ? ORDER BY created_at DESC LIMIT ?').all(id, limit); }
}

module.exports = WorkflowEngine;
