/**
 * 工单系统
 */
class TicketService {
  constructor(db) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_no TEXT UNIQUE NOT NULL,
        user_id INTEGER REFERENCES users(id),
        order_id INTEGER,
        category TEXT DEFAULT 'GENERAL',
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        images TEXT DEFAULT '[]',
        priority INTEGER DEFAULT 0,
        status TEXT DEFAULT 'OPEN' CHECK(status IN ('OPEN','PROCESSING','REPLIED','RESOLVED','CLOSED')),
        assigned_to INTEGER,
        reply_content TEXT DEFAULT '',
        resolved_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS ticket_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER REFERENCES tickets(id),
        sender_type TEXT NOT NULL,
        sender_id INTEGER,
        content TEXT NOT NULL,
        images TEXT DEFAULT '[]',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  genNo() { return 'TK' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2,5).toUpperCase(); }

  create(userId, data) {
    const no = this.genNo();
    this.db.prepare('INSERT INTO tickets (ticket_no, user_id, order_id, category, title, content, images, priority) VALUES (?,?,?,?,?,?,?,?)').run(
      no, userId, data.order_id || null, data.category || 'GENERAL', data.title, data.content, JSON.stringify(data.images || []), data.priority || 0
    );
    const ticket = this.db.prepare('SELECT * FROM tickets WHERE ticket_no = ?').get(no);
    this.db.prepare('INSERT INTO ticket_messages (ticket_id, sender_type, sender_id, content) VALUES (?, ?, ?, ?)').run(ticket.id, 'USER', userId, data.content);
    return ticket;
  }

  get(id) {
    const ticket = this.db.prepare('SELECT t.*, u.nickname as user_name, u.phone as user_phone, a.nickname as assigned_name FROM tickets t LEFT JOIN users u ON t.user_id = u.id LEFT JOIN admins a ON t.assigned_to = a.id WHERE t.id = ?').get(id);
    if (!ticket) return null;
    const messages = this.db.prepare('SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at').all(id);
    return { ...ticket, messages };
  }

  list(filters = {}) {
    let sql = 'SELECT t.*, u.nickname as user_name, u.phone as user_phone FROM tickets t LEFT JOIN users u ON t.user_id = u.id WHERE 1=1';
    const params = [];
    if (filters.status) { sql += ' AND t.status = ?'; params.push(filters.status); }
    if (filters.category) { sql += ' AND t.category = ?'; params.push(filters.category); }
    if (filters.user_id) { sql += ' AND t.user_id = ?'; params.push(filters.user_id); }
    sql += ' ORDER BY t.priority DESC, t.created_at DESC';
    if (filters.limit) { sql += ' LIMIT ?'; params.push(filters.limit); }
    return this.db.prepare(sql).all(...params);
  }

  reply(ticketId, senderType, senderId, content) {
    this.db.prepare('INSERT INTO ticket_messages (ticket_id, sender_type, sender_id, content) VALUES (?,?,?,?)').run(ticketId, senderType, senderId, content);
    if (senderType === 'CS' || senderType === 'ADMIN') {
      this.db.prepare("UPDATE tickets SET status = 'REPLIED', reply_content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(content, ticketId);
    }
  }

  updateStatus(id, status, adminId) {
    const updates = ['status = ?', 'updated_at = CURRENT_TIMESTAMP'];
    const params = [status];
    if (status === 'RESOLVED' || status === 'CLOSED') { updates.push('resolved_at = CURRENT_TIMESTAMP'); }
    if (adminId) { updates.push('assigned_to = ?'); params.push(adminId); }
    params.push(id);
    this.db.prepare(`UPDATE tickets SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }

  getStats() {
    return {
      total: this.db.prepare('SELECT COUNT(*) as c FROM tickets').get().c,
      open: this.db.prepare("SELECT COUNT(*) as c FROM tickets WHERE status = 'OPEN'").get().c,
      processing: this.db.prepare("SELECT COUNT(*) as c FROM tickets WHERE status IN ('OPEN','PROCESSING','REPLIED')").get().c,
      resolved: this.db.prepare("SELECT COUNT(*) as c FROM tickets WHERE status IN ('RESOLVED','CLOSED')").get().c,
      todayNew: this.db.prepare("SELECT COUNT(*) as c FROM tickets WHERE DATE(created_at) = DATE('now')").get().c,
    };
  }
}

module.exports = TicketService;
