/**
 * 分销/邀请系统
 */

class InviteService {
  constructor(db) {
    this.db = db;
  }

  /**
   * 生成唯一邀请码
   */
  generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    // 检查是否已存在
    const existing = this.db.prepare('SELECT id FROM users WHERE invite_code = ?').get(code);
    if (existing) return this.generateCode();
    return code;
  }

  /**
   * 为用户生成邀请码
   */
  initUser(userId) {
    const user = this.db.prepare('SELECT invite_code FROM users WHERE id = ?').get(userId);
    if (user && !user.invite_code) {
      const code = this.generateCode();
      this.db.prepare('UPDATE users SET invite_code = ? WHERE id = ?').run(code, userId);
      return code;
    }
    return user?.invite_code;
  }

  /**
   * 处理邀请注册
   */
  processInvite(inviteeId, inviteCode) {
    if (!inviteCode) return { success: false, msg: '无邀请码' };

    const inviter = this.db.prepare('SELECT id FROM users WHERE invite_code = ?').get(inviteCode);
    if (!inviter) return { success: false, msg: '邀请码无效' };
    if (inviter.id === inviteeId) return { success: false, msg: '不能邀请自己' };

    // 检查是否已被邀请
    const existing = this.db.prepare('SELECT id FROM invite_records WHERE invitee_id = ?').get(inviteeId);
    if (existing) return { success: false, msg: '已被邀请' };

    // 记录邀请关系
    this.db.prepare('UPDATE users SET invited_by = ? WHERE id = ?').run(inviter.id, inviteeId);
    this.db.prepare('INSERT INTO invite_records (inviter_id, invitee_id, invite_code) VALUES (?, ?, ?)').run(
      inviter.id, inviteeId, inviteCode
    );

    return { success: true, inviterId: inviter.id };
  }

  /**
   * 计算邀请佣金（被邀请人下单时调用）
   */
  calculateCommission(orderAmount, inviteeId) {
    const user = this.db.prepare('SELECT invited_by FROM users WHERE id = ?').get(inviteeId);
    if (!user || !user.invited_by) return 0;

    const rate = Number(this.db.prepare("SELECT value FROM configs WHERE key = 'invite_commission_rate'").get()?.value || 0.05);
    const commission = Math.round(orderAmount * rate * 100) / 100;

    if (commission > 0) {
      // 给邀请人加余额
      const inviter = this.db.prepare('SELECT balance FROM users WHERE id = ?').get(user.invited_by);
      const newBalance = Math.round((inviter.balance + commission) * 100) / 100;
      this.db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(newBalance, user.invited_by);

      // 记录交易
      this.db.prepare('INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, remark) VALUES (?, ?, ?, ?, ?, ?)').run(
        user.invited_by, 'COMMISSION', commission, inviter.balance, newBalance, `邀请佣金（来自用户${inviteeId}的订单）`
      );

      // 更新邀请记录
      this.db.prepare('UPDATE invite_records SET commission = commission + ? WHERE inviter_id = ? AND invitee_id = ?').run(
        commission, user.invited_by, inviteeId
      );
    }

    return commission;
  }

  /**
   * 获取邀请统计
   */
  getStats(userId) {
    const code = this.db.prepare('SELECT invite_code FROM users WHERE id = ?').get(userId)?.invite_code;
    const totalInvited = this.db.prepare('SELECT COUNT(*) as c FROM invite_records WHERE inviter_id = ?').get(userId).c;
    const totalCommission = this.db.prepare('SELECT COALESCE(SUM(commission), 0) as s FROM invite_records WHERE inviter_id = ?').get(userId).s;
    const recentInvites = this.db.prepare(`
      SELECT ir.*, u.nickname, u.phone, ir.created_at
      FROM invite_records ir JOIN users u ON ir.invitee_id = u.id
      WHERE ir.inviter_id = ? ORDER BY ir.created_at DESC LIMIT 10
    `).all(userId);

    return { inviteCode: code, totalInvited, totalCommission, recentInvites };
  }
}

module.exports = InviteService;
