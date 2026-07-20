/**
 * 通知中心模块
 */
class NotificationService {
  constructor(db) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        user_type TEXT DEFAULT 'USER' CHECK(user_type IN ('USER','PLAYER','ADMIN')),
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        type TEXT DEFAULT 'SYSTEM' CHECK(type IN ('SYSTEM','ORDER','PROMOTION','TICKET','WITHDRAW','COUPON')),
        ref_type TEXT DEFAULT '',
        ref_id INTEGER,
        is_read INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read, created_at DESC);
    `);
  }

  /**
   * 发送通知
   */
  send(userId, data) {
    this.db.prepare(`INSERT INTO notifications (user_id, user_type, title, content, type, ref_type, ref_id) VALUES (?,?,?,?,?,?,?)`).run(
      userId, data.user_type || 'USER', data.title, data.content, data.type || 'SYSTEM', data.ref_type || '', data.ref_id || null
    );
  }

  /**
   * 批量发送（如全体公告）
   */
  broadcast(userType, data) {
    const users = this.db.prepare('SELECT id FROM users').all();
    const stmt = this.db.prepare(`INSERT INTO notifications (user_id, user_type, title, content, type) VALUES (?,?,?,?,?)`);
    const insertMany = this.db.transaction(() => {
      users.forEach(u => stmt.run(u.id, userType || 'USER', data.title, data.content, data.type || 'SYSTEM'));
    });
    insertMany();
  }

  /**
   * 获取用户通知
   */
  list(userId, opts = {}) {
    let sql = 'SELECT * FROM notifications WHERE user_id = ?';
    const params = [userId];
    if (opts.unreadOnly) sql += ' AND is_read = 0';
    if (opts.type) { sql += ' AND type = ?'; params.push(opts.type); }
    sql += ' ORDER BY created_at DESC';
    if (opts.limit) { sql += ' LIMIT ?'; params.push(opts.limit); }
    return this.db.prepare(sql).all(...params);
  }

  /**
   * 标记已读
   */
  markRead(userId, ids) {
    if (!ids || !ids.length) {
      this.db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').run(userId);
    } else {
      const placeholders = ids.map(() => '?').join(',');
      this.db.prepare(`UPDATE notifications SET is_read = 1 WHERE user_id = ? AND id IN (${placeholders})`).run(userId, ...ids);
    }
  }

  /**
   * 未读数
   */
  unreadCount(userId) {
    return this.db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0').get(userId).c;
  }

  /**
   * 删除通知
   */
  delete(userId, id) {
    this.db.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?').run(id, userId);
  }

  /**
   * 清空已读
   */
  clearRead(userId) {
    this.db.prepare('DELETE FROM notifications WHERE user_id = ? AND is_read = 1').run(userId);
  }
}

module.exports = NotificationService;
