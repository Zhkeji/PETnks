/**
 * 数据报表生成
 */
class ReportService {
  constructor(db) {
    this.db = db;
  }

  /**
   * 日报
   */
  daily(date) {
    const d = date || new Date().toISOString().split('T')[0];
    const prev = new Date(new Date(d).getTime() - 86400000).toISOString().split('T')[0];

    const orders = this.db.prepare(`SELECT COUNT(*) as c, COALESCE(SUM(total_amount),0) as s FROM orders WHERE DATE(created_at) = ?`).get(d);
    const paid = this.db.prepare(`SELECT COUNT(*) as c, COALESCE(SUM(total_amount),0) as s FROM orders WHERE pay_status=1 AND DATE(pay_time) = ?`).get(d);
    const completed = this.db.prepare(`SELECT COUNT(*) as c, COALESCE(SUM(total_amount),0) as s FROM orders WHERE order_status IN ('COMPLETED','REVIEWING') AND DATE(complete_time) = ?`).get(d);
    const prevPaid = this.db.prepare(`SELECT COUNT(*) as c, COALESCE(SUM(total_amount),0) as s FROM orders WHERE pay_status=1 AND DATE(pay_time) = ?`).get(prev);
    const newUsers = this.db.prepare(`SELECT COUNT(*) as c FROM users WHERE DATE(created_at) = ?`).get(d).c;
    const newPlayers = this.db.prepare(`SELECT COUNT(*) as c FROM players WHERE DATE(created_at) = ?`).get(d).c;
    const recharges = this.db.prepare(`SELECT COALESCE(SUM(amount),0) as s FROM transactions WHERE type='RECHARGE' AND DATE(created_at) = ?`).get(d).s;
    const withdrawals = this.db.prepare(`SELECT COALESCE(SUM(amount),0) as s FROM withdrawals WHERE status IN ('APPROVED','PAID') AND DATE(processed_at) = ?`).get(d).s;
    const refunds = this.db.prepare(`SELECT COUNT(*) as c, COALESCE(SUM(total_amount),0) as s FROM orders WHERE order_status='REFUNDED' AND DATE(refund_time) = ?`).get(d);

    const revenueGrowth = prevPaid.s > 0 ? ((paid.s - prevPaid.s) / prevPaid.s * 100).toFixed(1) : 'N/A';

    return {
      date: d,
      summary: {
        newOrders: orders.c, newOrderAmount: orders.s,
        paidOrders: paid.c, paidAmount: paid.s,
        completedOrders: completed.c, completedAmount: completed.s,
        revenueGrowth: revenueGrowth + '%',
        newUsers, newPlayers,
        recharges, withdrawals,
        refundCount: refunds.c, refundAmount: refunds.s,
      },
      topProducts: this.db.prepare(`
        SELECT p.title, COUNT(*) as order_count, SUM(o.total_amount) as total
        FROM orders o JOIN products p ON o.product_id = p.id
        WHERE DATE(o.created_at) = ? AND o.pay_status = 1
        GROUP BY o.product_id ORDER BY total DESC LIMIT 5
      `).all(d),
      topPlayers: this.db.prepare(`
        SELECT pl.real_name, COUNT(*) as orders, SUM(o.total_amount) as total
        FROM orders o JOIN players pl ON o.player_id = pl.id
        WHERE DATE(o.complete_time) = ? AND o.order_status IN ('COMPLETED','REVIEWING')
        GROUP BY o.player_id ORDER BY total DESC LIMIT 5
      `).all(d),
    };
  }

  /**
   * 周报
   */
  weekly() {
    const end = new Date().toISOString().split('T')[0];
    const start = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    return this._rangeReport(start, end, '周报');
  }

  /**
   * 月报
   */
  monthly() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const end = now.toISOString().split('T')[0];
    return this._rangeReport(start, end, '月报');
  }

  _rangeReport(start, end, label) {
    const orders = this.db.prepare(`SELECT COUNT(*) as c, COALESCE(SUM(total_amount),0) as s FROM orders WHERE pay_status=1 AND DATE(pay_time) BETWEEN ? AND ?`).get(start, end);
    const completed = this.db.prepare(`SELECT COUNT(*) as c, COALESCE(SUM(total_amount),0) as s FROM orders WHERE order_status IN ('COMPLETED','REVIEWING') AND DATE(complete_time) BETWEEN ? AND ?`).get(start, end);
    const newUsers = this.db.prepare(`SELECT COUNT(*) as c FROM users WHERE DATE(created_at) BETWEEN ? AND ?`).get(start, end).c;
    const newPlayers = this.db.prepare(`SELECT COUNT(*) as c FROM players WHERE DATE(created_at) BETWEEN ? AND ?`).get(start, end).c;
    const recharges = this.db.prepare(`SELECT COALESCE(SUM(amount),0) as s FROM transactions WHERE type='RECHARGE' AND DATE(created_at) BETWEEN ? AND ?`).get(start, end).s;
    const commission = this.db.prepare(`SELECT COALESCE(SUM(amount),0) as s FROM transactions WHERE type='COMMISSION' AND DATE(created_at) BETWEEN ? AND ?`).get(start, end).s;

    const dailyTrend = this.db.prepare(`
      SELECT DATE(pay_time) as date, COUNT(*) as orders, SUM(total_amount) as revenue
      FROM orders WHERE pay_status=1 AND DATE(pay_time) BETWEEN ? AND ?
      GROUP BY DATE(pay_time) ORDER BY date
    `).all(start, end);

    return {
      label, start, end,
      summary: { paidOrders: orders.c, paidAmount: orders.s, completedOrders: completed.c, completedAmount: completed.s, newUsers, newPlayers, recharges, commission },
      dailyTrend,
    };
  }
}

module.exports = ReportService;
