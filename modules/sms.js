/**
 * 短信验证码模块
 * 支持: 阿里云SMS / 腾讯云SMS / 模拟模式
 */
const crypto = require('crypto');

class SMSService {
  constructor(db, config = {}) {
    this.db = db;
    this.enabled = config.enabled || false;
    this.provider = config.provider || 'mock'; // aliyun / tencent / mock
    this.signName = config.signName || '三角洲护航';
    this.templateCode = config.templateCode || 'SMS_123456';
    this.expireMinutes = 5;
    
    // 确保表存在
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sms_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT NOT NULL,
        code TEXT NOT NULL,
        type TEXT DEFAULT 'LOGIN',
        used INTEGER DEFAULT 0,
        expire_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  /**
   * 生成验证码
   */
  generateCode(length = 6) {
    let code = '';
    for (let i = 0; i < length; i++) {
      code += Math.floor(Math.random() * 10);
    }
    return code;
  }

  /**
   * 发送验证码
   */
  async send(phone, type = 'LOGIN') {
    // 频率限制：同一手机号60秒内只能发一次
    const recent = this.db.prepare(
      "SELECT * FROM sms_codes WHERE phone = ? AND type = ? AND created_at > datetime('now', '-1 minute')"
    ).get(phone, type);
    if (recent) return { success: false, msg: '发送过于频繁，请60秒后重试' };

    // 每日限制：同一手机号每天最多10条
    const todayCount = this.db.prepare(
      "SELECT COUNT(*) as c FROM sms_codes WHERE phone = ? AND DATE(created_at) = DATE('now')"
    ).get(phone).c;
    if (todayCount >= 10) return { success: false, msg: '今日发送次数已达上限' };

    const code = this.generateCode();
    const expireAt = new Date(Date.now() + this.expireMinutes * 60000).toISOString();

    // 存储验证码
    this.db.prepare(
      'INSERT INTO sms_codes (phone, code, type, expire_at) VALUES (?, ?, ?, ?)'
    ).run(phone, code, type, expireAt);

    // 发送短信
    if (this.enabled && this.provider !== 'mock') {
      try {
        if (this.provider === 'aliyun') {
          await this._sendAliyun(phone, code);
        } else if (this.provider === 'tencent') {
          await this._sendTencent(phone, code);
        }
        return { success: true, msg: '验证码已发送' };
      } catch (err) {
        console.error('[SMS] 发送失败:', err.message);
        return { success: false, msg: '短信发送失败，请稍后重试' };
      }
    }

    // 模拟模式
    console.log(`[SMS] 模拟发送: ${phone} -> ${code}`);
    return { success: true, msg: '验证码已发送（测试模式）', code };
  }

  /**
   * 验证验证码
   */
  verify(phone, code, type = 'LOGIN') {
    const record = this.db.prepare(
      "SELECT * FROM sms_codes WHERE phone = ? AND code = ? AND type = ? AND used = 0 AND expire_at > datetime('now') ORDER BY id DESC LIMIT 1"
    ).get(phone, code, type);

    if (!record) return { valid: false, msg: '验证码错误或已过期' };

    // 标记已使用
    this.db.prepare('UPDATE sms_codes SET used = 1 WHERE id = ?').run(record.id);
    return { valid: true };
  }

  /**
   * 阿里云短信
   */
  async _sendAliyun(phone, code) {
    const Core = require('@alicloud/pop-core');
    const client = new Core({
      accessKeyId: process.env.ALIYUN_ACCESS_KEY || '',
      accessKeySecret: process.env.ALIYUN_SECRET_KEY || '',
      endpoint: 'https://dysmsapi.aliyuncs.com',
      apiVersion: '2017-05-25'
    });

    await client.request('SendSms', {
      PhoneNumbers: phone,
      SignName: this.signName,
      TemplateCode: this.templateCode,
      TemplateParam: JSON.stringify({ code })
    }, { method: 'POST' });
  }

  /**
   * 腾讯云短信
   */
  async _sendTencent(phone, code) {
    const tencentcloud = require('tencentcloud-sdk-nodejs');
    const SmsClient = tencentcloud.sms.v20210111.Client;
    const client = new SmsClient({
      credential: { secretId: process.env.TENCENT_SECRET_ID, secretKey: process.env.TENCENT_SECRET_KEY },
      region: 'ap-guangzhou'
    });

    await client.SendSms({
      PhoneNumberSet: [`+86${phone}`],
      SmsSdkAppId: process.env.TENCENT_SMS_APP_ID || '',
      SignName: this.signName,
      TemplateId: this.templateCode,
      TemplateParamSet: [code]
    });
  }

  /**
   * 清理过期验证码
   */
  cleanup() {
    this.db.prepare("DELETE FROM sms_codes WHERE expire_at < datetime('now', '-1 day')").run();
  }
}

module.exports = SMSService;
