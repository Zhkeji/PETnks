const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const multer = require('multer');
const { WebSocketServer } = require('ws');
const http = require('http');

// 模块
const SMSService = require('./modules/sms');
const UploadService = require('./modules/upload');
const HealthCheck = require('./modules/health');
const BackupService = require('./modules/backup');
const InviteService = require('./modules/invite');
const AICustomerService = require('./modules/ai-service');
const { requirePermission, getAllPermissions, getAllRoles } = require('./modules/rbac');

const app = express();
const server = http.createServer(app);
const PORT = 3001;
const JWT_SECRET = 'delta-escort-2026-secret-key';

// ── 中间件 ───────────────────────────────────────────────
app.use(compression());
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 请求日志
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (!req.path.startsWith('/api/')) return;
    const status = res.statusCode;
    const color = status >= 400 ? '\x1b[31m' : status >= 300 ? '\x1b[33m' : '\x1b[32m';
    console.log(`${color}${req.method} ${req.path} ${status} ${ms}ms\x1b[0m`);
  });
  next();
});

// ── 限流 ─────────────────────────────────────────────────
const rateLimits = new Map();
function rateLimit(windowMs = 60000, max = 100) {
  return (req, res, next) => {
    const key = req.ip + req.path;
    const now = Date.now();
    const record = rateLimits.get(key);
    if (!record || now - record.start > windowMs) {
      rateLimits.set(key, { start: now, count: 1 });
      return next();
    }
    record.count++;
    if (record.count > max) return res.status(429).json({ code: 429, msg: '请求过于频繁，请稍后再试' });
    next();
  };
}
// 清理过期限流记录
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateLimits) {
    if (now - val.start > 120000) rateLimits.delete(key);
  }
}, 60000);

// ── 数据库 ───────────────────────────────────────────────
const db = new Database(path.join(__dirname, 'delta.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    nickname TEXT DEFAULT '',
    avatar TEXT DEFAULT '',
    role TEXT NOT NULL DEFAULT 'CS' CHECK(role IN ('ADMIN','CS','BOTH')),
    phone TEXT DEFAULT '',
    status INTEGER DEFAULT 1,
    login_fail_count INTEGER DEFAULT 0,
    lock_time DATETIME,
    last_login_at DATETIME,
    last_login_ip TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    openid TEXT UNIQUE,
    phone TEXT UNIQUE,
    nickname TEXT DEFAULT '用户',
    avatar TEXT DEFAULT '',
    gender INTEGER DEFAULT 0,
    balance REAL DEFAULT 0,
    total_spent REAL DEFAULT 0,
    order_count INTEGER DEFAULT 0,
    invite_code TEXT UNIQUE,
    invited_by INTEGER,
    status INTEGER DEFAULT 1,
    last_login_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    real_name TEXT DEFAULT '',
    id_card TEXT DEFAULT '',
    game_names TEXT DEFAULT '',
    skill_desc TEXT DEFAULT '',
    game_rank TEXT DEFAULT '',
    deposit REAL DEFAULT 0,
    online_status INTEGER DEFAULT 0,
    max_concurrent INTEGER DEFAULT 3,
    active_orders INTEGER DEFAULT 0,
    rating REAL DEFAULT 5.0,
    rating_count INTEGER DEFAULT 0,
    total_orders INTEGER DEFAULT 0,
    total_income REAL DEFAULT 0,
    completion_rate REAL DEFAULT 100.0,
    avg_complete_time REAL DEFAULT 0,
    status TEXT DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED','BANNED')),
    banned_reason TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    icon TEXT DEFAULT '',
    color TEXT DEFAULT '#FF6B35',
    parent_id INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    status INTEGER DEFAULT 1,
    product_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER REFERENCES categories(id),
    title TEXT NOT NULL,
    subtitle TEXT DEFAULT '',
    desc TEXT DEFAULT '',
    cover TEXT DEFAULT '',
    images TEXT DEFAULT '[]',
    price REAL NOT NULL,
    original_price REAL DEFAULT 0,
    unit TEXT DEFAULT '局',
    player_commission_rate REAL DEFAULT 0.7,
    min_quantity INTEGER DEFAULT 1,
    max_quantity INTEGER DEFAULT 99,
    hot INTEGER DEFAULT 0,
    new INTEGER DEFAULT 0,
    sales INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    status INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no TEXT UNIQUE NOT NULL,
    user_id INTEGER REFERENCES users(id),
    player_id INTEGER REFERENCES players(id),
    product_id INTEGER REFERENCES products(id),
    product_title TEXT DEFAULT '',
    product_cover TEXT DEFAULT '',
    price REAL NOT NULL,
    quantity INTEGER DEFAULT 1,
    total_amount REAL NOT NULL,
    pay_method TEXT DEFAULT 'WECHAT' CHECK(pay_method IN ('WECHAT','BALANCE','ALIPAY')),
    pay_status INTEGER DEFAULT 0,
    pay_time DATETIME,
    order_status TEXT DEFAULT 'PENDING' CHECK(order_status IN (
      'PENDING','PAID','ASSIGNED','IN_PROGRESS','COMPLETED','REVIEWING','REFUNDING','REFUNDED','CANCELLED','DISPUTE'
    )),
    assign_mode TEXT DEFAULT 'GRAB' CHECK(assign_mode IN ('MANUAL','SELECT','GRAB','TEAM')),
    game_info TEXT DEFAULT '',
    remark TEXT DEFAULT '',
    progress TEXT DEFAULT '',
    progress_updated_at DATETIME,
    complete_time DATETIME,
    review_score INTEGER,
    review_content TEXT DEFAULT '',
    review_time DATETIME,
    refund_reason TEXT DEFAULT '',
    refund_time DATETIME,
    dispute_reason TEXT DEFAULT '',
    dispute_time DATETIME,
    ip_address TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS order_timeline (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER REFERENCES orders(id),
    action TEXT NOT NULL,
    content TEXT DEFAULT '',
    operator_type TEXT DEFAULT 'SYSTEM',
    operator_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS chat_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    player_id INTEGER,
    cs_id INTEGER,
    order_id INTEGER,
    session_type TEXT DEFAULT 'USER_PLAYER' CHECK(session_type IN ('USER_PLAYER','USER_CS','ORDER')),
    id1 INTEGER DEFAULT 0,
    id2 INTEGER DEFAULT 0,
    status TEXT DEFAULT 'ACTIVE',
    last_message TEXT DEFAULT '',
    last_message_at DATETIME,
    unread_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER REFERENCES chat_sessions(id),
    sender_type TEXT NOT NULL CHECK(sender_type IN ('USER','PLAYER','CS','SYSTEM')),
    sender_id INTEGER,
    sender_name TEXT DEFAULT '',
    sender_avatar TEXT DEFAULT '',
    msg_type TEXT DEFAULT 'TEXT' CHECK(msg_type IN ('TEXT','IMAGE','SYSTEM','ORDER_CARD','PRODUCT_CARD')),
    content TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS banners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    image_url TEXT NOT NULL,
    title TEXT DEFAULT '',
    link_type TEXT DEFAULT 'NONE',
    link_value TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0,
    status INTEGER DEFAULT 1,
    click_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    type TEXT DEFAULT 'NORMAL',
    priority INTEGER DEFAULT 0,
    status INTEGER DEFAULT 1,
    read_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    type TEXT NOT NULL CHECK(type IN ('RECHARGE','PAY','REFUND','WITHDRAW','COMMISSION','BONUS','PENALTY')),
    amount REAL NOT NULL,
    balance_before REAL DEFAULT 0,
    balance_after REAL DEFAULT 0,
    order_id INTEGER,
    remark TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER REFERENCES players(id),
    amount REAL NOT NULL,
    fee REAL DEFAULT 0,
    actual_amount REAL NOT NULL,
    bank_name TEXT DEFAULT '',
    bank_account TEXT DEFAULT '',
    status TEXT DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED','PAID')),
    reject_reason TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    processed_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS configs (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    type TEXT DEFAULT 'STRING',
    remark TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    user_type TEXT DEFAULT 'SYSTEM',
    action TEXT NOT NULL,
    target_type TEXT DEFAULT '',
    target_id INTEGER,
    detail TEXT DEFAULT '',
    ip_address TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sms_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,
    code TEXT NOT NULL,
    type TEXT DEFAULT 'LOGIN',
    used INTEGER DEFAULT 0,
    expire_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS invite_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inviter_id INTEGER REFERENCES users(id),
    invitee_id INTEGER REFERENCES users(id),
    invite_code TEXT NOT NULL,
    commission REAL DEFAULT 0,
    status INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- 索引
  CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
  CREATE INDEX IF NOT EXISTS idx_orders_player ON orders(player_id);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(order_status);
  CREATE INDEX IF NOT EXISTS idx_orders_no ON orders(order_no);
  CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
  CREATE INDEX IF NOT EXISTS idx_products_hot ON products(hot, sort_order);
  CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_timeline_order ON order_timeline(order_id, created_at);
`);

// ── 初始化默认数据 ───────────────────────────────────────
function initDefaultData() {
  const adminCount = db.prepare('SELECT COUNT(*) as c FROM admins').get().c;
  if (adminCount === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    const kefuHash = bcrypt.hashSync('kefu123', 10);
    db.prepare('INSERT INTO admins (username, password, nickname, role) VALUES (?,?,?,?)').run('admin', hash, '超级管理员', 'ADMIN');
    db.prepare('INSERT INTO admins (username, password, nickname, role) VALUES (?,?,?,?)').run('kefu', kefuHash, '客服小妹', 'CS');
  }

  const catCount = db.prepare('SELECT COUNT(*) as c FROM categories').get().c;
  if (catCount === 0) {
    const cats = [
      ['三角洲行动', '🎯', '#FF6B35', 0, 1],
      ['无畏契约', '🔫', '#4F46E5', 0, 2],
      ['王者荣耀', '👑', '#DC2626', 0, 3],
      ['和平精英', '🪖', '#059669', 0, 4],
    ];
    const ic = db.prepare('INSERT INTO categories (name, icon, color, parent_id, sort_order) VALUES (?,?,?,?,?)');
    cats.forEach(c => ic.run(...c));

    const subCats = [
      ['护航跑刀', '⚔️', '#FF6B35', 1, 1],
      ['代肝哈夫币', '💰', '#F59E0B', 1, 2],
      ['养号任务', '📋', '#8B5CF6', 1, 3],
      ['陪玩娱乐', '🎮', '#EC4899', 1, 4],
    ];
    subCats.forEach(c => ic.run(...c));

    const products = [
      [1,'三角洲护航 · 普通护航','安全高效，全程护航','专业打手全程护航，安全撤离保证收益',30,50,'局',0.7,1,1],
      [1,'三角洲护航 · 钻石护航','顶尖打手+语音陪玩','钻石级护航服务，顶尖打手+全程语音陪玩',68,100,'局',0.75,1,2],
      [5,'护航跑刀 · 极速版','30分钟速通','30分钟内完成一局，效率拉满',25,40,'局',0.7,1,3],
      [5,'护航跑刀 · 全图探索','收益最大化','全图搜刮+安全撤离，收益最大化',45,60,'局',0.7,0,4],
      [6,'哈夫币代肝 · 100万','保底100万','稳定挂机代肝，保底100万哈夫币',15,20,'次',0.65,1,5],
      [6,'哈夫币代肝 · 500万','超值套餐','大量代肝套餐，价格优惠',60,80,'次',0.65,0,6],
      [7,'每日任务代做','每日+周任务','每日任务+周任务全包，解放双手',20,30,'天',0.6,0,7],
      [8,'陪玩娱乐 · 语音陪玩','快乐游戏','甜美/搞笑语音陪玩，快乐游戏时光',35,50,'小时',0.8,1,8],
      [2,'无畏契约 · 上分护航','定级/排位赛','定级赛/排位赛全程护航，稳定上分',50,80,'局',0.7,1,9],
      [3,'王者荣耀 · 代练上分','星耀以下','星耀以下快速上分，胜率保证',20,35,'星',0.65,1,10],
    ];
    const ip = db.prepare(`INSERT INTO products (category_id,title,subtitle,desc,price,original_price,unit,player_commission_rate,hot,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)`);
    products.forEach(p => ip.run(...p));

    // 更新分类商品数
    db.prepare('UPDATE categories SET product_count = (SELECT COUNT(*) FROM products WHERE category_id = categories.id AND status = 1)').run();
  }

  const bannerCount = db.prepare('SELECT COUNT(*) as c FROM banners').get().c;
  if (bannerCount === 0) {
    const banners = [
      ['https://picsum.photos/seed/delta1/750/360','三角洲护航火热上线','NONE','',1,1],
      ['https://picsum.photos/seed/delta2/750/360','新用户首单立减','NONE','',2,1],
      ['https://picsum.photos/seed/delta3/750/360','接单员招募中','NONE','',3,1],
    ];
    const ib = db.prepare('INSERT INTO banners (image_url,title,link_type,link_value,sort_order,status) VALUES (?,?,?,?,?,?)');
    banners.forEach(b => ib.run(...b));
  }

  const annCount = db.prepare('SELECT COUNT(*) as c FROM announcements').get().c;
  if (annCount === 0) {
    db.prepare('INSERT INTO announcements (title,content,type,priority) VALUES (?,?,?,?)').run(
      '欢迎使用三角洲护航平台','平台提供专业的游戏代练护航服务，所有接单员均经过严格审核。如有问题请联系在线客服。','IMPORTANT',1
    );
  }

  const configDefaults = {
    platform_name: ['三角洲护航','STRING','平台名称'],
    platform_fee_rate: ['0.3','NUMBER','平台抽成比例'],
    min_withdraw: ['50','NUMBER','最低提现金额'],
    withdraw_fee_rate: ['0.02','NUMBER','提现手续费率'],
    player_deposit: ['100','NUMBER','接单员押金'],
    max_concurrent_orders: ['3','NUMBER','最大并发接单数'],
    recharge_bonus_threshold: ['100','NUMBER','充值赠送门槛'],
    recharge_bonus_rate: ['0.05','NUMBER','充值赠送比例'],
    order_auto_cancel_minutes: ['30','NUMBER','未支付自动取消(分钟)'],
    review_required: ['0','NUMBER','完成后必须评价'],
  };
  const ic2 = db.prepare('INSERT OR IGNORE INTO configs (key,value,type,remark) VALUES (?,?,?,?)');
  Object.entries(configDefaults).forEach(([k, [v, t, r]]) => ic2.run(k, v, t, r));
}

initDefaultData();

// ── 初始化模块 ───────────────────────────────────────────
const sms = new SMSService(db, { enabled: false, provider: 'mock' });
const upload = new UploadService({ uploadPath: path.join(__dirname, 'uploads'), maxSize: 5 });
const health = new HealthCheck(db);
const backup = new BackupService(path.join(__dirname, 'delta.db'), path.join(__dirname, 'backups'));
const invite = new InviteService(db);
const aiService = new AICustomerService(db, { enabled: false, provider: 'keyword' });

// multer 配置
const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

// 启动自动备份（每24小时）
backup.startAutoBackup(24);

// 请求监控中间件
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    health.recordRequest(Date.now() - start, res.statusCode >= 500);
  });
  next();
});

// ── WebSocket 聊天 ───────────────────────────────────────
const wss = new WebSocketServer({ server, path: '/ws' });
const wsClients = new Map(); // userId -> ws

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const token = url.searchParams.get('token');
  if (!token) { ws.close(1008, '未认证'); return; }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    ws.userId = decoded.id;
    ws.userType = decoded.type;
    wsClients.set(decoded.id, ws);
    console.log(`[WS] ${decoded.type}#${decoded.id} 已连接`);

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        handleWSMessage(decoded, msg);
      } catch (e) { /* ignore */ }
    });

    ws.on('close', () => {
      wsClients.delete(decoded.id);
      console.log(`[WS] ${decoded.type}#${decoded.id} 已断开`);
    });
  } catch (e) { ws.close(1008, '认证失败'); }
});

function handleWSMessage(user, msg) {
  if (msg.type === 'chat' && msg.session_id && msg.content) {
    const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(msg.session_id);
    if (!session) return;

    db.prepare(`INSERT INTO chat_messages (session_id, sender_type, sender_id, sender_name, msg_type, content)
      VALUES (?, ?, ?, ?, 'TEXT', ?)`).run(msg.session_id, user.type.toUpperCase(), user.id, user.username || '', msg.content);
    db.prepare('UPDATE chat_sessions SET last_message = ?, last_message_at = CURRENT_TIMESTAMP, unread_count = unread_count + 1 WHERE id = ?')
      .run(msg.content.slice(0, 100), msg.session_id);

    // 推送给对方
    const targetId = user.type === 'user' ? (session.player_id || session.cs_id) : session.user_id;
    const targetWs = wsClients.get(targetId);
    if (targetWs && targetWs.readyState === 1) {
      targetWs.send(JSON.stringify({ type: 'new_message', session_id: msg.session_id, content: msg.content, sender: user.username }));
    }
  }

  if (msg.type === 'ping') {
    const ws = wsClients.get(user.id);
    if (ws) ws.send(JSON.stringify({ type: 'pong', time: Date.now() }));
  }
}

function notifyUser(userId, data) {
  const ws = wsClients.get(userId);
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(data));
  }
}

// ── 工具函数 ─────────────────────────────────────────────
function authMiddleware(roleTypes = []) {
  return (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ code: 401, msg: '请先登录' });
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
      if (roleTypes.length > 0 && !roleTypes.includes(decoded.role)) {
        return res.status(403).json({ code: 403, msg: '无权限访问' });
      }
      next();
    } catch (e) {
      return res.status(401).json({ code: 401, msg: '登录已过期，请重新登录' });
    }
  };
}

function genOrderNo() {
  const now = new Date();
  const d = now.toISOString().replace(/[-T:\.Z]/g, '').slice(0, 14);
  return 'D' + d + String(Math.floor(Math.random() * 10000)).padStart(4, '0');
}

function addTimeline(orderId, action, content, operatorType = 'SYSTEM', operatorId = null) {
  db.prepare('INSERT INTO order_timeline (order_id, action, content, operator_type, operator_id) VALUES (?,?,?,?,?)')
    .run(orderId, action, content, operatorType, operatorId);
}

function logActivity(userId, userType, action, targetType = '', targetId = null, detail = '', ip = '') {
  db.prepare('INSERT INTO activity_logs (user_id, user_type, action, target_type, target_id, detail, ip_address) VALUES (?,?,?,?,?,?,?)')
    .run(userId, userType, action, targetType, targetId, detail, ip);
}

function paginate(query, params, page = 1, limit = 20) {
  page = Math.max(1, Number(page));
  limit = Math.min(100, Math.max(1, Number(limit)));
  const offset = (page - 1) * limit;
  const countSql = query.replace(/SELECT .+? FROM/, 'SELECT COUNT(*) as total FROM').replace(/ORDER BY .+$/, '');
  const total = db.prepare(countSql).get(...params).total;
  const data = db.prepare(query + ' LIMIT ? OFFSET ?').all(...params, limit, offset);
  return { data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

// ══════════════════════════════════════════════════════════
//  API 路由
// ══════════════════════════════════════════════════════════

// ── 认证 ─────────────────────────────────────────────────
app.post('/api/admin/login', rateLimit(300000, 10), (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ code: 400, msg: '请输入用户名和密码' });

  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  if (!admin) return res.json({ code: 400, msg: '账号不存在' });
  if (admin.status !== 1) return res.json({ code: 400, msg: '账号已禁用' });
  if (admin.lock_time && new Date(admin.lock_time) > new Date()) {
    return res.json({ code: 400, msg: '账号已锁定，请30分钟后重试' });
  }

  if (!bcrypt.compareSync(password, admin.password)) {
    const count = admin.login_fail_count + 1;
    const lockTime = count >= 5 ? new Date(Date.now() + 30 * 60000).toISOString() : null;
    db.prepare('UPDATE admins SET login_fail_count = ?, lock_time = ? WHERE id = ?').run(count, lockTime, admin.id);
    return res.json({ code: 400, msg: `密码错误${count >= 5 ? '，账号已锁定30分钟' : `（还剩${5 - count}次机会）`}` });
  }

  db.prepare('UPDATE admins SET login_fail_count = 0, lock_time = NULL, last_login_at = CURRENT_TIMESTAMP, last_login_ip = ? WHERE id = ?').run(req.ip, admin.id);
  const token = jwt.sign({ id: admin.id, username: admin.username, role: admin.role, type: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
  logActivity(admin.id, 'admin', 'LOGIN', '', null, '', req.ip);
  res.json({ code: 0, data: { token, admin: { id: admin.id, username: admin.username, nickname: admin.nickname, role: admin.role, avatar: admin.avatar } } });
});

app.post('/api/user/login', rateLimit(60000, 10), async (req, res) => {
  const { phone, code, invite_code } = req.body;
  if (!phone) return res.json({ code: 400, msg: '请输入手机号' });
  if (!/^1\d{10}$/.test(phone)) return res.json({ code: 400, msg: '手机号格式不正确' });

  // 验证码校验
  const smsEnabled = db.prepare("SELECT value FROM configs WHERE key = 'sms_enabled'").get()?.value === '1';
  if (smsEnabled) {
    const verifyResult = sms.verify(phone, code, 'LOGIN');
    if (!verifyResult.valid) return res.json({ code: 400, msg: verifyResult.msg });
  } else {
    // 模拟模式：123456 或任意6位
    if (code !== '123456' && (!code || code.length !== 6)) return res.json({ code: 400, msg: '验证码错误' });
  }

  let user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  let isNew = false;
  if (!user) {
    const inviteCode = invite.generateCode();
    const result = db.prepare('INSERT INTO users (phone, nickname, invite_code) VALUES (?, ?, ?)').run(phone, '用户' + phone.slice(-4), inviteCode);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    isNew = true;

    // 处理邀请
    if (invite_code) {
      invite.processInvite(user.id, invite_code);
    }
  }
  db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
  const token = jwt.sign({ id: user.id, phone: user.phone, role: 'USER', type: 'user', username: user.nickname }, JWT_SECRET, { expiresIn: '30d' });
  logActivity(user.id, 'user', 'LOGIN', '', null, phone, req.ip);
  res.json({ code: 0, data: { token, user: { id: user.id, phone: user.phone, nickname: user.nickname, avatar: user.avatar, balance: user.balance, invite_code: user.invite_code }, isNew } });
});

// ── 公共接口 ─────────────────────────────────────────────
app.get('/api/banners', (req, res) => {
  res.json({ code: 0, data: db.prepare('SELECT * FROM banners WHERE status = 1 ORDER BY sort_order').all() });
});

app.get('/api/announcements', (req, res) => {
  res.json({ code: 0, data: db.prepare('SELECT * FROM announcements WHERE status = 1 ORDER BY priority DESC, created_at DESC LIMIT 10').all() });
});

app.get('/api/categories', (req, res) => {
  const { parent_id } = req.query;
  let sql = 'SELECT * FROM categories WHERE status = 1';
  const params = [];
  if (parent_id !== undefined) { sql += ' AND parent_id = ?'; params.push(parent_id); }
  sql += ' ORDER BY sort_order';
  res.json({ code: 0, data: db.prepare(sql).all(...params) });
});

app.get('/api/products', (req, res) => {
  const { category_id, hot, keyword, sort = 'sort_order', page = 1, limit = 20 } = req.query;
  let sql = 'SELECT p.*, c.name as category_name, c.icon as category_icon FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.status = 1';
  const params = [];

  if (category_id) {
    // 支持查父分类下的所有子分类商品
    const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(category_id);
    if (cat && cat.parent_id === 0) {
      const childIds = db.prepare('SELECT id FROM categories WHERE parent_id = ?').all(category_id).map(c => c.id);
      if (childIds.length > 0) {
        sql += ` AND p.category_id IN (${childIds.join(',')})`;
      } else {
        sql += ' AND p.category_id = ?';
        params.push(category_id);
      }
    } else {
      sql += ' AND p.category_id = ?';
      params.push(category_id);
    }
  }
  if (hot === '1') sql += ' AND p.hot = 1';
  if (keyword) { sql += ' AND (p.title LIKE ? OR p.subtitle LIKE ? OR p.desc LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`); }

  const sortMap = { sort_order: 'p.sort_order', price_asc: 'p.price', price_desc: 'p.price DESC', sales: 'p.sales DESC', new: 'p.created_at DESC' };
  sql += ` ORDER BY ${sortMap[sort] || 'p.sort_order'}`;

  const result = paginate(sql, params, page, limit);
  res.json({ code: 0, ...result });
});

app.get('/api/products/:id', (req, res) => {
  const product = db.prepare('SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id = ?').get(req.params.id);
  if (!product) return res.json({ code: 404, msg: '商品不存在' });
  // 推荐同类商品
  const related = db.prepare('SELECT id, title, subtitle, price, unit, cover FROM products WHERE category_id = ? AND id != ? AND status = 1 LIMIT 4').all(product.category_id, product.id);
  res.json({ code: 0, data: { ...product, related } });
});

// ── 用户端 API ───────────────────────────────────────────
app.get('/api/user/profile', authMiddleware(['USER']), (req, res) => {
  const user = db.prepare('SELECT id, phone, nickname, avatar, gender, balance, total_spent, order_count, created_at FROM users WHERE id = ?').get(req.user.id);
  res.json({ code: 0, data: user });
});

app.put('/api/user/profile', authMiddleware(['USER']), (req, res) => {
  const { nickname, avatar, gender } = req.body;
  const updates = []; const params = [];
  if (nickname) { updates.push('nickname = ?'); params.push(nickname); }
  if (avatar) { updates.push('avatar = ?'); params.push(avatar); }
  if (gender !== undefined) { updates.push('gender = ?'); params.push(gender); }
  if (updates.length === 0) return res.json({ code: 400, msg: '无更新内容' });
  params.push(req.user.id);
  db.prepare(`UPDATE users SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...params);
  res.json({ code: 0, msg: '更新成功' });
});

app.post('/api/orders', authMiddleware(['USER']), rateLimit(60000, 20), (req, res) => {
  const { product_id, quantity = 1, game_info = '', remark = '', assign_mode = 'GRAB' } = req.body;
  if (!product_id) return res.json({ code: 400, msg: '请选择商品' });
  if (quantity < 1 || quantity > 99) return res.json({ code: 400, msg: '数量无效' });

  const product = db.prepare('SELECT * FROM products WHERE id = ? AND status = 1').get(product_id);
  if (!product) return res.json({ code: 400, msg: '商品不存在或已下架' });

  const total = Math.round(product.price * quantity * 100) / 100;
  const orderNo = genOrderNo();

  const result = db.prepare(`INSERT INTO orders (order_no, user_id, product_id, product_title, product_cover, price, quantity, total_amount, assign_mode, game_info, remark, ip_address)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(orderNo, req.user.id, product_id, product.title, product.cover, product.price, quantity, total, assign_mode, game_info, remark, req.ip);

  addTimeline(result.lastInsertRowid, 'CREATED', '订单已创建');
  db.prepare('UPDATE users SET order_count = order_count + 1 WHERE id = ?').run(req.user.id);
  logActivity(req.user.id, 'user', 'CREATE_ORDER', 'order', result.lastInsertRowid, `商品: ${product.title}, 金额: ¥${total}`);

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(result.lastInsertRowid);
  res.json({ code: 0, data: order, msg: '下单成功' });
});

app.get('/api/user/orders', authMiddleware(['USER']), (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  let sql = 'SELECT o.*, p.cover as product_cover FROM orders o LEFT JOIN products p ON o.product_id = p.id WHERE o.user_id = ?';
  const params = [req.user.id];
  if (status) { sql += ' AND o.order_status = ?'; params.push(status); }
  sql += ' ORDER BY o.created_at DESC';
  res.json({ code: 0, ...paginate(sql, params, page, limit) });
});

app.get('/api/user/orders/:id', authMiddleware(['USER']), (req, res) => {
  const order = db.prepare('SELECT o.*, p.cover as product_cover, p.subtitle as product_subtitle FROM orders o LEFT JOIN products p ON o.product_id = p.id WHERE o.id = ? AND o.user_id = ?').get(req.params.id, req.user.id);
  if (!order) return res.json({ code: 404, msg: '订单不存在' });
  const timeline = db.prepare('SELECT * FROM order_timeline WHERE order_id = ? ORDER BY created_at').all(order.id);
  const player = order.player_id ? db.prepare('SELECT p.real_name, p.rating, p.total_orders, u.avatar, u.nickname FROM players p JOIN users u ON p.user_id = u.id WHERE p.id = ?').get(order.player_id) : null;
  res.json({ code: 0, data: { ...order, timeline, player } });
});

app.post('/api/orders/:id/pay', authMiddleware(['USER']), (req, res) => {
  const { pay_method = 'BALANCE' } = req.body;
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!order) return res.json({ code: 404, msg: '订单不存在' });
  if (order.order_status !== 'PENDING') return res.json({ code: 400, msg: '订单状态异常' });

  if (pay_method === 'BALANCE') {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (user.balance < order.total_amount) return res.json({ code: 400, msg: `余额不足（当前 ¥${user.balance.toFixed(2)}，需 ¥${order.total_amount.toFixed(2)}）` });
    const newBalance = Math.round((user.balance - order.total_amount) * 100) / 100;
    db.prepare('UPDATE users SET balance = ?, total_spent = total_spent + ? WHERE id = ?').run(newBalance, order.total_amount, req.user.id);
    db.prepare('INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, order_id, remark) VALUES (?,?,?,?,?,?,?)').run(
      req.user.id, 'PAY', -order.total_amount, user.balance, newBalance, order.id, `支付订单 ${order.order_no}`
    );
  }

  db.prepare("UPDATE orders SET order_status = 'PAID', pay_status = 1, pay_method = ?, pay_time = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(pay_method, order.id);
  addTimeline(order.id, 'PAID', `支付成功（${pay_method === 'BALANCE' ? '余额' : '微信'}）`, 'USER', req.user.id);
  db.prepare('UPDATE products SET sales = sales + ? WHERE id = ?').run(order.quantity, order.product_id);

  logActivity(req.user.id, 'user', 'PAY_ORDER', 'order', order.id, `订单 ${order.order_no} 支付 ¥${order.total_amount}`);

  // 抢单模式通知
  if (order.assign_mode === 'GRAB') {
    db.prepare("INSERT INTO announcements (title, content, type, priority) VALUES (?,?,?,?)").run(
      '新抢单通知', `新订单 ${order.order_no}: ${order.product_title}，金额 ¥${order.total_amount}`, 'ORDER', 2
    );
    // WebSocket 通知所有接单员
    for (const [userId, ws] of wsClients) {
      if (ws.userType === 'user') {
        ws.send(JSON.stringify({ type: 'new_order', order_no: order.order_no, title: order.product_title, amount: order.total_amount }));
      }
    }
  }

  res.json({ code: 0, msg: '支付成功', data: { order_status: 'PAID' } });
});

app.post('/api/orders/:id/cancel', authMiddleware(['USER']), (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!order) return res.json({ code: 404, msg: '订单不存在' });
  if (!['PENDING', 'PAID'].includes(order.order_status)) return res.json({ code: 400, msg: '当前状态不可取消' });

  if (order.pay_status === 1) {
    const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(req.user.id);
    const newBalance = Math.round((user.balance + order.total_amount) * 100) / 100;
    db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(newBalance, req.user.id);
    db.prepare('INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, order_id, remark) VALUES (?,?,?,?,?,?,?)').run(
      req.user.id, 'REFUND', order.total_amount, user.balance, newBalance, order.id, `取消退款 ${order.order_no}`
    );
  }

  db.prepare("UPDATE orders SET order_status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(order.id);
  addTimeline(order.id, 'CANCELLED', '用户取消订单', 'USER', req.user.id);
  res.json({ code: 0, msg: '订单已取消' });
});

app.post('/api/orders/:id/refund', authMiddleware(['USER']), (req, res) => {
  const { reason } = req.body;
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!order) return res.json({ code: 404, msg: '订单不存在' });
  if (!['PAID', 'ASSIGNED'].includes(order.order_status)) return res.json({ code: 400, msg: '当前状态不可退款' });

  db.prepare("UPDATE orders SET order_status = 'REFUNDING', refund_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(reason || '', order.id);
  addTimeline(order.id, 'REFUND_REQUEST', `申请退款：${reason || '无理由'}`, 'USER', req.user.id);
  res.json({ code: 0, msg: '退款申请已提交' });
});

app.post('/api/orders/:id/review', authMiddleware(['USER']), (req, res) => {
  const { score, content } = req.body;
  if (!score || score < 1 || score > 5) return res.json({ code: 400, msg: '评分1-5' });
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!order) return res.json({ code: 404, msg: '订单不存在' });
  if (order.order_status !== 'COMPLETED') return res.json({ code: 400, msg: '订单未完成' });

  db.prepare("UPDATE orders SET review_score = ?, review_content = ?, review_time = CURRENT_TIMESTAMP, order_status = 'REVIEWING', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(score, content || '', order.id);
  addTimeline(order.id, 'REVIEWED', `评分 ${score}/5：${content || '好评'}`, 'USER', req.user.id);

  // 更新接单员评分
  if (order.player_id) {
    const player = db.prepare('SELECT * FROM players WHERE id = ?').get(order.player_id);
    const newRatingCount = player.rating_count + 1;
    const newRating = Math.round(((player.rating * player.rating_count + score) / newRatingCount) * 10) / 10;
    db.prepare('UPDATE players SET rating = ?, rating_count = ? WHERE id = ?').run(newRating, newRatingCount, order.player_id);
  }

  res.json({ code: 0, msg: '评价成功' });
});

app.post('/api/user/recharge', authMiddleware(['USER']), (req, res) => {
  const { amount } = req.body;
  if (!amount || amount <= 0 || amount > 50000) return res.json({ code: 400, msg: '金额无效（1-50000）' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  let bonus = 0;
  const threshold = Number(db.prepare("SELECT value FROM configs WHERE key = 'recharge_bonus_threshold'").get()?.value || 100);
  const bonusRate = Number(db.prepare("SELECT value FROM configs WHERE key = 'recharge_bonus_rate'").get()?.value || 0.05);
  if (amount >= threshold) bonus = Math.round(amount * bonusRate * 100) / 100;

  const newBalance = Math.round((user.balance + amount + bonus) * 100) / 100;
  db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(newBalance, req.user.id);
  db.prepare('INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, remark) VALUES (?,?,?,?,?,?)').run(
    req.user.id, 'RECHARGE', amount, user.balance, newBalance, `充值 ¥${amount}${bonus > 0 ? ` (赠 ¥${bonus})` : ''}`
  );
  if (bonus > 0) {
    db.prepare('INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, remark) VALUES (?,?,?,?,?,?)').run(
      req.user.id, 'BONUS', bonus, newBalance - bonus, newBalance, `充值赠送`
    );
  }
  res.json({ code: 0, data: { balance: newBalance, bonus }, msg: `充值成功${bonus > 0 ? `，赠送 ¥${bonus}` : ''}` });
});

// ── 接单员 API ───────────────────────────────────────────
app.post('/api/player/apply', authMiddleware(['USER']), (req, res) => {
  const { real_name, game_names, skill_desc, game_rank } = req.body;
  if (!real_name) return res.json({ code: 400, msg: '请输入真实姓名' });

  const existing = db.prepare('SELECT * FROM players WHERE user_id = ?').get(req.user.id);
  if (existing) {
    if (existing.status === 'APPROVED') return res.json({ code: 400, msg: '你已是认证接单员' });
    if (existing.status === 'PENDING') return res.json({ code: 400, msg: '审核中，请耐心等待' });
    db.prepare('UPDATE players SET real_name=?, game_names=?, skill_desc=?, game_rank=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(
      real_name, game_names || '', skill_desc || '', game_rank || '', 'PENDING', req.user.id
    );
  } else {
    db.prepare('INSERT INTO players (user_id, real_name, game_names, skill_desc, game_rank) VALUES (?,?,?,?,?)').run(
      req.user.id, real_name, game_names || '', skill_desc || '', game_rank || ''
    );
  }
  logActivity(req.user.id, 'user', 'APPLY_PLAYER', 'player', null, `申请接单员：${real_name}`);
  res.json({ code: 0, msg: '申请已提交，等待管理员审核' });
});

app.get('/api/player/profile', authMiddleware(['USER']), (req, res) => {
  const player = db.prepare('SELECT p.*, u.nickname, u.phone, u.avatar as user_avatar, u.balance FROM players p JOIN users u ON p.user_id = u.id WHERE p.user_id = ?').get(req.user.id);
  if (!player) return res.json({ code: 404, msg: '未申请接单员' });
  res.json({ code: 0, data: player });
});

app.get('/api/player/grab-orders', authMiddleware(['USER']), (req, res) => {
  const player = db.prepare('SELECT * FROM players WHERE user_id = ? AND status = ?').get(req.user.id, 'APPROVED');
  if (!player) return res.json({ code: 403, msg: '非认证接单员' });
  if (player.active_orders >= player.max_concurrent) return res.json({ code: 0, data: [], msg: '接单数已达上限' });

  const orders = db.prepare(`
    SELECT o.*, u.nickname as user_nickname
    FROM orders o JOIN users u ON o.user_id = u.id
    WHERE o.order_status = 'PAID' AND o.assign_mode = 'GRAB' AND o.player_id IS NULL
    ORDER BY o.total_amount DESC LIMIT 50
  `).all();
  res.json({ code: 0, data: orders });
});

app.post('/api/player/grab/:orderId', authMiddleware(['USER']), (req, res) => {
  const player = db.prepare('SELECT * FROM players WHERE user_id = ? AND status = ?').get(req.user.id, 'APPROVED');
  if (!player) return res.json({ code: 403, msg: '非认证接单员' });
  if (player.active_orders >= player.max_concurrent) return res.json({ code: 400, msg: '接单数已达上限' });

  // 使用事务防止并发抢单
  const grabOrder = db.transaction(() => {
    const order = db.prepare("SELECT * FROM orders WHERE id = ? AND order_status = 'PAID' AND assign_mode = 'GRAB' AND player_id IS NULL").get(req.params.orderId);
    if (!order) return { error: '该单已被抢或不存在' };

    db.prepare("UPDATE orders SET player_id = ?, order_status = 'ASSIGNED', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(player.id, order.id);
    db.prepare('UPDATE players SET active_orders = active_orders + 1 WHERE id = ?').run(player.id);
    addTimeline(order.id, 'ASSIGNED', `接单员 ${player.real_name || player.game_names || '匿名'} 已接单`, 'PLAYER', player.id);

    // 通知用户
    notifyUser(order.user_id, { type: 'order_assigned', order_no: order.order_no, player_name: player.real_name });

    return { success: true, order };
  });

  const result = grabOrder();
  if (result.error) return res.json({ code: 400, msg: result.error });
  logActivity(req.user.id, 'player', 'GRAB_ORDER', 'order', result.order.id, `抢单 ${result.order.order_no}`);
  res.json({ code: 0, msg: '抢单成功！' });
});

app.get('/api/player/orders', authMiddleware(['USER']), (req, res) => {
  const player = db.prepare('SELECT * FROM players WHERE user_id = ?').get(req.user.id);
  if (!player) return res.json({ code: 403, msg: '非接单员' });

  const { status, page = 1, limit = 20 } = req.query;
  let sql = 'SELECT o.*, u.nickname as user_nickname, u.phone as user_phone FROM orders o JOIN users u ON o.user_id = u.id WHERE o.player_id = ?';
  const params = [player.id];
  if (status) { sql += ' AND o.order_status = ?'; params.push(status); }
  sql += ' ORDER BY o.created_at DESC';
  res.json({ code: 0, ...paginate(sql, params, page, limit) });
});

app.post('/api/player/orders/:id/progress', authMiddleware(['USER']), (req, res) => {
  const { progress } = req.body;
  if (!progress) return res.json({ code: 400, msg: '请输入进度描述' });
  const player = db.prepare('SELECT * FROM players WHERE user_id = ?').get(req.user.id);
  if (!player) return res.json({ code: 403, msg: '非接单员' });

  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND player_id = ?').get(req.params.id, player.id);
  if (!order) return res.json({ code: 404, msg: '订单不存在' });

  db.prepare("UPDATE orders SET progress = ?, progress_updated_at = CURRENT_TIMESTAMP, order_status = 'IN_PROGRESS', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(progress, order.id);
  addTimeline(order.id, 'PROGRESS', progress, 'PLAYER', player.id);
  notifyUser(order.user_id, { type: 'order_progress', order_no: order.order_no, progress });
  res.json({ code: 0, msg: '进度已更新' });
});

app.post('/api/player/orders/:id/complete', authMiddleware(['USER']), (req, res) => {
  const player = db.prepare('SELECT * FROM players WHERE user_id = ?').get(req.user.id);
  if (!player) return res.json({ code: 403, msg: '非接单员' });

  const order = db.prepare("SELECT * FROM orders WHERE id = ? AND player_id = ? AND order_status IN ('ASSIGNED','IN_PROGRESS')").get(req.params.id, player.id);
  if (!order) return res.json({ code: 404, msg: '订单不存在或状态异常' });

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(order.product_id);
  const commission = Math.round(order.total_amount * (product?.player_commission_rate || 0.7) * 100) / 100;
  const platformFee = Math.round((order.total_amount - commission) * 100) / 100;

  db.prepare("UPDATE orders SET order_status = 'COMPLETED', complete_time = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(order.id);
  db.prepare('UPDATE players SET active_orders = MAX(0, active_orders - 1), total_orders = total_orders + 1, total_income = total_income + ? WHERE id = ?').run(commission, player.id);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(player.user_id);
  const newBalance = Math.round((user.balance + commission) * 100) / 100;
  db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(newBalance, player.user_id);
  db.prepare('INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, order_id, remark) VALUES (?,?,?,?,?,?,?)').run(
    player.user_id, 'COMMISSION', commission, user.balance, newBalance, order.id, `订单 ${order.order_no} 佣金`
  );

  addTimeline(order.id, 'COMPLETED', '服务完成', 'PLAYER', player.id);
  notifyUser(order.user_id, { type: 'order_completed', order_no: order.order_no });
  logActivity(player.user_id, 'player', 'COMPLETE_ORDER', 'order', order.id, `完成订单 ${order.order_no}，佣金 ¥${commission}`);

  res.json({ code: 0, msg: '订单已完成', data: { commission, platformFee } });
});

app.post('/api/player/withdraw', authMiddleware(['USER']), (req, res) => {
  const { amount, bank_name = '', bank_account = '' } = req.body;
  if (!amount || amount <= 0) return res.json({ code: 400, msg: '金额无效' });

  const player = db.prepare('SELECT * FROM players WHERE user_id = ?').get(req.user.id);
  if (!player) return res.json({ code: 403, msg: '非接单员' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const minWithdraw = Number(db.prepare("SELECT value FROM configs WHERE key = 'min_withdraw'").get()?.value || 50);
  const feeRate = Number(db.prepare("SELECT value FROM configs WHERE key = 'withdraw_fee_rate'").get()?.value || 0.02);

  if (amount < minWithdraw) return res.json({ code: 400, msg: `最低提现 ¥${minWithdraw}` });
  if (amount > user.balance) return res.json({ code: 400, msg: `余额不足（当前 ¥${user.balance.toFixed(2)}）` });

  const fee = Math.ceil(amount * feeRate * 100) / 100;
  const actual = amount - fee;
  const newBalance = Math.round((user.balance - amount) * 100) / 100;

  db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(newBalance, req.user.id);
  db.prepare('INSERT INTO withdrawals (player_id, amount, fee, actual_amount, bank_name, bank_account) VALUES (?,?,?,?,?,?)').run(player.id, amount, fee, actual, bank_name, bank_account);
  db.prepare('INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, remark) VALUES (?,?,?,?,?,?)').run(
    req.user.id, 'WITHDRAW', -amount, user.balance, newBalance, `提现申请 ¥${amount}（手续费 ¥${fee}）`
  );

  logActivity(req.user.id, 'player', 'WITHDRAW', 'withdrawal', null, `申请提现 ¥${amount}`);
  res.json({ code: 0, msg: '提现申请已提交', data: { fee, actual } });
});

// 接单员统计
app.get('/api/player/stats', authMiddleware(['USER']), (req, res) => {
  const player = db.prepare('SELECT * FROM players WHERE user_id = ?').get(req.user.id);
  if (!player) return res.json({ code: 403, msg: '非接单员' });

  const todayOrders = db.prepare("SELECT COUNT(*) as c FROM orders WHERE player_id = ? AND DATE(complete_time) = DATE('now')").get(player.id).c;
  const todayIncome = db.prepare("SELECT COALESCE(SUM(amount), 0) as s FROM transactions WHERE user_id = ? AND type = 'COMMISSION' AND DATE(created_at) = DATE('now')").get(player.user_id).s;
  const weekIncome = db.prepare("SELECT COALESCE(SUM(amount), 0) as s FROM transactions WHERE user_id = ? AND type = 'COMMISSION' AND created_at >= datetime('now', '-7 days')").get(player.user_id).s;
  const monthIncome = db.prepare("SELECT COALESCE(SUM(amount), 0) as s FROM transactions WHERE user_id = ? AND type = 'COMMISSION' AND created_at >= datetime('now', '-30 days')").get(player.user_id).s;
  const avgRating = player.rating;
  const completionRate = player.total_orders > 0 ? Math.round((db.prepare("SELECT COUNT(*) as c FROM orders WHERE player_id = ? AND order_status IN ('COMPLETED','REVIEWING')").get(player.id).c / player.total_orders) * 100) : 100;

  res.json({ code: 0, data: { todayOrders, todayIncome, weekIncome, monthIncome, avgRating, completionRate, totalOrders: player.total_orders, totalIncome: player.total_income, activeOrders: player.active_orders } });
});

// ── 管理后台 API ─────────────────────────────────────────
app.get('/api/admin/dashboard', authMiddleware(['ADMIN', 'CS', 'BOTH']), (req, res) => {
  const { start_date, end_date } = req.query;
  let dateFilter = '';
  const dateParams = [];
  if (start_date) { dateFilter += ' AND created_at >= ?'; dateParams.push(start_date); }
  if (end_date) { dateFilter += ' AND created_at <= ?'; dateParams.push(end_date + ' 23:59:59'); }

  const stats = {
    totalUsers: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
    totalPlayers: db.prepare("SELECT COUNT(*) as c FROM players WHERE status = 'APPROVED'").get().c,
    totalOrders: db.prepare(`SELECT COUNT(*) as c FROM orders WHERE 1=1${dateFilter}`).get(...dateParams).c,
    todayOrders: db.prepare("SELECT COUNT(*) as c FROM orders WHERE DATE(created_at) = DATE('now')").get().c,
    totalRevenue: db.prepare(`SELECT COALESCE(SUM(total_amount), 0) as s FROM orders WHERE pay_status = 1${dateFilter}`).get(...dateParams).s,
    todayRevenue: db.prepare("SELECT COALESCE(SUM(total_amount), 0) as s FROM orders WHERE pay_status = 1 AND DATE(pay_time) = DATE('now')").get().s,
    pendingOrders: db.prepare("SELECT COUNT(*) as c FROM orders WHERE order_status = 'PAID'").get().c,
    activeOrders: db.prepare("SELECT COUNT(*) as c FROM orders WHERE order_status IN ('ASSIGNED','IN_PROGRESS')").get().c,
    completedOrders: db.prepare("SELECT COUNT(*) as c FROM orders WHERE order_status IN ('COMPLETED','REVIEWING')").get().c,
    pendingRefunds: db.prepare("SELECT COUNT(*) as c FROM orders WHERE order_status = 'REFUNDING'").get().c,
    pendingPlayers: db.prepare("SELECT COUNT(*) as c FROM players WHERE status = 'PENDING'").get().c,
    pendingWithdrawals: db.prepare("SELECT COUNT(*) as c FROM withdrawals WHERE status = 'PENDING'").get().c,
    onlinePlayers: db.prepare("SELECT COUNT(*) as c FROM players WHERE online_status = 1 AND status = 'APPROVED'").get().c,
    // 利润分析
    platformCommission: db.prepare(`SELECT COALESCE(SUM(total_amount - total_amount * COALESCE((SELECT player_commission_rate FROM products WHERE id = orders.product_id), 0.7)), 0) as s FROM orders WHERE order_status IN ('COMPLETED','REVIEWING')${dateFilter}`).get(...dateParams).s,
    playerCommission: db.prepare(`SELECT COALESCE(SUM(total_amount * COALESCE((SELECT player_commission_rate FROM products WHERE id = orders.product_id), 0.7)), 0) as s FROM orders WHERE order_status IN ('COMPLETED','REVIEWING')${dateFilter}`).get(...dateParams).s,
    totalWithdrawals: db.prepare(`SELECT COALESCE(SUM(amount), 0) as s FROM withdrawals WHERE status IN ('APPROVED','PAID')${dateFilter.replace('created_at','processed_at')}`).get(...dateParams).s,
    totalRecharges: db.prepare(`SELECT COALESCE(SUM(amount), 0) as s FROM transactions WHERE type = 'RECHARGE'${dateFilter}`).get(...dateParams).s,
  };

  // 最近7天收入趋势
  const revenueChart = db.prepare(`
    SELECT DATE(pay_time) as date, SUM(total_amount) as amount, COUNT(*) as count
    FROM orders WHERE pay_status = 1 AND pay_time >= datetime('now', '-7 days')
    GROUP BY DATE(pay_time) ORDER BY date
  `).all();

  // 最近订单
  const recentOrders = db.prepare(`
    SELECT o.*, u.nickname as user_nickname, p.real_name as player_name
    FROM orders o LEFT JOIN users u ON o.user_id = u.id LEFT JOIN players p ON o.player_id = p.id
    ORDER BY o.created_at DESC LIMIT 10
  `).all();

  // 热门商品
  const hotProducts = db.prepare(`SELECT title, sales, price, player_commission_rate FROM products WHERE status = 1 ORDER BY sales DESC LIMIT 5`).all();

  // 今日新增
  const todayNewUsers = db.prepare("SELECT COUNT(*) as c FROM users WHERE DATE(created_at) = DATE('now')").get().c;
  const todayNewPlayers = db.prepare("SELECT COUNT(*) as c FROM players WHERE DATE(created_at) = DATE('now')").get().c;

  res.json({ code: 0, data: { stats: { ...stats, todayNewUsers, todayNewPlayers }, revenueChart, recentOrders, hotProducts } });
});

// 管理员 - 订单管理
app.get('/api/admin/orders', authMiddleware(['ADMIN', 'CS', 'BOTH']), (req, res) => {
  const { status, keyword, assign_mode, page = 1, limit = 20 } = req.query;
  let sql = `SELECT o.*, u.nickname as user_nickname, u.phone as user_phone, p.real_name as player_name
    FROM orders o LEFT JOIN users u ON o.user_id = u.id LEFT JOIN players p ON o.player_id = p.id WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND o.order_status = ?'; params.push(status); }
  if (assign_mode) { sql += ' AND o.assign_mode = ?'; params.push(assign_mode); }
  if (keyword) { sql += ' AND (o.order_no LIKE ? OR o.product_title LIKE ? OR u.nickname LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`); }
  sql += ' ORDER BY o.created_at DESC';
  res.json({ code: 0, ...paginate(sql, params, page, limit) });
});

app.post('/api/admin/orders/:id/assign', authMiddleware(['ADMIN', 'CS', 'BOTH']), (req, res) => {
  const { player_id } = req.body;
  const order = db.prepare("SELECT * FROM orders WHERE id = ? AND order_status = 'PAID'").get(req.params.id);
  if (!order) return res.json({ code: 400, msg: '订单不存在或状态异常' });

  const player = db.prepare("SELECT * FROM players WHERE id = ? AND status = 'APPROVED'").get(player_id);
  if (!player) return res.json({ code: 400, msg: '接单员不存在或未审核' });
  if (player.active_orders >= player.max_concurrent) return res.json({ code: 400, msg: '该接单员已满单' });

  db.prepare("UPDATE orders SET player_id = ?, order_status = 'ASSIGNED', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(player_id, order.id);
  db.prepare('UPDATE players SET active_orders = active_orders + 1 WHERE id = ?').run(player_id);
  addTimeline(order.id, 'ASSIGNED', `管理员派单给 ${player.real_name}`, 'ADMIN', req.user.id);
  notifyUser(order.user_id, { type: 'order_assigned', order_no: order.order_no, player_name: player.real_name });
  logActivity(req.user.id, 'admin', 'ASSIGN_ORDER', 'order', order.id, `派单 ${order.order_no} -> ${player.real_name}`);
  res.json({ code: 0, msg: '派单成功' });
});

app.post('/api/admin/orders/:id/refund', authMiddleware(['ADMIN', 'BOTH']), (req, res) => {
  const { action, reason } = req.body;
  const order = db.prepare("SELECT * FROM orders WHERE id = ? AND order_status = 'REFUNDING'").get(req.params.id);
  if (!order) return res.json({ code: 400, msg: '订单不存在或非退款状态' });

  if (action === 'approve') {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(order.user_id);
    const newBalance = Math.round((user.balance + order.total_amount) * 100) / 100;
    db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(newBalance, order.user_id);
    db.prepare('INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, order_id, remark) VALUES (?,?,?,?,?,?,?)').run(
      order.user_id, 'REFUND', order.total_amount, user.balance, newBalance, order.id, `退款 ${order.order_no}`
    );
    db.prepare("UPDATE orders SET order_status = 'REFUNDED', refund_time = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(order.id);
    if (order.player_id) db.prepare('UPDATE players SET active_orders = MAX(0, active_orders - 1) WHERE id = ?').run(order.player_id);
    addTimeline(order.id, 'REFUNDED', '退款已批准', 'ADMIN', req.user.id);
    notifyUser(order.user_id, { type: 'order_refunded', order_no: order.order_no });
    res.json({ code: 0, msg: '退款成功' });
  } else {
    db.prepare("UPDATE orders SET order_status = 'PAID', refund_reason = '', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(order.id);
    addTimeline(order.id, 'REFUND_REJECTED', `退款被拒绝：${reason || '无理由'}`, 'ADMIN', req.user.id);
    res.json({ code: 0, msg: '退款已拒绝' });
  }
  logActivity(req.user.id, 'admin', action === 'approve' ? 'APPROVE_REFUND' : 'REJECT_REFUND', 'order', order.id, `订单 ${order.order_no}`);
});

// 管理员 - 接单员管理
app.get('/api/admin/players', authMiddleware(['ADMIN', 'BOTH']), (req, res) => {
  const { status, keyword, page = 1, limit = 20 } = req.query;
  let sql = `SELECT p.*, u.nickname, u.phone FROM players p JOIN users u ON p.user_id = u.id WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND p.status = ?'; params.push(status); }
  if (keyword) { sql += ' AND (p.real_name LIKE ? OR u.phone LIKE ? OR p.game_names LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`); }
  sql += ' ORDER BY p.created_at DESC';
  res.json({ code: 0, ...paginate(sql, params, page, limit) });
});

app.post('/api/admin/players/:id/review', authMiddleware(['ADMIN', 'BOTH']), (req, res) => {
  const { action, reason } = req.body;
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id);
  if (!player) return res.json({ code: 400, msg: '接单员不存在' });

  const status = action === 'approve' ? 'APPROVED' : 'REJECTED';
  db.prepare('UPDATE players SET status = ?, banned_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, reason || '', player.id);
  addTimeline(player.id, action === 'approve' ? 'PLAYER_APPROVED' : 'PLAYER_REJECTED', reason || '', 'ADMIN', req.user.id);
  notifyUser(player.user_id, { type: 'player_reviewed', status, reason });
  logActivity(req.user.id, 'admin', action === 'approve' ? 'APPROVE_PLAYER' : 'REJECT_PLAYER', 'player', player.id, `${player.real_name}`);
  res.json({ code: 0, msg: `已${action === 'approve' ? '通过' : '拒绝'}` });
});

// 管理员 - 用户管理
app.get('/api/admin/users', authMiddleware(['ADMIN', 'CS', 'BOTH']), (req, res) => {
  const { keyword, page = 1, limit = 20 } = req.query;
  let sql = 'SELECT id, phone, nickname, avatar, gender, balance, total_spent, order_count, status, last_login_at, created_at FROM users WHERE 1=1';
  const params = [];
  if (keyword) { sql += ' AND (phone LIKE ? OR nickname LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`); }
  sql += ' ORDER BY created_at DESC';
  res.json({ code: 0, ...paginate(sql, params, page, limit) });
});

// 管理员 - 商品管理
app.get('/api/admin/products', authMiddleware(['ADMIN', 'BOTH']), (req, res) => {
  const { keyword, category_id, page = 1, limit = 50 } = req.query;
  let sql = 'SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE 1=1';
  const params = [];
  if (keyword) { sql += ' AND (p.title LIKE ? OR p.subtitle LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`); }
  if (category_id) { sql += ' AND p.category_id = ?'; params.push(category_id); }
  sql += ' ORDER BY p.sort_order';
  res.json({ code: 0, ...paginate(sql, params, page, limit) });
});

app.post('/api/admin/products', authMiddleware(['ADMIN', 'BOTH']), (req, res) => {
  const { category_id, title, subtitle, desc, cover, price, original_price, unit, player_commission_rate, hot, new: isNew, sort_order } = req.body;
  if (!title || !price) return res.json({ code: 400, msg: '名称和价格必填' });
  const result = db.prepare(`INSERT INTO products (category_id,title,subtitle,desc,cover,price,original_price,unit,player_commission_rate,hot,new,sort_order)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(category_id, title, subtitle||'', desc||'', cover||'', price, original_price||0, unit||'局', player_commission_rate||0.7, hot||0, isNew||0, sort_order||0);
  db.prepare('UPDATE categories SET product_count = (SELECT COUNT(*) FROM products WHERE category_id = categories.id AND status = 1)').run();
  logActivity(req.user.id, 'admin', 'CREATE_PRODUCT', 'product', result.lastInsertRowid, title);
  res.json({ code: 0, msg: '添加成功' });
});

app.put('/api/admin/products/:id', authMiddleware(['ADMIN', 'BOTH']), (req, res) => {
  const fields = ['category_id','title','subtitle','desc','cover','price','original_price','unit','player_commission_rate','hot','new','sort_order','status'];
  const updates = []; const params = [];
  fields.forEach(f => { if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); } });
  if (updates.length === 0) return res.json({ code: 400, msg: '无更新内容' });
  params.push(req.params.id);
  db.prepare(`UPDATE products SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...params);
  db.prepare('UPDATE categories SET product_count = (SELECT COUNT(*) FROM products WHERE category_id = categories.id AND status = 1)').run();
  res.json({ code: 0, msg: '更新成功' });
});

// 管理员 - 分类管理
app.get('/api/admin/categories', authMiddleware(['ADMIN', 'BOTH']), (req, res) => {
  res.json({ code: 0, data: db.prepare('SELECT * FROM categories ORDER BY sort_order').all() });
});

app.post('/api/admin/categories', authMiddleware(['ADMIN', 'BOTH']), (req, res) => {
  const { name, icon, color, parent_id = 0, sort_order = 0 } = req.body;
  if (!name) return res.json({ code: 400, msg: '分类名称必填' });
  db.prepare('INSERT INTO categories (name, icon, color, parent_id, sort_order) VALUES (?,?,?,?,?)').run(name, icon||'', color||'#FF6B35', parent_id, sort_order);
  res.json({ code: 0, msg: '添加成功' });
});

app.put('/api/admin/categories/:id', authMiddleware(['ADMIN', 'BOTH']), (req, res) => {
  const { name, icon, color, sort_order, status } = req.body;
  db.prepare('UPDATE categories SET name=COALESCE(?,name), icon=COALESCE(?,icon), color=COALESCE(?,color), sort_order=COALESCE(?,sort_order), status=COALESCE(?,status) WHERE id = ?')
    .run(name, icon, color, sort_order, status, req.params.id);
  res.json({ code: 0, msg: '更新成功' });
});

// 管理员 - 轮播图
app.get('/api/admin/banners', authMiddleware(['ADMIN', 'BOTH']), (req, res) => {
  res.json({ code: 0, data: db.prepare('SELECT * FROM banners ORDER BY sort_order').all() });
});

app.post('/api/admin/banners', authMiddleware(['ADMIN', 'BOTH']), (req, res) => {
  const { image_url, title, link_type = 'NONE', link_value = '', sort_order = 0 } = req.body;
  if (!image_url) return res.json({ code: 400, msg: '图片URL必填' });
  db.prepare('INSERT INTO banners (image_url, title, link_type, link_value, sort_order) VALUES (?,?,?,?,?)').run(image_url, title||'', link_type, link_value, sort_order);
  res.json({ code: 0, msg: '添加成功' });
});

app.put('/api/admin/banners/:id', authMiddleware(['ADMIN', 'BOTH']), (req, res) => {
  const { image_url, title, link_type, link_value, sort_order, status } = req.body;
  db.prepare('UPDATE banners SET image_url=COALESCE(?,image_url), title=COALESCE(?,title), link_type=COALESCE(?,link_type), link_value=COALESCE(?,link_value), sort_order=COALESCE(?,sort_order), status=COALESCE(?,status) WHERE id=?')
    .run(image_url, title, link_type, link_value, sort_order, status, req.params.id);
  res.json({ code: 0, msg: '更新成功' });
});

app.delete('/api/admin/banners/:id', authMiddleware(['ADMIN', 'BOTH']), (req, res) => {
  db.prepare('DELETE FROM banners WHERE id = ?').run(req.params.id);
  res.json({ code: 0, msg: '已删除' });
});

// 管理员 - 公告
app.get('/api/admin/announcements', authMiddleware(['ADMIN', 'BOTH']), (req, res) => {
  res.json({ code: 0, data: db.prepare('SELECT * FROM announcements ORDER BY created_at DESC').all() });
});

app.post('/api/admin/announcements', authMiddleware(['ADMIN', 'BOTH']), (req, res) => {
  const { title, content, type = 'NORMAL', priority = 0 } = req.body;
  if (!title || !content) return res.json({ code: 400, msg: '标题和内容必填' });
  db.prepare('INSERT INTO announcements (title, content, type, priority) VALUES (?,?,?,?)').run(title, content, type, priority);
  res.json({ code: 0, msg: '发布成功' });
});

app.delete('/api/admin/announcements/:id', authMiddleware(['ADMIN', 'BOTH']), (req, res) => {
  db.prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id);
  res.json({ code: 0, msg: '已删除' });
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

app.post('/api/admin/withdrawals/:id/review', authMiddleware(['ADMIN', 'BOTH']), (req, res) => {
  const { action, reason } = req.body;
  const w = db.prepare('SELECT * FROM withdrawals WHERE id = ? AND status = ?').get(req.params.id, 'PENDING');
  if (!w) return res.json({ code: 400, msg: '记录不存在' });

  if (action === 'approve') {
    db.prepare("UPDATE withdrawals SET status = 'APPROVED', processed_at = CURRENT_TIMESTAMP WHERE id = ?").run(w.id);
  } else {
    const player = db.prepare('SELECT user_id FROM players WHERE id = ?').get(w.player_id);
    const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(player.user_id);
    db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(w.amount, player.user_id);
    db.prepare('INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, remark) VALUES (?,?,?,?,?,?)').run(
      player.user_id, 'REFUND', w.amount, user.balance, user.balance + w.amount, `提现被拒退款`
    );
    db.prepare("UPDATE withdrawals SET status = 'REJECTED', reject_reason = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?").run(reason || '', w.id);
  }
  logActivity(req.user.id, 'admin', action === 'approve' ? 'APPROVE_WITHDRAW' : 'REJECT_WITHDRAW', 'withdrawal', w.id, `¥${w.amount}`);
  res.json({ code: 0, msg: action === 'approve' ? '已批准' : '已拒绝' });
});

// 管理员 - 配置
app.get('/api/admin/configs', authMiddleware(['ADMIN', 'BOTH']), (req, res) => {
  res.json({ code: 0, data: db.prepare('SELECT * FROM configs').all() });
});

app.put('/api/admin/configs', authMiddleware(['ADMIN', 'BOTH']), (req, res) => {
  const { configs } = req.body;
  if (!Array.isArray(configs)) return res.json({ code: 400, msg: '参数错误' });
  const stmt = db.prepare('UPDATE configs SET value = ? WHERE key = ?');
  const updateMany = db.transaction((items) => { items.forEach(c => stmt.run(c.value, c.key)); });
  updateMany(configs);
  logActivity(req.user.id, 'admin', 'UPDATE_CONFIGS', '', null, JSON.stringify(configs.map(c => c.key)));
  res.json({ code: 0, msg: '配置已更新' });
});

// 管理员 - 活动日志
app.get('/api/admin/logs', authMiddleware(['ADMIN', 'BOTH']), (req, res) => {
  const { page = 1, limit = 50 } = req.query;
  const sql = 'SELECT * FROM activity_logs ORDER BY created_at DESC';
  res.json({ code: 0, ...paginate(sql, [], page, limit) });
});

// 管理员 - 批量操作
app.post('/api/admin/orders/batch', authMiddleware(['ADMIN', 'BOTH']), (req, res) => {
  const { action, order_ids, player_id } = req.body;
  if (!Array.isArray(order_ids) || !order_ids.length) return res.json({ code: 400, msg: '请选择订单' });

  const results = { success: 0, failed: 0, errors: [] };
  const process = db.transaction(() => {
    order_ids.forEach(id => {
      try {
        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
        if (!order) { results.failed++; results.errors.push(`${id}:不存在`); return; }

        if (action === 'assign' && player_id && order.order_status === 'PAID') {
          const player = db.prepare("SELECT * FROM players WHERE id = ? AND status = 'APPROVED'").get(player_id);
          if (player && player.active_orders < player.max_concurrent) {
            db.prepare("UPDATE orders SET player_id = ?, order_status = 'ASSIGNED', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(player_id, id);
            db.prepare('UPDATE players SET active_orders = active_orders + 1 WHERE id = ?').run(player_id);
            addTimeline(id, 'ASSIGNED', `批量派单给 ${player.real_name}`, 'ADMIN', req.user.id);
            results.success++;
          } else { results.failed++; results.errors.push(`${id}:接单员不可用`); }
        } else if (action === 'refund_approve' && order.order_status === 'REFUNDING') {
          const user = db.prepare('SELECT * FROM users WHERE id = ?').get(order.user_id);
          const newBalance = Math.round((user.balance + order.total_amount) * 100) / 100;
          db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(newBalance, order.user_id);
          db.prepare('INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, order_id, remark) VALUES (?,?,?,?,?,?,?)').run(
            order.user_id, 'REFUND', order.total_amount, user.balance, newBalance, order.id, `批量退款 ${order.order_no}`
          );
          db.prepare("UPDATE orders SET order_status = 'REFUNDED', refund_time = CURRENT_TIMESTAMP WHERE id = ?").run(id);
          if (order.player_id) db.prepare('UPDATE players SET active_orders = MAX(0, active_orders - 1) WHERE id = ?').run(order.player_id);
          addTimeline(id, 'REFUNDED', '批量退款批准', 'ADMIN', req.user.id);
          results.success++;
        } else if (action === 'cancel' && ['PENDING','PAID'].includes(order.order_status)) {
          if (order.pay_status === 1) {
            const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(order.user_id);
            db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(order.total_amount, order.user_id);
          }
          db.prepare("UPDATE orders SET order_status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
          results.success++;
        } else {
          results.failed++;
          results.errors.push(`${id}:状态不匹配`);
        }
      } catch (e) { results.failed++; results.errors.push(`${id}:${e.message}`); }
    });
  });
  process();
  logActivity(req.user.id, 'admin', `BATCH_${action.toUpperCase()}`, 'order', null, `${results.success}成功 ${results.failed}失败`);
  res.json({ code: 0, data: results, msg: `批量操作完成: ${results.success}成功, ${results.failed}失败` });
});

// 管理员 - 批量审核提现
app.post('/api/admin/withdrawals/batch', authMiddleware(['ADMIN', 'BOTH']), (req, res) => {
  const { action, ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.json({ code: 400, msg: '请选择记录' });
  let success = 0;
  ids.forEach(id => {
    const w = db.prepare("SELECT * FROM withdrawals WHERE id = ? AND status = 'PENDING'").get(id);
    if (!w) return;
    if (action === 'approve') {
      db.prepare("UPDATE withdrawals SET status = 'APPROVED', processed_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
      success++;
    } else if (action === 'reject') {
      const player = db.prepare('SELECT user_id FROM players WHERE id = ?').get(w.player_id);
      const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(player.user_id);
      db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(w.amount, player.user_id);
      db.prepare('INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, remark) VALUES (?,?,?,?,?,?)').run(
        player.user_id, 'REFUND', w.amount, user.balance, user.balance + w.amount, '批量拒绝退款'
      );
      db.prepare("UPDATE withdrawals SET status = 'REJECTED', processed_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
      success++;
    }
  });
  logActivity(req.user.id, 'admin', `BATCH_WITHDRAW_${action}`, 'withdrawal', null, `${success}条`);
  res.json({ code: 0, msg: `已处理 ${success} 条` });
});

// 管理员 - 接单员详情
app.get('/api/admin/players/:id/detail', authMiddleware(['ADMIN', 'CS', 'BOTH']), (req, res) => {
  const player = db.prepare('SELECT p.*, u.nickname, u.phone, u.balance, u.created_at as user_created FROM players p JOIN users u ON p.user_id = u.id WHERE p.id = ?').get(req.params.id);
  if (!player) return res.json({ code: 404, msg: '接单员不存在' });

  const recentOrders = db.prepare(`
    SELECT o.order_no, o.product_title, o.total_amount, o.order_status, o.review_score, o.created_at, o.complete_time,
           u.nickname as user_nickname
    FROM orders o JOIN users u ON o.user_id = u.id
    WHERE o.player_id = ? ORDER BY o.created_at DESC LIMIT 20
  `).all(player.id);

  const reviews = db.prepare(`
    SELECT o.review_score, o.review_content, o.review_time, u.nickname
    FROM orders o JOIN users u ON o.user_id = u.id
    WHERE o.player_id = ? AND o.review_score IS NOT NULL
    ORDER BY o.review_time DESC LIMIT 10
  `).all(player.id);

  const incomeChart = db.prepare(`
    SELECT DATE(created_at) as date, SUM(amount) as amount
    FROM transactions WHERE user_id = ? AND type = 'COMMISSION' AND created_at >= datetime('now', '-30 days')
    GROUP BY DATE(created_at) ORDER BY date
  `).all(player.user_id);

  const withdrawals = db.prepare('SELECT * FROM withdrawals WHERE player_id = ? ORDER BY created_at DESC LIMIT 10').all(player.id);

  res.json({ code: 0, data: { player, recentOrders, reviews, incomeChart, withdrawals } });
});

// 管理员 - 获取接单员列表(派单用)
app.get('/api/admin/players/available', authMiddleware(['ADMIN', 'CS', 'BOTH']), (req, res) => {
  const players = db.prepare(`
    SELECT p.id, p.real_name, p.rating, p.total_orders, p.active_orders, p.max_concurrent, p.game_names,
           u.nickname, u.avatar
    FROM players p JOIN users u ON p.user_id = u.id
    WHERE p.status = 'APPROVED'
    ORDER BY p.rating DESC, p.active_orders ASC
  `).all();
  res.json({ code: 0, data: players });
});

// 管理员 - 用户详情
app.get('/api/admin/users/:id/detail', authMiddleware(['ADMIN', 'CS', 'BOTH']), (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.json({ code: 404, msg: '用户不存在' });

  const orders = db.prepare(`
    SELECT o.order_no, o.product_title, o.total_amount, o.order_status, o.created_at
    FROM orders o WHERE o.user_id = ? ORDER BY o.created_at DESC LIMIT 20
  `).all(user.id);

  const transactions = db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').all(user.id);

  const player = db.prepare('SELECT * FROM players WHERE user_id = ?').get(user.id);

  res.json({ code: 0, data: { user, orders, transactions, player } });
});

// 管理员 - 全局搜索
app.get('/api/admin/search', authMiddleware(['ADMIN', 'CS', 'BOTH']), (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json({ code: 0, data: { orders: [], users: [], players: [] } });
  const like = `%${q}%`;
  const orders = db.prepare(`SELECT o.id, o.order_no, o.product_title, o.total_amount, o.order_status, u.nickname FROM orders o LEFT JOIN users u ON o.user_id = u.id WHERE o.order_no LIKE ? OR o.product_title LIKE ? OR u.nickname LIKE ? LIMIT 5`).all(like, like, like);
  const users = db.prepare('SELECT id, nickname, phone, balance FROM users WHERE phone LIKE ? OR nickname LIKE ? LIMIT 5').all(like, like);
  const players = db.prepare(`SELECT p.id, p.real_name, p.rating, p.status, u.phone FROM players p JOIN users u ON p.user_id = u.id WHERE p.real_name LIKE ? OR u.phone LIKE ? OR p.game_names LIKE ? LIMIT 5`).all(like, like, like);
  res.json({ code: 0, data: { orders, users, players } });
});

// ── 短信验证码 ───────────────────────────────────────────
app.post('/api/sms/send', rateLimit(60000, 5), async (req, res) => {
  const { phone, type = 'LOGIN' } = req.body;
  if (!phone || !/^1\d{10}$/.test(phone)) return res.json({ code: 400, msg: '手机号格式不正确' });
  const result = await sms.send(phone, type);
  res.json({ code: result.success ? 0 : 400, msg: result.msg, data: result.code ? { testCode: result.code } : undefined });
});

// ── 文件上传 ─────────────────────────────────────────────
app.post('/api/upload/:category', authMiddleware(['USER', 'ADMIN', 'CS', 'BOTH']), uploadMiddleware.single('file'), async (req, res) => {
  if (!req.file) return res.json({ code: 400, msg: '请选择文件' });
  const category = req.params.category || 'temp';
  const allowedCategories = ['avatars', 'products', 'banners', 'chat', 'temp'];
  if (!allowedCategories.includes(category)) return res.json({ code: 400, msg: '无效分类' });
  const result = await upload.upload(req.file, category);
  res.json(result);
});

// 静态文件服务（上传文件）
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── API 文档 ─────────────────────────────────────────────
app.get('/api/docs', (req, res) => {
  const spec = require('./docs/swagger.json');
  res.json(spec);
});
app.get('/docs', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>API 文档</title><link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"></head><body><div id="swagger-ui"></div><script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script><script>SwaggerUIBundle({url:'/api/docs',dom_id:'#swagger-ui'})</script></body></html>`);
});

// ── AI 客服 ──────────────────────────────────────────────
app.post('/api/chat/ai', authMiddleware(['USER']), async (req, res) => {
  const { message } = req.body;
  if (!message) return res.json({ code: 400, msg: '请输入消息' });
  const reply = await aiService.chat(null, req.user.id, message);
  res.json({ code: 0, data: { reply } });
});

// ── 健康检查 ─────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json(health.check()));
app.get('/api/alive', (req, res) => res.json(health.alive()));

// ── 备份管理 ─────────────────────────────────────────────
app.get('/api/admin/backups', authMiddleware(['ADMIN']), (req, res) => {
  res.json({ code: 0, data: backup.list() });
});

app.post('/api/admin/backups', authMiddleware(['ADMIN']), (req, res) => {
  const result = backup.backup();
  res.json({ code: result.success ? 0 : 500, msg: result.success ? '备份成功' : result.error, data: result });
});

// ── 邀请/分销系统 ────────────────────────────────────────
app.get('/api/user/invite', authMiddleware(['USER']), (req, res) => {
  const stats = invite.getStats(req.user.id);
  res.json({ code: 0, data: stats });
});

app.post('/api/user/invite/init', authMiddleware(['USER']), (req, res) => {
  const code = invite.initUser(req.user.id);
  res.json({ code: 0, data: { inviteCode: code } });
});

// ── RBAC 权限管理 ────────────────────────────────────────
app.get('/api/admin/permissions', authMiddleware(['ADMIN']), (req, res) => {
  res.json({ code: 0, data: { permissions: getAllPermissions(), roles: getAllRoles() } });
});

// ── 管理后台 API (带权限控制) ────────────────────────────
// 示例：订单管理需要 order:view 权限
// app.get('/api/admin/orders', authMiddleware(['ADMIN', 'CS', 'BOTH']), requirePermission('order:view'), (req, res) => { ... });

// ── 聊天 API ─────────────────────────────────────────────
// 获取或创建聊天会话
app.post('/api/chat/session', authMiddleware(['USER']), (req, res) => {
  const { target_type, target_id, order_id } = req.body; // target_type: PLAYER/CS
  const userId = req.user.id;
  let session;

  if (target_type === 'CS') {
    // 找客服
    const cs = db.prepare("SELECT id FROM admins WHERE role IN ('CS','BOTH') AND status = 1 LIMIT 1").get();
    if (!cs) return res.json({ code: 400, msg: '暂无在线客服' });
    const id1 = Math.min(userId, cs.id + 100000);
    const id2 = Math.max(userId, cs.id + 100000);
    session = db.prepare('SELECT * FROM chat_sessions WHERE id1 = ? AND id2 = ? AND session_type = ?').get(id1, id2, 'USER_CS');
    if (!session) {
      const r = db.prepare('INSERT INTO chat_sessions (user_id, cs_id, session_type, id1, id2) VALUES (?,?,?,?,?)').run(userId, cs.id, 'USER_CS', id1, id2);
      session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(r.lastInsertRowid);
    }
  } else if (target_type === 'PLAYER' && target_id) {
    const player = db.prepare('SELECT user_id FROM players WHERE id = ?').get(target_id);
    if (!player) return res.json({ code: 400, msg: '接单员不存在' });
    const id1 = Math.min(userId, player.user_id);
    const id2 = Math.max(userId, player.user_id);
    session = db.prepare('SELECT * FROM chat_sessions WHERE id1 = ? AND id2 = ?').get(id1, id2);
    if (!session) {
      const r = db.prepare('INSERT INTO chat_sessions (user_id, player_id, session_type, id1, id2, order_id) VALUES (?,?,?,?,?,?)').run(userId, target_id, 'USER_PLAYER', id1, id2, order_id || null);
      session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(r.lastInsertRowid);
    }
  }
  if (!session) return res.json({ code: 400, msg: '参数错误' });
  res.json({ code: 0, data: session });
});

// 获取会话列表
app.get('/api/chat/sessions', authMiddleware(['USER']), (req, res) => {
  const userId = req.user.id;
  const sessions = db.prepare(`
    SELECT cs.*, 
      CASE WHEN cs.session_type = 'USER_CS' THEN '在线客服'
           ELSE p.real_name END as target_name,
      (SELECT COUNT(*) FROM chat_messages WHERE session_id = cs.id AND is_read = 0 AND sender_id != ?) as unread
    FROM chat_sessions cs
    LEFT JOIN players p ON cs.player_id = p.id
    WHERE cs.user_id = ? OR cs.player_id IN (SELECT id FROM players WHERE user_id = ?)
    ORDER BY cs.last_message_at DESC
  `).all(userId, userId, userId);
  res.json({ code: 0, data: sessions });
});

// 获取消息
app.get('/api/chat/messages/:sessionId', authMiddleware(['USER']), (req, res) => {
  const { before, limit = 50 } = req.query;
  let sql = 'SELECT * FROM chat_messages WHERE session_id = ?';
  const params = [req.params.sessionId];
  if (before) { sql += ' AND id < ?'; params.push(before); }
  sql += ' ORDER BY id DESC LIMIT ?';
  params.push(Number(limit));
  const messages = db.prepare(sql).all(...params).reverse();
  // 标记已读
  db.prepare('UPDATE chat_messages SET is_read = 1 WHERE session_id = ? AND sender_id != ? AND is_read = 0').run(req.params.sessionId, req.user.id);
  db.prepare('UPDATE chat_sessions SET unread_count = 0 WHERE id = ?').run(req.params.sessionId);
  res.json({ code: 0, data: messages });
});

// 发送消息
app.post('/api/chat/send', authMiddleware(['USER']), (req, res) => {
  const { session_id, content, msg_type = 'TEXT' } = req.body;
  if (!session_id || !content) return res.json({ code: 400, msg: '参数不完整' });
  const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(session_id);
  if (!session) return res.json({ code: 404, msg: '会话不存在' });

  const r = db.prepare('INSERT INTO chat_messages (session_id, sender_type, sender_id, sender_name, msg_type, content) VALUES (?,?,?,?,?,?)').run(
    session_id, req.user.type === 'user' ? 'USER' : 'PLAYER', req.user.id, req.user.username || '', msg_type, content
  );
  db.prepare('UPDATE chat_sessions SET last_message = ?, last_message_at = CURRENT_TIMESTAMP, unread_count = unread_count + 1 WHERE id = ?').run(content.slice(0, 100), session_id);

  // WebSocket 通知
  const targetId = session.user_id === req.user.id ? (session.player_id ? db.prepare('SELECT user_id FROM players WHERE id = ?').get(session.player_id)?.user_id : session.cs_id + 100000) : session.user_id;
  notifyUser(targetId, { type: 'new_chat_message', session_id, content, sender: req.user.username });

  res.json({ code: 0, data: { id: r.lastInsertRowid } });
});

// ── 数据导出 API ─────────────────────────────────────────
function toCsv(headers, rows) {
  const escape = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  return '\uFEFF' + headers.join(',') + '\n' + rows.map(r => r.map(escape).join(',')).join('\n');
}

app.get('/api/admin/export/orders', authMiddleware(['ADMIN', 'BOTH']), (req, res) => {
  const { status, start_date, end_date } = req.query;
  let sql = 'SELECT o.order_no, o.product_title, u.nickname as user, u.phone, p.real_name as player, o.price, o.quantity, o.total_amount, o.pay_method, o.order_status, o.created_at, o.pay_time, o.complete_time FROM orders o LEFT JOIN users u ON o.user_id = u.id LEFT JOIN players p ON o.player_id = p.id WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND o.order_status = ?'; params.push(status); }
  if (start_date) { sql += ' AND o.created_at >= ?'; params.push(start_date); }
  if (end_date) { sql += ' AND o.created_at <= ?'; params.push(end_date + ' 23:59:59'); }
  sql += ' ORDER BY o.created_at DESC';
  const orders = db.prepare(sql).all(...params);
  const headers = ['订单号','商品','用户','手机号','接单员','单价','数量','总额','支付方式','状态','创建时间','支付时间','完成时间'];
  const csv = toCsv(headers, orders.map(o => [o.order_no,o.product_title,o.user,o.phone,o.player,o.price,o.quantity,o.total_amount,o.pay_method,o.order_status,o.created_at,o.pay_time,o.complete_time]));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=orders.csv');
  res.send(csv);
});

app.get('/api/admin/export/users', authMiddleware(['ADMIN', 'BOTH']), (req, res) => {
  const users = db.prepare('SELECT id, phone, nickname, balance, total_spent, order_count, last_login_at, created_at FROM users ORDER BY created_at DESC').all();
  const headers = ['ID','手机号','昵称','余额','累计消费','订单数','最后登录','注册时间'];
  const csv = toCsv(headers, users.map(u => [u.id,u.phone,u.nickname,u.balance,u.total_spent,u.order_count,u.last_login_at,u.created_at]));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
  res.send(csv);
});

app.get('/api/admin/export/transactions', authMiddleware(['ADMIN', 'BOTH']), (req, res) => {
  const txns = db.prepare(`SELECT t.*, u.phone, u.nickname FROM transactions t JOIN users u ON t.user_id = u.id ORDER BY t.created_at DESC`).all();
  const headers = ['ID','手机号','昵称','类型','金额','余额前','余额后','关联订单','备注','时间'];
  const csv = toCsv(headers, txns.map(t => [t.id,t.phone,t.nickname,t.type,t.amount,t.balance_before,t.balance_after,t.order_id,t.remark,t.created_at]));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=transactions.csv');
  res.send(csv);
});

// ── PWA 图标 (SVG) ───────────────────────────────────────
app.get('/icon-192.png', (req, res) => res.sendFile(path.join(__dirname, 'public', 'icon-192.svg')));
app.get('/icon-512.png', (req, res) => res.sendFile(path.join(__dirname, 'public', 'icon-192.svg')));

// ── 前端路由 ─────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/player', (req, res) => res.sendFile(path.join(__dirname, 'public', 'player.html')));

// 404
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ code: 404, msg: '接口不存在' });
  next();
});

// 全局错误处理
app.use((err, req, res, next) => {
  console.error('\x1b[31m[ERROR]\x1b[0m', err.message);
  res.status(500).json({ code: 500, msg: '服务器内部错误' });
});

// ── 启动 ─────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\x1b[36m╔══════════════════════════════════════════╗\x1b[0m`);
  console.log(`\x1b[36m║\x1b[0m  🎮 三角洲护航 SaaS 系统                \x1b[36m║\x1b[0m`);
  console.log(`\x1b[36m╠══════════════════════════════════════════╣\x1b[0m`);
  console.log(`\x1b[36m║\x1b[0m  用户端:     http://localhost:${PORT}       \x1b[36m║\x1b[0m`);
  console.log(`\x1b[36m║\x1b[0m  管理后台:   http://localhost:${PORT}/admin  \x1b[36m║\x1b[0m`);
  console.log(`\x1b[36m║\x1b[0m  接单员端:   http://localhost:${PORT}/player \x1b[36m║\x1b[0m`);
  console.log(`\x1b[36m║\x1b[0m  WebSocket:  ws://localhost:${PORT}/ws      \x1b[36m║\x1b[0m`);
  console.log(`\x1b[36m╚══════════════════════════════════════════╝\x1b[0m`);
});
