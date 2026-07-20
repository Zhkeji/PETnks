const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 3001;
const JWT_SECRET = 'delta-escort-secret-key-2026';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── 数据库初始化 ─────────────────────────────────────────
const db = new Database(path.join(__dirname, 'delta.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  -- 管理员/客服表
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    nickname TEXT DEFAULT '',
    avatar TEXT DEFAULT '',
    role TEXT NOT NULL DEFAULT 'CS' CHECK(role IN ('ADMIN','CS','BOTH')),
    phone TEXT DEFAULT '',
    status INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- 用户表
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    openid TEXT UNIQUE,
    phone TEXT UNIQUE,
    nickname TEXT DEFAULT '用户',
    avatar TEXT DEFAULT '',
    balance REAL DEFAULT 0,
    status INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- 接单员(打手)表
  CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    real_name TEXT DEFAULT '',
    game_names TEXT DEFAULT '',
    skill_desc TEXT DEFAULT '',
    deposit REAL DEFAULT 0,
    online_status INTEGER DEFAULT 0,
    max_concurrent INTEGER DEFAULT 3,
    active_orders INTEGER DEFAULT 0,
    rating REAL DEFAULT 5.0,
    total_orders INTEGER DEFAULT 0,
    total_income REAL DEFAULT 0,
    status TEXT DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED','BANNED')),
    banned_reason TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- 分类表
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    icon TEXT DEFAULT '',
    parent_id INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    status INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- 商品/服务表
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER REFERENCES categories(id),
    title TEXT NOT NULL,
    desc TEXT DEFAULT '',
    cover TEXT DEFAULT '',
    price REAL NOT NULL,
    original_price REAL DEFAULT 0,
    unit TEXT DEFAULT '局',
    player_commission_rate REAL DEFAULT 0.7,
    hot INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    status INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- 订单表
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no TEXT UNIQUE NOT NULL,
    user_id INTEGER REFERENCES users(id),
    player_id INTEGER REFERENCES players(id),
    product_id INTEGER REFERENCES products(id),
    product_title TEXT DEFAULT '',
    price REAL NOT NULL,
    quantity INTEGER DEFAULT 1,
    total_amount REAL NOT NULL,
    pay_method TEXT DEFAULT 'WECHAT' CHECK(pay_method IN ('WECHAT','BALANCE')),
    pay_status INTEGER DEFAULT 0,
    pay_time DATETIME,
    order_status TEXT DEFAULT 'PENDING' CHECK(order_status IN (
      'PENDING','PAID','ASSIGNED','IN_PROGRESS','COMPLETED','REVIEWING','REFUNDING','REFUNDED','CANCELLED'
    )),
    assign_mode TEXT DEFAULT 'MANUAL' CHECK(assign_mode IN ('MANUAL','SELECT','GRAB','TEAM')),
    game_info TEXT DEFAULT '',
    remark TEXT DEFAULT '',
    progress TEXT DEFAULT '',
    complete_time DATETIME,
    review_score INTEGER,
    review_content TEXT DEFAULT '',
    refund_reason TEXT DEFAULT '',
    refund_time DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- 聊天会话表
  CREATE TABLE IF NOT EXISTS chat_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    player_id INTEGER,
    cs_id INTEGER,
    order_id INTEGER,
    session_type TEXT DEFAULT 'USER_PLAYER' CHECK(session_type IN ('USER_PLAYER','USER_CS','ORDER')),
    status TEXT DEFAULT 'ACTIVE',
    last_message_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- 聊天消息表
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER REFERENCES chat_sessions(id),
    sender_type TEXT NOT NULL CHECK(sender_type IN ('USER','PLAYER','CS','SYSTEM')),
    sender_id INTEGER,
    msg_type TEXT DEFAULT 'TEXT' CHECK(msg_type IN ('TEXT','IMAGE','SYSTEM','ORDER_CARD')),
    content TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- 轮播图表
  CREATE TABLE IF NOT EXISTS banners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    image_url TEXT NOT NULL,
    link_type TEXT DEFAULT 'NONE',
    link_value TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0,
    status INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- 公告表
  CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    type TEXT DEFAULT 'NORMAL',
    status INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- 交易流水表
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    type TEXT NOT NULL CHECK(type IN ('RECHARGE','PAY','REFUND','WITHDRAW','COMMISSION','BONUS')),
    amount REAL NOT NULL,
    balance_after REAL DEFAULT 0,
    order_id INTEGER,
    remark TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- 提现申请表
  CREATE TABLE IF NOT EXISTS withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER REFERENCES players(id),
    amount REAL NOT NULL,
    fee REAL DEFAULT 0,
    actual_amount REAL NOT NULL,
    status TEXT DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED','PAID')),
    reject_reason TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    processed_at DATETIME
  );

  -- 系统配置表
  CREATE TABLE IF NOT EXISTS configs (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    remark TEXT DEFAULT ''
  );
`);

// ── 初始化默认数据 ───────────────────────────────────────
function initDefaultData() {
  const adminCount = db.prepare('SELECT COUNT(*) as c FROM admins').get().c;
  if (adminCount === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    const kefuHash = bcrypt.hashSync('kefu123', 10);
    db.prepare('INSERT INTO admins (username, password, nickname, role) VALUES (?, ?, ?, ?)').run('admin', hash, '超级管理员', 'ADMIN');
    db.prepare('INSERT INTO admins (username, password, nickname, role) VALUES (?, ?, ?, ?)').run('kefu', kefuHash, '客服小妹', 'CS');
  }

  const catCount = db.prepare('SELECT COUNT(*) as c FROM categories').get().c;
  if (catCount === 0) {
    const cats = [
      ['三角洲行动', '🎯', 0, 1],
      ['无畏契约', '🔫', 0, 2],
      ['王者荣耀', '👑', 0, 3],
      ['和平精英', '🪖', 0, 4],
    ];
    const insertCat = db.prepare('INSERT INTO categories (name, icon, parent_id, sort_order) VALUES (?, ?, ?, ?)');
    cats.forEach(c => insertCat.run(...c));

    // 三角洲子分类
    const subCats = [
      ['护航跑刀', '⚔️', 1, 1],
      ['代肝哈夫币', '💰', 1, 2],
      ['养号任务', '📋', 1, 3],
      ['陪玩娱乐', '🎮', 1, 4],
    ];
    subCats.forEach(c => insertCat.run(...c));

    // 商品
    const products = [
      [1, '三角洲护航 · 普通护航', '专业打手全程护航，安全高效', '/img/escort1.jpg', 30, 50, '局', 0.7, 1, 1],
      [1, '三角洲护航 · 钻石护航', '顶尖打手+语音陪玩，极致体验', '/img/escort2.jpg', 68, 100, '局', 0.75, 1, 2],
      [5, '护航跑刀 · 极速版', '30分钟内完成一局，效率拉满', '/img/knife1.jpg', 25, 40, '局', 0.7, 1, 3],
      [5, '护航跑刀 · 全图探索', '全图搜刮+撤离，收益最大化', '/img/knife2.jpg', 45, 60, '局', 0.7, 0, 4],
      [6, '哈夫币代肝 · 100万', '稳定挂机代肝，保底100万', '/img/coin1.jpg', 15, 20, '次', 0.65, 1, 5],
      [6, '哈夫币代肝 · 500万', '大量代肝套餐，价格优惠', '/img/coin2.jpg', 60, 80, '次', 0.65, 0, 6],
      [7, '每日任务代做', '每日任务+周任务全包', '/img/task1.jpg', 20, 30, '天', 0.6, 0, 7],
      [8, '陪玩娱乐 · 语音陪玩', '甜美/搞笑语音陪玩，快乐游戏', '/img/play1.jpg', 35, 50, '小时', 0.8, 1, 8],
      [2, '无畏契约 · 上分护航', '定级赛/排位赛全程护航', '/img/val1.jpg', 50, 80, '局', 0.7, 1, 9],
      [3, '王者荣耀 · 代练上分', '星耀以下快速上分', '/img/king1.jpg', 20, 35, '星', 0.65, 1, 10],
    ];
    const insertProd = db.prepare(`INSERT INTO products (category_id, title, desc, cover, price, original_price, unit, player_commission_rate, hot, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    products.forEach(p => insertProd.run(...p));
  }

  // 默认轮播图
  const bannerCount = db.prepare('SELECT COUNT(*) as c FROM banners').get().c;
  if (bannerCount === 0) {
    const banners = [
      ['https://picsum.photos/seed/delta1/750/340', 'NONE', '', 1, 1],
      ['https://picsum.photos/seed/delta2/750/340', 'NONE', '', 2, 1],
      ['https://picsum.photos/seed/delta3/750/340', 'NONE', '', 3, 1],
    ];
    const insertBanner = db.prepare('INSERT INTO banners (image_url, link_type, link_value, sort_order, status) VALUES (?, ?, ?, ?, ?)');
    banners.forEach(b => insertBanner.run(...b));
  }

  // 默认公告
  const annCount = db.prepare('SELECT COUNT(*) as c FROM announcements').get().c;
  if (annCount === 0) {
    db.prepare('INSERT INTO announcements (title, content, type) VALUES (?, ?, ?)').run(
      '欢迎使用三角洲护航平台',
      '平台提供专业的游戏代练护航服务，所有接单员均经过严格审核。如有问题请联系在线客服。',
      'IMPORTANT'
    );
  }

  // 默认配置
  const configDefaults = {
    'platform_name': '三角洲护航',
    'platform_fee_rate': '0.3',
    'min_withdraw': '50',
    'withdraw_fee_rate': '0.02',
    'player_deposit': '100',
    'max_concurrent_orders': '3',
    'recharge_bonus_threshold': '100',
    'recharge_bonus_rate': '0.05',
  };
  const insertConfig = db.prepare('INSERT OR IGNORE INTO configs (key, value) VALUES (?, ?)');
  Object.entries(configDefaults).forEach(([k, v]) => insertConfig.run(k, v));
}

initDefaultData();

// ── 中间件 ───────────────────────────────────────────────
function authMiddleware(roleTypes = []) {
  return (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ code: 401, msg: '未登录' });
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
      if (roleTypes.length > 0 && !roleTypes.includes(decoded.role)) {
        return res.status(403).json({ code: 403, msg: '无权限' });
      }
      next();
    } catch (e) {
      return res.status(401).json({ code: 401, msg: '登录已过期' });
    }
  };
}

function genOrderNo() {
  const now = new Date();
  const d = now.toISOString().replace(/[-T:\.Z]/g, '').slice(0, 14);
  return 'D' + d + String(Math.floor(Math.random() * 10000)).padStart(4, '0');
}

// ══════════════════════════════════════════════════════════
//  API 路由
// ══════════════════════════════════════════════════════════

// ── 认证 ─────────────────────────────────────────────────
// 管理员登录
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  const admin = db.prepare('SELECT * FROM admins WHERE username = ? AND status = 1').get(username);
  if (!admin) return res.json({ code: 400, msg: '账号不存在或已禁用' });
  if (!bcrypt.compareSync(password, admin.password)) return res.json({ code: 400, msg: '密码错误' });
  const token = jwt.sign({ id: admin.id, username: admin.username, role: admin.role, type: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ code: 0, data: { token, admin: { id: admin.id, username: admin.username, nickname: admin.nickname, role: admin.role, avatar: admin.avatar } } });
});

// 用户登录(模拟短信验证码)
app.post('/api/user/login', (req, res) => {
  const { phone, code } = req.body;
  if (!phone) return res.json({ code: 400, msg: '请输入手机号' });
  // 模拟验证码: 任意6位或固定123456
  if (code !== '123456' && code?.length !== 6) return res.json({ code: 400, msg: '验证码错误' });

  let user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (!user) {
    const result = db.prepare('INSERT INTO users (phone, nickname) VALUES (?, ?)').run(phone, '用户' + phone.slice(-4));
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  }
  const token = jwt.sign({ id: user.id, phone: user.phone, role: 'USER', type: 'user' }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ code: 0, data: { token, user: { id: user.id, phone: user.phone, nickname: user.nickname, avatar: user.avatar, balance: user.balance } } });
});

// ── 公共接口 ─────────────────────────────────────────────
// 轮播图
app.get('/api/banners', (req, res) => {
  const banners = db.prepare('SELECT * FROM banners WHERE status = 1 ORDER BY sort_order').all();
  res.json({ code: 0, data: banners });
});

// 公告
app.get('/api/announcements', (req, res) => {
  const anns = db.prepare('SELECT * FROM announcements WHERE status = 1 ORDER BY created_at DESC LIMIT 10').all();
  res.json({ code: 0, data: anns });
});

// 分类列表
app.get('/api/categories', (req, res) => {
  const cats = db.prepare('SELECT * FROM categories WHERE status = 1 ORDER BY sort_order').all();
  res.json({ code: 0, data: cats });
});

// 商品列表
app.get('/api/products', (req, res) => {
  const { category_id, hot, keyword, page = 1, limit = 20 } = req.query;
  let sql = 'SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.status = 1';
  const params = [];
  if (category_id) { sql += ' AND p.category_id = ?'; params.push(category_id); }
  if (hot === '1') { sql += ' AND p.hot = 1'; }
  if (keyword) { sql += ' AND (p.title LIKE ? OR p.desc LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`); }
  sql += ' ORDER BY p.sort_order LIMIT ? OFFSET ?';
  params.push(Number(limit), (Number(page) - 1) * Number(limit));
  const products = db.prepare(sql).all(...params);
  res.json({ code: 0, data: products });
});

// 商品详情
app.get('/api/products/:id', (req, res) => {
  const product = db.prepare('SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id = ?').get(req.params.id);
  if (!product) return res.json({ code: 404, msg: '商品不存在' });
  res.json({ code: 0, data: product });
});

// ── 用户端 API ───────────────────────────────────────────
// 用户信息
app.get('/api/user/profile', authMiddleware(['USER']), (req, res) => {
  const user = db.prepare('SELECT id, phone, nickname, avatar, balance, created_at FROM users WHERE id = ?').get(req.user.id);
  res.json({ code: 0, data: user });
});

// 创建订单
app.post('/api/orders', authMiddleware(['USER']), (req, res) => {
  const { product_id, quantity = 1, game_info = '', remark = '', assign_mode = 'GRAB' } = req.body;
  const product = db.prepare('SELECT * FROM products WHERE id = ? AND status = 1').get(product_id);
  if (!product) return res.json({ code: 400, msg: '商品不存在' });

  const total = product.price * quantity;
  const orderNo = genOrderNo();

  db.prepare(`INSERT INTO orders (order_no, user_id, product_id, product_title, price, quantity, total_amount, assign_mode, game_info, remark, order_status, pay_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0)`).run(
    orderNo, req.user.id, product_id, product.title, product.price, quantity, total, assign_mode, game_info, remark
  );

  const order = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(orderNo);
  res.json({ code: 0, data: order });
});

// 用户订单列表
app.get('/api/user/orders', authMiddleware(['USER']), (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  let sql = 'SELECT o.*, p.cover as product_cover FROM orders o LEFT JOIN products p ON o.product_id = p.id WHERE o.user_id = ?';
  const params = [req.user.id];
  if (status) { sql += ' AND o.order_status = ?'; params.push(status); }
  sql += ' ORDER BY o.created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), (Number(page) - 1) * Number(limit));
  const orders = db.prepare(sql).all(...params);
  res.json({ code: 0, data: orders });
});

// 模拟支付(余额支付)
app.post('/api/orders/:id/pay', authMiddleware(['USER']), (req, res) => {
  const { pay_method = 'BALANCE' } = req.body;
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!order) return res.json({ code: 404, msg: '订单不存在' });
  if (order.order_status !== 'PENDING') return res.json({ code: 400, msg: '订单状态异常' });

  if (pay_method === 'BALANCE') {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (user.balance < order.total_amount) return res.json({ code: 400, msg: '余额不足' });
    db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(order.total_amount, req.user.id);
    db.prepare('INSERT INTO transactions (user_id, type, amount, balance_after, order_id, remark) VALUES (?, ?, ?, ?, ?, ?)').run(
      req.user.id, 'PAY', -order.total_amount, user.balance - order.total_amount, order.id, `支付订单 ${order.order_no}`
    );
  }

  db.prepare("UPDATE orders SET order_status = 'PAID', pay_status = 1, pay_method = ?, pay_time = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(pay_method, order.id);

  // 自动抢单模式：创建抢单池
  if (order.assign_mode === 'GRAB') {
    // 创建系统消息通知接单员
    db.prepare("INSERT INTO announcements (title, content, type) VALUES (?, ?, ?)").run(
      '新抢单通知',
      `新订单 ${order.order_no}: ${order.product_title}，金额 ¥${order.total_amount}，快来抢单！`,
      'ORDER'
    );
  }

  res.json({ code: 0, msg: '支付成功', data: { order_status: 'PAID' } });
});

// 取消订单
app.post('/api/orders/:id/cancel', authMiddleware(['USER']), (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!order) return res.json({ code: 404, msg: '订单不存在' });
  if (!['PENDING', 'PAID'].includes(order.order_status)) return res.json({ code: 400, msg: '当前状态不可取消' });

  if (order.pay_status === 1) {
    const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(req.user.id);
    db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(order.total_amount, req.user.id);
    db.prepare('INSERT INTO transactions (user_id, type, amount, balance_after, order_id, remark) VALUES (?, ?, ?, ?, ?, ?)').run(
      req.user.id, 'REFUND', order.total_amount, user.balance + order.total_amount, order.id, `取消退款 ${order.order_no}`
    );
  }

  db.prepare("UPDATE orders SET order_status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(order.id);
  res.json({ code: 0, msg: '已取消' });
});

// 申请退款
app.post('/api/orders/:id/refund', authMiddleware(['USER']), (req, res) => {
  const { reason } = req.body;
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!order) return res.json({ code: 404, msg: '订单不存在' });
  if (!['PAID', 'ASSIGNED'].includes(order.order_status)) return res.json({ code: 400, msg: '当前状态不可退款' });

  db.prepare("UPDATE orders SET order_status = 'REFUNDING', refund_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(reason || '', order.id);
  res.json({ code: 0, msg: '退款申请已提交' });
});

// 评价订单
app.post('/api/orders/:id/review', authMiddleware(['USER']), (req, res) => {
  const { score, content } = req.body;
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!order) return res.json({ code: 404, msg: '订单不存在' });
  if (order.order_status !== 'COMPLETED') return res.json({ code: 400, msg: '订单未完成' });

  db.prepare('UPDATE orders SET review_score = ?, review_content = ?, order_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
    score || 5, content || '', 'REVIEWING', order.id
  );
  res.json({ code: 0, msg: '评价成功' });
});

// 充值
app.post('/api/user/recharge', authMiddleware(['USER']), (req, res) => {
  const { amount } = req.body;
  if (!amount || amount <= 0) return res.json({ code: 400, msg: '金额无效' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  let bonus = 0;
  const threshold = Number(db.prepare("SELECT value FROM configs WHERE key = 'recharge_bonus_threshold'").get()?.value || 100);
  const bonusRate = Number(db.prepare("SELECT value FROM configs WHERE key = 'recharge_bonus_rate'").get()?.value || 0.05);
  if (amount >= threshold) bonus = Math.floor(amount * bonusRate * 100) / 100;

  const newBalance = user.balance + amount + bonus;
  db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(newBalance, req.user.id);
  db.prepare('INSERT INTO transactions (user_id, type, amount, balance_after, remark) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'RECHARGE', amount, newBalance, `充值 ¥${amount}${bonus > 0 ? ` (赠 ¥${bonus})` : ''}`
  );
  res.json({ code: 0, data: { balance: newBalance, bonus } });
});

// ── 接单员 API ───────────────────────────────────────────
// 申请成为接单员
app.post('/api/player/apply', authMiddleware(['USER']), (req, res) => {
  const { real_name, game_names, skill_desc } = req.body;
  const existing = db.prepare('SELECT * FROM players WHERE user_id = ?').get(req.user.id);
  if (existing) {
    if (existing.status === 'APPROVED') return res.json({ code: 400, msg: '已是接单员' });
    if (existing.status === 'PENDING') return res.json({ code: 400, msg: '审核中，请等待' });
    db.prepare('UPDATE players SET real_name=?, game_names=?, skill_desc=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(
      real_name, game_names, skill_desc, 'PENDING', req.user.id
    );
  } else {
    db.prepare('INSERT INTO players (user_id, real_name, game_names, skill_desc) VALUES (?, ?, ?, ?)').run(
      req.user.id, real_name, game_names, skill_desc
    );
  }
  res.json({ code: 0, msg: '申请已提交，等待审核' });
});

// 接单员信息
app.get('/api/player/profile', authMiddleware(['USER']), (req, res) => {
  const player = db.prepare('SELECT p.*, u.nickname, u.phone, u.avatar as user_avatar FROM players p JOIN users u ON p.user_id = u.id WHERE p.user_id = ?').get(req.user.id);
  if (!player) return res.json({ code: 404, msg: '未申请接单员' });
  res.json({ code: 0, data: player });
});

// 可抢单列表
app.get('/api/player/grab-orders', authMiddleware(['USER']), (req, res) => {
  const player = db.prepare('SELECT * FROM players WHERE user_id = ? AND status = ?').get(req.user.id, 'APPROVED');
  if (!player) return res.json({ code: 403, msg: '非认证接单员' });

  const orders = db.prepare(`
    SELECT o.*, u.nickname as user_nickname, u.phone as user_phone
    FROM orders o JOIN users u ON o.user_id = u.id
    WHERE o.order_status = 'PAID' AND o.assign_mode = 'GRAB' AND o.player_id IS NULL
    ORDER BY o.created_at DESC LIMIT 50
  `).all();
  res.json({ code: 0, data: orders });
});

// 抢单
app.post('/api/player/grab/:orderId', authMiddleware(['USER']), (req, res) => {
  const player = db.prepare('SELECT * FROM players WHERE user_id = ? AND status = ?').get(req.user.id, 'APPROVED');
  if (!player) return res.json({ code: 403, msg: '非认证接单员' });
  if (player.active_orders >= player.max_concurrent) return res.json({ code: 400, msg: '接单数已达上限' });

  const order = db.prepare("SELECT * FROM orders WHERE id = ? AND order_status = 'PAID' AND assign_mode = 'GRAB' AND player_id IS NULL").get(req.params.orderId);
  if (!order) return res.json({ code: 400, msg: '该单已被抢或不存在' });

  db.prepare("UPDATE orders SET player_id = ?, order_status = 'ASSIGNED', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(player.id, order.id);
  db.prepare('UPDATE players SET active_orders = active_orders + 1 WHERE id = ?').run(player.id);

  // 通知用户
  db.prepare("INSERT INTO chat_messages (session_id, sender_type, sender_id, msg_type, content) VALUES (?, 'SYSTEM', NULL, 'SYSTEM', ?)").run(
    order.id,
    `接单员 ${player.real_name || player.game_names || '匿名'} 已接单，即将开始服务`
  );

  res.json({ code: 0, msg: '抢单成功！' });
});

// 接单员的订单
app.get('/api/player/orders', authMiddleware(['USER']), (req, res) => {
  const player = db.prepare('SELECT * FROM players WHERE user_id = ?').get(req.user.id);
  if (!player) return res.json({ code: 403, msg: '非接单员' });

  const { status, page = 1, limit = 20 } = req.query;
  let sql = 'SELECT o.*, u.nickname as user_nickname, u.phone as user_phone FROM orders o JOIN users u ON o.user_id = u.id WHERE o.player_id = ?';
  const params = [player.id];
  if (status) { sql += ' AND o.order_status = ?'; params.push(status); }
  sql += ' ORDER BY o.created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), (Number(page) - 1) * Number(limit));
  const orders = db.prepare(sql).all(...params);
  res.json({ code: 0, data: orders });
});

// 更新订单进度
app.post('/api/player/orders/:id/progress', authMiddleware(['USER']), (req, res) => {
  const { progress } = req.body;
  const player = db.prepare('SELECT * FROM players WHERE user_id = ?').get(req.user.id);
  if (!player) return res.json({ code: 403, msg: '非接单员' });

  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND player_id = ?').get(req.params.id, player.id);
  if (!order) return res.json({ code: 404, msg: '订单不存在' });

  db.prepare("UPDATE orders SET progress = ?, order_status = 'IN_PROGRESS', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(progress, order.id);
  res.json({ code: 0, msg: '进度已更新' });
});

// 完成订单
app.post('/api/player/orders/:id/complete', authMiddleware(['USER']), (req, res) => {
  const player = db.prepare('SELECT * FROM players WHERE user_id = ?').get(req.user.id);
  if (!player) return res.json({ code: 403, msg: '非接单员' });

  const order = db.prepare("SELECT * FROM orders WHERE id = ? AND player_id = ? AND order_status IN ('ASSIGNED','IN_PROGRESS')").get(req.params.id, player.id);
  if (!order) return res.json({ code: 404, msg: '订单不存在或状态异常' });

  // 计算佣金
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(order.product_id);
  const commission = order.total_amount * (product?.player_commission_rate || 0.7);
  const platformFee = order.total_amount - commission;

  db.prepare("UPDATE orders SET order_status = 'COMPLETED', complete_time = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(order.id);
  db.prepare('UPDATE players SET active_orders = MAX(0, active_orders - 1), total_orders = total_orders + 1, total_income = total_income + ? WHERE id = ?').run(commission, player.id);

  // 记录佣金
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(player.user_id);
  db.prepare('INSERT INTO transactions (user_id, type, amount, balance_after, order_id, remark) VALUES (?, ?, ?, ?, ?, ?)').run(
    player.user_id, 'COMMISSION', commission, user.balance + commission, order.id, `订单 ${order.order_no} 佣金`
  );
  db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(commission, player.user_id);

  res.json({ code: 0, msg: '订单已完成', data: { commission, platformFee } });
});

// 接单员提现
app.post('/api/player/withdraw', authMiddleware(['USER']), (req, res) => {
  const { amount } = req.body;
  if (!amount || amount <= 0) return res.json({ code: 400, msg: '金额无效' });

  const player = db.prepare('SELECT * FROM players WHERE user_id = ?').get(req.user.id);
  if (!player) return res.json({ code: 403, msg: '非接单员' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const minWithdraw = Number(db.prepare("SELECT value FROM configs WHERE key = 'min_withdraw'").get()?.value || 50);
  const feeRate = Number(db.prepare("SELECT value FROM configs WHERE key = 'withdraw_fee_rate'").get()?.value || 0.02);

  if (amount < minWithdraw) return res.json({ code: 400, msg: `最低提现 ¥${minWithdraw}` });
  if (amount > user.balance) return res.json({ code: 400, msg: '余额不足' });

  const fee = Math.ceil(amount * feeRate * 100) / 100;
  const actual = amount - fee;

  db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(amount, req.user.id);
  db.prepare('INSERT INTO withdrawals (player_id, amount, fee, actual_amount) VALUES (?, ?, ?, ?)').run(player.id, amount, fee, actual);
  db.prepare('INSERT INTO transactions (user_id, type, amount, balance_after, remark) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'WITHDRAW', -amount, user.balance - amount, `提现申请 ¥${amount}（手续费 ¥${fee}）`
  );

  res.json({ code: 0, msg: '提现申请已提交', data: { fee, actual } });
});

// ── 管理后台 API ─────────────────────────────────────────
// 仪表盘统计
app.get('/api/admin/dashboard', authMiddleware(['ADMIN', 'CS', 'BOTH']), (req, res) => {
  const totalUsers = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const totalPlayers = db.prepare("SELECT COUNT(*) as c FROM players WHERE status = 'APPROVED'").get().c;
  const totalOrders = db.prepare('SELECT COUNT(*) as c FROM orders').get().c;
  const todayOrders = db.prepare("SELECT COUNT(*) as c FROM orders WHERE DATE(created_at) = DATE('now')").get().c;
  const totalRevenue = db.prepare("SELECT COALESCE(SUM(total_amount), 0) as s FROM orders WHERE pay_status = 1").get().s;
  const pendingOrders = db.prepare("SELECT COUNT(*) as c FROM orders WHERE order_status = 'PAID'").get().c;
  const pendingRefunds = db.prepare("SELECT COUNT(*) as c FROM orders WHERE order_status = 'REFUNDING'").get().c;
  const pendingPlayers = db.prepare("SELECT COUNT(*) as c FROM players WHERE status = 'PENDING'").get().c;
  const pendingWithdrawals = db.prepare("SELECT COUNT(*) as c FROM withdrawals WHERE status = 'PENDING'").get().c;

  const recentOrders = db.prepare(`
    SELECT o.*, u.nickname as user_nickname, p.real_name as player_name
    FROM orders o LEFT JOIN users u ON o.user_id = u.id LEFT JOIN players p ON o.player_id = p.id
    ORDER BY o.created_at DESC LIMIT 10
  `).all();

  res.json({
    code: 0,
    data: {
      stats: { totalUsers, totalPlayers, totalOrders, todayOrders, totalRevenue, pendingOrders, pendingRefunds, pendingPlayers, pendingWithdrawals },
      recentOrders
    }
  });
});

// 管理员 - 用户管理
app.get('/api/admin/users', authMiddleware(['ADMIN', 'CS', 'BOTH']), (req, res) => {
  const { keyword, page = 1, limit = 20 } = req.query;
  let sql = 'SELECT id, phone, nickname, avatar, balance, status, created_at FROM users WHERE 1=1';
  const params = [];
  if (keyword) { sql += ' AND (phone LIKE ? OR nickname LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`); }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), (Number(page) - 1) * Number(limit));
  res.json({ code: 0, data: db.prepare(sql).all(...params) });
});

// 管理员 - 订单管理
app.get('/api/admin/orders', authMiddleware(['ADMIN', 'CS', 'BOTH']), (req, res) => {
  const { status, keyword, page = 1, limit = 20 } = req.query;
  let sql = `SELECT o.*, u.nickname as user_nickname, u.phone as user_phone, p.real_name as player_name
    FROM orders o LEFT JOIN users u ON o.user_id = u.id LEFT JOIN players p ON o.player_id = p.id WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND o.order_status = ?'; params.push(status); }
  if (keyword) { sql += ' AND (o.order_no LIKE ? OR o.product_title LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`); }
  sql += ' ORDER BY o.created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), (Number(page) - 1) * Number(limit));
  res.json({ code: 0, data: db.prepare(sql).all(...params) });
});

// 管理员 - 派单
app.post('/api/admin/orders/:id/assign', authMiddleware(['ADMIN', 'CS', 'BOTH']), (req, res) => {
  const { player_id } = req.body;
  const order = db.prepare("SELECT * FROM orders WHERE id = ? AND order_status = 'PAID'").get(req.params.id);
  if (!order) return res.json({ code: 400, msg: '订单不存在或状态异常' });

  const player = db.prepare("SELECT * FROM players WHERE id = ? AND status = 'APPROVED'").get(player_id);
  if (!player) return res.json({ code: 400, msg: '接单员不存在或未审核' });

  db.prepare("UPDATE orders SET player_id = ?, order_status = 'ASSIGNED', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(player_id, order.id);
  db.prepare('UPDATE players SET active_orders = active_orders + 1 WHERE id = ?').run(player_id);
  res.json({ code: 0, msg: '派单成功' });
});

// 管理员 - 退款处理
app.post('/api/admin/orders/:id/refund', authMiddleware(['ADMIN', 'BOTH']), (req, res) => {
  const { action } = req.body; // approve / reject
  const order = db.prepare("SELECT * FROM orders WHERE id = ? AND order_status = 'REFUNDING'").get(req.params.id);
  if (!order) return res.json({ code: 400, msg: '订单不存在或非退款状态' });

  if (action === 'approve') {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(order.user_id);
    db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(order.total_amount, order.user_id);
    db.prepare('INSERT INTO transactions (user_id, type, amount, balance_after, order_id, remark) VALUES (?, ?, ?, ?, ?, ?)').run(
      order.user_id, 'REFUND', order.total_amount, user.balance + order.total_amount, order.id, `退款 ${order.order_no}`
    );
    db.prepare("UPDATE orders SET order_status = 'REFUNDED', refund_time = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(order.id);
    res.json({ code: 0, msg: '退款成功' });
  } else {
    db.prepare("UPDATE orders SET order_status = 'PAID', refund_reason = '', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(order.id);
    res.json({ code: 0, msg: '退款已拒绝' });
  }
});

// 管理员 - 接单员管理
app.get('/api/admin/players', authMiddleware(['ADMIN', 'BOTH']), (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  let sql = `SELECT p.*, u.nickname, u.phone FROM players p JOIN users u ON p.user_id = u.id WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND p.status = ?'; params.push(status); }
  sql += ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), (Number(page) - 1) * Number(limit));
  res.json({ code: 0, data: db.prepare(sql).all(...params) });
});

// 管理员 - 审核接单员
app.post('/api/admin/players/:id/review', authMiddleware(['ADMIN', 'BOTH']), (req, res) => {
  const { action, reason } = req.body; // approve / reject
  const status = action === 'approve' ? 'APPROVED' : 'REJECTED';
  db.prepare('UPDATE players SET status = ?, banned_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, reason || '', req.params.id);
  res.json({ code: 0, msg: `已${action === 'approve' ? '通过' : '拒绝'}` });
});

// 管理员 - 提现管理
app.get('/api/admin/withdrawals', authMiddleware(['ADMIN', 'BOTH']), (req, res) => {
  const { status } = req.query;
  let sql = `SELECT w.*, p.real_name, u.phone FROM withdrawals w JOIN players p ON w.player_id = p.id JOIN users u ON p.user_id = u.id WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND w.status = ?'; params.push(status); }
  sql += ' ORDER BY w.created_at DESC';
  res.json({ code: 0, data: db.prepare(sql).all(...params) });
});

// 管理员 - 处理提现
app.post('/api/admin/withdrawals/:id/review', authMiddleware(['ADMIN', 'BOTH']), (req, res) => {
  const { action, reason } = req.body;
  const w = db.prepare('SELECT * FROM withdrawals WHERE id = ? AND status = ?').get(req.params.id, 'PENDING');
  if (!w) return res.json({ code: 400, msg: '记录不存在' });

  if (action === 'approve') {
    db.prepare("UPDATE withdrawals SET status = 'APPROVED', processed_at = CURRENT_TIMESTAMP WHERE id = ?").run(w.id);
  } else {
    // 退款到余额
    const player = db.prepare('SELECT user_id FROM players WHERE id = ?').get(w.player_id);
    db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(w.amount, player.user_id);
    db.prepare("UPDATE withdrawals SET status = 'REJECTED', reject_reason = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?").run(reason || '', w.id);
  }
  res.json({ code: 0, msg: action === 'approve' ? '已批准' : '已拒绝' });
});

// 管理员 - 分类管理
app.post('/api/admin/categories', authMiddleware(['ADMIN', 'BOTH']), (req, res) => {
  const { name, icon, parent_id = 0, sort_order = 0 } = req.body;
  db.prepare('INSERT INTO categories (name, icon, parent_id, sort_order) VALUES (?, ?, ?, ?)').run(name, icon, parent_id, sort_order);
  res.json({ code: 0, msg: '添加成功' });
});

app.put('/api/admin/categories/:id', authMiddleware(['ADMIN', 'BOTH']), (req, res) => {
  const { name, icon, sort_order, status } = req.body;
  db.prepare('UPDATE categories SET name = COALESCE(?, name), icon = COALESCE(?, icon), sort_order = COALESCE(?, sort_order), status = COALESCE(?, status) WHERE id = ?')
    .run(name, icon, sort_order, status, req.params.id);
  res.json({ code: 0, msg: '更新成功' });
});

// 管理员 - 商品管理
app.post('/api/admin/products', authMiddleware(['ADMIN', 'BOTH']), (req, res) => {
  const { category_id, title, desc, cover, price, original_price, unit, player_commission_rate, hot, sort_order } = req.body;
  db.prepare(`INSERT INTO products (category_id, title, desc, cover, price, original_price, unit, player_commission_rate, hot, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(category_id, title, desc || '', cover || '', price, original_price || 0, unit || '局', player_commission_rate || 0.7, hot || 0, sort_order || 0);
  res.json({ code: 0, msg: '添加成功' });
});

app.put('/api/admin/products/:id', authMiddleware(['ADMIN', 'BOTH']), (req, res) => {
  const fields = ['category_id', 'title', 'desc', 'cover', 'price', 'original_price', 'unit', 'player_commission_rate', 'hot', 'sort_order', 'status'];
  const updates = []; const params = [];
  fields.forEach(f => { if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); } });
  if (updates.length === 0) return res.json({ code: 400, msg: '无更新内容' });
  params.push(req.params.id);
  db.prepare(`UPDATE products SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...params);
  res.json({ code: 0, msg: '更新成功' });
});

// 管理员 - 轮播图管理
app.post('/api/admin/banners', authMiddleware(['ADMIN', 'BOTH']), (req, res) => {
  const { image_url, link_type = 'NONE', link_value = '', sort_order = 0 } = req.body;
  db.prepare('INSERT INTO banners (image_url, link_type, link_value, sort_order) VALUES (?, ?, ?, ?)').run(image_url, link_type, link_value, sort_order);
  res.json({ code: 0, msg: '添加成功' });
});

app.delete('/api/admin/banners/:id', authMiddleware(['ADMIN', 'BOTH']), (req, res) => {
  db.prepare('DELETE FROM banners WHERE id = ?').run(req.params.id);
  res.json({ code: 0, msg: '已删除' });
});

// 管理员 - 公告管理
app.post('/api/admin/announcements', authMiddleware(['ADMIN', 'BOTH']), (req, res) => {
  const { title, content, type = 'NORMAL' } = req.body;
  db.prepare('INSERT INTO announcements (title, content, type) VALUES (?, ?, ?)').run(title, content, type);
  res.json({ code: 0, msg: '添加成功' });
});

// 管理员 - 配置管理
app.get('/api/admin/configs', authMiddleware(['ADMIN', 'BOTH']), (req, res) => {
  const configs = db.prepare('SELECT * FROM configs').all();
  res.json({ code: 0, data: configs });
});

app.put('/api/admin/configs', authMiddleware(['ADMIN', 'BOTH']), (req, res) => {
  const { configs } = req.body;
  const stmt = db.prepare('UPDATE configs SET value = ? WHERE key = ?');
  const updateMany = db.transaction((items) => { items.forEach(c => stmt.run(c.value, c.key)); });
  updateMany(configs);
  res.json({ code: 0, msg: '配置已更新' });
});

// ── 前端路由 ─────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/player', (req, res) => res.sendFile(path.join(__dirname, 'public', 'player.html')));

// ── 启动 ─────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎮 三角洲护航 SaaS 系统运行在 http://localhost:${PORT}`);
  console.log(`   用户端: http://localhost:${PORT}`);
  console.log(`   管理后台: http://localhost:${PORT}/admin`);
  console.log(`   接单员端: http://localhost:${PORT}/player`);
});
