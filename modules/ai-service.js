/**
 * AI 客服模块
 * 支持: OpenAI / 本地大模型 / 关键词匹配
 */

class AICustomerService {
  constructor(db, config = {}) {
    this.db = db;
    this.enabled = config.enabled || false;
    this.provider = config.provider || 'keyword'; // openai / local / keyword
    this.apiKey = config.apiKey || '';
    this.model = config.model || 'gpt-3.5-turbo';

    // 知识库
    this.knowledgeBase = {
      '充值': '您可以在"我的"页面点击"充值中心"进行充值。支持余额支付，充100送5元。',
      '退款': '退款请在订单详情页点击"退款"按钮，填写退款原因后提交。审核通过后退款将原路返回。',
      '提现': '接单员可在"我的"页面申请提现，最低50元，手续费2%。提现审核通常1-3个工作日。',
      '接单': '在"我的"页面点击"成为接单员"，填写真实姓名和擅长游戏，等待管理员审核通过后即可开始抢单。',
      '支付': '目前支持余额支付。充值后在下单时选择余额支付即可。',
      '客服': '您好！我是AI客服助手，可以帮您解答常见问题。如需人工客服，请在工作时间内联系。',
      '投诉': '如需投诉，请在订单详情页提交投诉内容，或联系在线客服。',
      '价格': '各服务价格请在首页"热门推荐"或"全部服务"中查看，不同服务价格不同。',
      '安全': '平台所有接单员均经过实名认证和技能审核，确保服务质量和账号安全。',
      '帮助': '常见问题：\n1. 如何下单？→ 首页选择服务 → 填写信息 → 支付\n2. 如何充值？→ 我的 → 充值中心\n3. 如何退款？→ 订单详情 → 退款\n4. 如何成为接单员？→ 我的 → 成为接单员'
    };
  }

  /**
   * 处理用户消息
   */
  async chat(sessionId, userId, message) {
    // 1. 关键词匹配
    const keywordReply = this._keywordMatch(message);
    if (keywordReply) return keywordReply;

    // 2. OpenAI
    if (this.enabled && this.provider === 'openai') {
      return await this._chatOpenAI(message);
    }

    // 3. 默认回复
    return '感谢您的咨询！我暂时无法回答这个问题，请联系人工客服获取帮助。您可以在工作时间内（9:00-22:00）联系在线客服。';
  }

  /**
   * 关键词匹配
   */
  _keywordMatch(message) {
    const msg = message.toLowerCase();
    for (const [keyword, reply] of Object.entries(this.knowledgeBase)) {
      if (msg.includes(keyword)) return reply;
    }
    // 模糊匹配
    if (msg.match(/怎么|如何|怎样|可以/)) {
      if (msg.match(/下单|购买|买/)) return this.knowledgeBase['帮助'];
      if (msg.match(/钱|费|多少/)) return this.knowledgeBase['价格'];
    }
    if (msg.match(/你好|hi|hello|在吗|在不在/)) {
      return '您好！我是AI客服助手，有什么可以帮您的吗？';
    }
    if (msg.match(/谢|感谢|thanks/)) {
      return '不客气！如果还有其他问题，随时可以问我。';
    }
    return null;
  }

  /**
   * OpenAI 对话
   */
  async _chatOpenAI(message) {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: '你是三角洲护航平台的AI客服助手，帮助用户解答关于游戏代练护航服务的问题。回答要简洁友好。' },
            { role: 'user', content: message }
          ],
          max_tokens: 200,
          temperature: 0.7
        })
      });
      const data = await response.json();
      return data.choices?.[0]?.message?.content || '暂时无法回答，请联系人工客服。';
    } catch (err) {
      console.error('[AI] OpenAI 调用失败:', err.message);
      return this._keywordMatch(message) || '暂时无法回答，请联系人工客服。';
    }
  }

  /**
   * 添加知识条目
   */
  addKnowledge(keyword, reply) {
    this.knowledgeBase[keyword] = reply;
  }
}

module.exports = AICustomerService;
