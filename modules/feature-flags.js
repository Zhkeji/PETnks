/**
 * Feature Flags 功能开关
 */
class FeatureFlags {
  constructor(db) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS feature_flags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        enabled INTEGER DEFAULT 0,
        rollout_percent INTEGER DEFAULT 100,
        allowed_users TEXT DEFAULT '[]',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    this._initDefaults();
  }

  _initDefaults() {
    const count = this.db.prepare('SELECT COUNT(*) as c FROM feature_flags').get().c;
    if (count > 0) return;
    const flags = [
      ['invite_system', '邀请系统', '用户邀请码和佣金功能', 1],
      ['ai_chat', 'AI客服', '智能客服自动回复', 1],
      ['coupon_system', '优惠券', '优惠券领取和使用', 1],
      ['promotion_system', '活动系统', '限时折扣和满减活动', 1],
      ['ticket_system', '工单系统', '用户提交工单', 1],
      ['leaderboard', '排行榜', '接单员和商品排行', 1],
      ['sms_verify', '短信验证', '真实短信验证码', 0],
      ['wechat_pay', '微信支付', '微信支付集成', 0],
      ['dark_mode', '暗黑模式', '深色主题切换', 1],
      ['i18n', '多语言', '国际化语言切换', 1],
    ];
    const stmt = this.db.prepare('INSERT INTO feature_flags (key, name, description, enabled) VALUES (?,?,?,?)');
    flags.forEach(f => stmt.run(...f));
  }

  isEnabled(key, userId) {
    const flag = this.db.prepare('SELECT * FROM feature_flags WHERE key = ?').get(key);
    if (!flag) return false;
    if (!flag.enabled) return false;
    if (flag.rollout_percent < 100 && userId) {
      const hash = this._hash(userId + key) % 100;
      if (hash >= flag.rollout_percent) return false;
    }
    if (flag.allowed_users && flag.allowed_users !== '[]') {
      const allowed = JSON.parse(flag.allowed_users);
      if (allowed.length > 0 && userId && !allowed.includes(userId)) return false;
    }
    return true;
  }

  _hash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  list() { return this.db.prepare('SELECT * FROM feature_flags ORDER BY created_at').all(); }
  update(key, data) {
    const u = []; const p = [];
    if (data.enabled !== undefined) { u.push('enabled=?'); p.push(data.enabled); }
    if (data.rollout_percent !== undefined) { u.push('rollout_percent=?'); p.push(data.rollout_percent); }
    if (data.allowed_users !== undefined) { u.push('allowed_users=?'); p.push(JSON.stringify(data.allowed_users)); }
    if (!u.length) return;
    u.push('updated_at=CURRENT_TIMESTAMP');
    p.push(key);
    this.db.prepare(`UPDATE feature_flags SET ${u.join(',')} WHERE key=?`).run(...p);
  }
}

module.exports = FeatureFlags;
