/**
 * 优惠券系统
 */
class CouponService {
  constructor(db) {
    this.db = db;
    // 确保表存在
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS coupons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        type TEXT DEFAULT 'FIXED' CHECK(type IN ('FIXED','PERCENT','FREE')),
        value REAL NOT NULL,
        min_amount REAL DEFAULT 0,
        max_discount REAL DEFAULT 0,
        total_count INTEGER DEFAULT 100,
        used_count INTEGER DEFAULT 0,
        per_user_limit INTEGER DEFAULT 1,
        start_time DATETIME,
        end_time DATETIME,
        status INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS user_coupons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id),
        coupon_id INTEGER REFERENCES coupons(id),
        order_id INTEGER,
        status INTEGER DEFAULT 0 CHECK(status IN (0,1,2)),
        used_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  create(data) {
    const code = data.code || this.generateCode();
    this.db.prepare(`INSERT INTO coupons (code,name,type,value,min_amount,max_discount,total_count,per_user_limit,start_time,end_time)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(code, data.name, data.type, data.value, data.min_amount||0, data.max_discount||0, data.total_count||100, data.per_user_limit||1, data.start_time, data.end_time);
    return code;
  }

  list(status) {
    let sql = 'SELECT * FROM coupons';
    const params = [];
    if (status !== undefined) { sql += ' WHERE status = ?'; params.push(status); }
    sql += ' ORDER BY created_at DESC';
    return this.db.prepare(sql).all(...params);
  }

  claim(userId, couponId) {
    const coupon = this.db.prepare('SELECT * FROM coupons WHERE id = ? AND status = 1').get(couponId);
    if (!coupon) return { ok: false, msg: '优惠券不存在或已停用' };
    if (coupon.used_count >= coupon.total_count) return { ok: false, msg: '已领完' };
    if (coupon.end_time && new Date(coupon.end_time) < new Date()) return { ok: false, msg: '已过期' };
    const claimed = this.db.prepare('SELECT COUNT(*) as c FROM user_coupons WHERE user_id = ? AND coupon_id = ?').get(userId, couponId).c;
    if (claimed >= coupon.per_user_limit) return { ok: false, msg: '已达领取上限' };
    this.db.prepare('INSERT INTO user_coupons (user_id, coupon_id) VALUES (?,?)').run(userId, couponId);
    this.db.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?').run(couponId);
    return { ok: true, msg: '领取成功' };
  }

  getUserCoupons(userId) {
    return this.db.prepare(`
      SELECT uc.*, c.name, c.type, c.value, c.min_amount, c.max_discount, c.end_time
      FROM user_coupons uc JOIN coupons c ON uc.coupon_id = c.id
      WHERE uc.user_id = ? ORDER BY uc.created_at DESC
    `).all(userId);
  }

  calculate(couponId, orderAmount) {
    const coupon = this.db.prepare('SELECT * FROM coupons WHERE id = ?').get(couponId);
    if (!coupon || coupon.status !== 1) return 0;
    if (orderAmount < coupon.min_amount) return 0;
    let discount = 0;
    if (coupon.type === 'FIXED') discount = coupon.value;
    else if (coupon.type === 'PERCENT') discount = orderAmount * (1 - coupon.value / 100);
    else if (coupon.type === 'FREE') discount = orderAmount;
    if (coupon.max_discount > 0) discount = Math.min(discount, coupon.max_discount);
    return Math.round(discount * 100) / 100;
  }

  use(userId, couponId, orderId) {
    this.db.prepare('UPDATE user_coupons SET status = 1, used_at = CURRENT_TIMESTAMP, order_id = ? WHERE user_id = ? AND coupon_id = ? AND status = 0').run(orderId, userId, couponId);
  }

  update(id, data) {
    const fields = ['name','type','value','min_amount','max_discount','total_count','per_user_limit','start_time','end_time','status'];
    const updates = []; const params = [];
    fields.forEach(f => { if (data[f] !== undefined) { updates.push(`${f} = ?`); params.push(data[f]); } });
    if (!updates.length) return;
    params.push(id);
    this.db.prepare(`UPDATE coupons SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }

  delete(id) {
    this.db.prepare('DELETE FROM coupons WHERE id = ?').run(id);
  }
}

module.exports = CouponService;
