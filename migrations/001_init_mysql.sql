-- ═══════════════════════════════════════════════════════
-- 三角洲护航 SaaS — MySQL 迁移脚本
-- 从 SQLite 迁移到 MySQL 8.0+
-- ═══════════════════════════════════════════════════════

CREATE DATABASE IF NOT EXISTS delta_escort 
  DEFAULT CHARACTER SET utf8mb4 
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE delta_escort;

-- 管理员表
CREATE TABLE IF NOT EXISTS admins (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(64) NOT NULL UNIQUE,
  password VARCHAR(128) NOT NULL,
  nickname VARCHAR(64) DEFAULT '',
  avatar VARCHAR(512) DEFAULT '',
  role ENUM('ADMIN','CS','BOTH') NOT NULL DEFAULT 'CS',
  phone VARCHAR(20) DEFAULT '',
  permissions JSON DEFAULT NULL COMMENT '细粒度权限',
  status TINYINT DEFAULT 1,
  login_fail_count INT DEFAULT 0,
  lock_time DATETIME DEFAULT NULL,
  last_login_at DATETIME DEFAULT NULL,
  last_login_ip VARCHAR(64) DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_status (status)
) ENGINE=InnoDB;

-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  openid VARCHAR(128) DEFAULT NULL UNIQUE,
  phone VARCHAR(20) DEFAULT NULL UNIQUE,
  nickname VARCHAR(64) DEFAULT '用户',
  avatar VARCHAR(512) DEFAULT '',
  gender TINYINT DEFAULT 0 COMMENT '0未知 1男 2女',
  balance DECIMAL(12,2) DEFAULT 0.00,
  total_spent DECIMAL(12,2) DEFAULT 0.00,
  order_count INT DEFAULT 0,
  invite_code VARCHAR(20) DEFAULT NULL UNIQUE COMMENT '邀请码',
  invited_by BIGINT DEFAULT NULL COMMENT '邀请人ID',
  status TINYINT DEFAULT 1,
  last_login_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_phone (phone),
  INDEX idx_invite (invite_code),
  INDEX idx_status (status)
) ENGINE=InnoDB;

-- 接单员表
CREATE TABLE IF NOT EXISTS players (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  real_name VARCHAR(64) DEFAULT '',
  id_card VARCHAR(20) DEFAULT '',
  game_names VARCHAR(256) DEFAULT '',
  skill_desc TEXT DEFAULT NULL,
  game_rank VARCHAR(64) DEFAULT '',
  deposit DECIMAL(10,2) DEFAULT 0,
  online_status TINYINT DEFAULT 0,
  max_concurrent INT DEFAULT 3,
  active_orders INT DEFAULT 0,
  rating DECIMAL(3,1) DEFAULT 5.0,
  rating_count INT DEFAULT 0,
  total_orders INT DEFAULT 0,
  total_income DECIMAL(12,2) DEFAULT 0,
  completion_rate DECIMAL(5,2) DEFAULT 100.00,
  avg_complete_time DECIMAL(10,2) DEFAULT 0,
  status ENUM('PENDING','APPROVED','REJECTED','BANNED') DEFAULT 'PENDING',
  banned_reason VARCHAR(256) DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_user (user_id),
  INDEX idx_status (status),
  INDEX idx_rating (rating DESC)
) ENGINE=InnoDB;

-- 分类表
CREATE TABLE IF NOT EXISTS categories (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  icon VARCHAR(64) DEFAULT '',
  color VARCHAR(20) DEFAULT '#FF6B35',
  parent_id BIGINT DEFAULT 0,
  sort_order INT DEFAULT 0,
  status TINYINT DEFAULT 1,
  product_count INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_parent (parent_id),
  INDEX idx_sort (sort_order)
) ENGINE=InnoDB;

-- 商品表
CREATE TABLE IF NOT EXISTS products (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  category_id BIGINT DEFAULT NULL,
  title VARCHAR(128) NOT NULL,
  subtitle VARCHAR(256) DEFAULT '',
  `desc` TEXT DEFAULT NULL,
  cover VARCHAR(512) DEFAULT '',
  images JSON DEFAULT NULL,
  price DECIMAL(10,2) NOT NULL,
  original_price DECIMAL(10,2) DEFAULT 0,
  unit VARCHAR(20) DEFAULT '局',
  player_commission_rate DECIMAL(4,2) DEFAULT 0.70,
  min_quantity INT DEFAULT 1,
  max_quantity INT DEFAULT 99,
  hot TINYINT DEFAULT 0,
  `new` TINYINT DEFAULT 0,
  sales INT DEFAULT 0,
  sort_order INT DEFAULT 0,
  status TINYINT DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id),
  INDEX idx_category (category_id),
  INDEX idx_hot (hot, sort_order),
  INDEX idx_sales (sales DESC),
  FULLTEXT INDEX ft_search (title, subtitle, `desc`)
) ENGINE=InnoDB;

-- 订单表
CREATE TABLE IF NOT EXISTS orders (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  order_no VARCHAR(32) NOT NULL UNIQUE,
  user_id BIGINT NOT NULL,
  player_id BIGINT DEFAULT NULL,
  product_id BIGINT DEFAULT NULL,
  product_title VARCHAR(128) DEFAULT '',
  product_cover VARCHAR(512) DEFAULT '',
  price DECIMAL(10,2) NOT NULL,
  quantity INT DEFAULT 1,
  total_amount DECIMAL(12,2) NOT NULL,
  pay_method ENUM('WECHAT','BALANCE','ALIPAY') DEFAULT 'WECHAT',
  pay_status TINYINT DEFAULT 0,
  pay_time DATETIME DEFAULT NULL,
  order_status ENUM('PENDING','PAID','ASSIGNED','IN_PROGRESS','COMPLETED','REVIEWING','REFUNDING','REFUNDED','CANCELLED','DISPUTE') DEFAULT 'PENDING',
  assign_mode ENUM('MANUAL','SELECT','GRAB','TEAM') DEFAULT 'GRAB',
  game_info VARCHAR(512) DEFAULT '',
  remark VARCHAR(512) DEFAULT '',
  progress VARCHAR(512) DEFAULT '',
  progress_updated_at DATETIME DEFAULT NULL,
  complete_time DATETIME DEFAULT NULL,
  review_score TINYINT DEFAULT NULL,
  review_content VARCHAR(512) DEFAULT '',
  review_time DATETIME DEFAULT NULL,
  refund_reason VARCHAR(512) DEFAULT '',
  refund_time DATETIME DEFAULT NULL,
  dispute_reason VARCHAR(512) DEFAULT '',
  dispute_time DATETIME DEFAULT NULL,
  ip_address VARCHAR(64) DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (player_id) REFERENCES players(id),
  FOREIGN KEY (product_id) REFERENCES products(id),
  INDEX idx_user (user_id),
  INDEX idx_player (player_id),
  INDEX idx_status (order_status),
  INDEX idx_no (order_no),
  INDEX idx_created (created_at DESC),
  INDEX idx_pay_time (pay_time)
) ENGINE=InnoDB;

-- 订单时间线
CREATE TABLE IF NOT EXISTS order_timeline (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT NOT NULL,
  action VARCHAR(32) NOT NULL,
  content VARCHAR(512) DEFAULT '',
  operator_type ENUM('SYSTEM','USER','PLAYER','CS','ADMIN') DEFAULT 'SYSTEM',
  operator_id BIGINT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id),
  INDEX idx_order (order_id, created_at)
) ENGINE=InnoDB;

-- 聊天会话
CREATE TABLE IF NOT EXISTS chat_sessions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT DEFAULT NULL,
  player_id BIGINT DEFAULT NULL,
  cs_id BIGINT DEFAULT NULL,
  order_id BIGINT DEFAULT NULL,
  session_type ENUM('USER_PLAYER','USER_CS','ORDER') DEFAULT 'USER_PLAYER',
  id1 BIGINT DEFAULT 0,
  id2 BIGINT DEFAULT 0,
  status VARCHAR(20) DEFAULT 'ACTIVE',
  last_message VARCHAR(256) DEFAULT '',
  last_message_at DATETIME DEFAULT NULL,
  unread_count INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_id1_id2 (id1, id2, session_type),
  INDEX idx_user (user_id),
  INDEX idx_last_msg (last_message_at DESC)
) ENGINE=InnoDB;

-- 聊天消息
CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT NOT NULL,
  sender_type ENUM('USER','PLAYER','CS','SYSTEM') NOT NULL,
  sender_id BIGINT DEFAULT NULL,
  sender_name VARCHAR(64) DEFAULT '',
  sender_avatar VARCHAR(512) DEFAULT '',
  msg_type ENUM('TEXT','IMAGE','SYSTEM','ORDER_CARD','PRODUCT_CARD') DEFAULT 'TEXT',
  content TEXT NOT NULL,
  is_read TINYINT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id),
  INDEX idx_session (session_id, created_at),
  INDEX idx_read (is_read)
) ENGINE=InnoDB;

-- 轮播图
CREATE TABLE IF NOT EXISTS banners (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  image_url VARCHAR(512) NOT NULL,
  title VARCHAR(128) DEFAULT '',
  link_type VARCHAR(20) DEFAULT 'NONE',
  link_value VARCHAR(512) DEFAULT '',
  sort_order INT DEFAULT 0,
  status TINYINT DEFAULT 1,
  click_count INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_status (status, sort_order)
) ENGINE=InnoDB;

-- 公告
CREATE TABLE IF NOT EXISTS announcements (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(128) NOT NULL,
  content TEXT NOT NULL,
  type VARCHAR(20) DEFAULT 'NORMAL',
  priority INT DEFAULT 0,
  status TINYINT DEFAULT 1,
  read_count INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_status (status, priority DESC)
) ENGINE=InnoDB;

-- 交易流水
CREATE TABLE IF NOT EXISTS transactions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  type ENUM('RECHARGE','PAY','REFUND','WITHDRAW','COMMISSION','BONUS','PENALTY') NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  balance_before DECIMAL(12,2) DEFAULT 0,
  balance_after DECIMAL(12,2) DEFAULT 0,
  order_id BIGINT DEFAULT NULL,
  remark VARCHAR(256) DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_user (user_id, created_at DESC),
  INDEX idx_type (type),
  INDEX idx_order (order_id)
) ENGINE=InnoDB;

-- 提现
CREATE TABLE IF NOT EXISTS withdrawals (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  player_id BIGINT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  fee DECIMAL(10,2) DEFAULT 0,
  actual_amount DECIMAL(12,2) NOT NULL,
  bank_name VARCHAR(64) DEFAULT '',
  bank_account VARCHAR(64) DEFAULT '',
  status ENUM('PENDING','APPROVED','REJECTED','PAID') DEFAULT 'PENDING',
  reject_reason VARCHAR(256) DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME DEFAULT NULL,
  FOREIGN KEY (player_id) REFERENCES players(id),
  INDEX idx_status (status),
  INDEX idx_player (player_id)
) ENGINE=InnoDB;

-- 系统配置
CREATE TABLE IF NOT EXISTS configs (
  `key` VARCHAR(64) PRIMARY KEY,
  `value` TEXT NOT NULL,
  type VARCHAR(20) DEFAULT 'STRING',
  remark VARCHAR(128) DEFAULT ''
) ENGINE=InnoDB;

-- 活动日志
CREATE TABLE IF NOT EXISTS activity_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT DEFAULT NULL,
  user_type VARCHAR(20) DEFAULT 'SYSTEM',
  action VARCHAR(64) NOT NULL,
  target_type VARCHAR(32) DEFAULT '',
  target_id BIGINT DEFAULT NULL,
  detail TEXT DEFAULT NULL,
  ip_address VARCHAR(64) DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user (user_id, created_at DESC),
  INDEX idx_action (action),
  INDEX idx_created (created_at DESC)
) ENGINE=InnoDB;

-- 短信验证码
CREATE TABLE IF NOT EXISTS sms_codes (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  phone VARCHAR(20) NOT NULL,
  code VARCHAR(10) NOT NULL,
  type VARCHAR(20) DEFAULT 'LOGIN' COMMENT 'LOGIN/REGISTER/RESET',
  used TINYINT DEFAULT 0,
  expire_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_phone (phone, type),
  INDEX idx_expire (expire_at)
) ENGINE=InnoDB;

-- 邀请/分销记录
CREATE TABLE IF NOT EXISTS invite_records (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  inviter_id BIGINT NOT NULL COMMENT '邀请人',
  invitee_id BIGINT NOT NULL COMMENT '被邀请人',
  invite_code VARCHAR(20) NOT NULL,
  commission DECIMAL(10,2) DEFAULT 0 COMMENT '佣金',
  status TINYINT DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (inviter_id) REFERENCES users(id),
  FOREIGN KEY (invitee_id) REFERENCES users(id),
  INDEX idx_inviter (inviter_id)
) ENGINE=InnoDB;

-- ═══ 初始数据 ═══

-- 管理员
INSERT INTO admins (username, password, nickname, role) VALUES
  ('admin', '$2a$10$sr59LNu4Asts4rCD13pG9Op8wgir1PSAveeQHefhsgc0UeTH1Bpfm', '超级管理员', 'ADMIN'),
  ('kefu', '$2a$10$qKBy2Vfnt4IC2ifHGFu.8uX4P3YTzDVQRhrl5xwE2ktWXXAp949WO', '客服小妹', 'CS'),
  ('finance', '$2a$10$qKBy2Vfnt4IC2ifHGFu.8uX4P3YTzDVQRhrl5xwE2ktWXXAp949WO', '财务主管', 'BOTH')
ON DUPLICATE KEY UPDATE nickname=VALUES(nickname);

-- 分类
INSERT INTO categories (name, icon, color, parent_id, sort_order) VALUES
  ('三角洲行动', '🎯', '#FF6B35', 0, 1),
  ('无畏契约', '🔫', '#4F46E5', 0, 2),
  ('王者荣耀', '👑', '#DC2626', 0, 3),
  ('和平精英', '🪖', '#059669', 0, 4)
ON DUPLICATE KEY UPDATE name=VALUES(name);

INSERT INTO categories (name, icon, color, parent_id, sort_order) VALUES
  ('护航跑刀', '⚔️', '#FF6B35', 1, 1),
  ('代肝哈夫币', '💰', '#F59E0B', 1, 2),
  ('养号任务', '📋', '#8B5CF6', 1, 3),
  ('陪玩娱乐', '🎮', '#EC4899', 1, 4)
ON DUPLICATE KEY UPDATE name=VALUES(name);

-- 系统配置
INSERT INTO configs (`key`, `value`, type, remark) VALUES
  ('platform_name', '三角洲护航', 'STRING', '平台名称'),
  ('platform_fee_rate', '0.3', 'NUMBER', '平台抽成比例'),
  ('min_withdraw', '50', 'NUMBER', '最低提现金额'),
  ('withdraw_fee_rate', '0.02', 'NUMBER', '提现手续费率'),
  ('player_deposit', '100', 'NUMBER', '接单员押金'),
  ('max_concurrent_orders', '3', 'NUMBER', '最大并发接单数'),
  ('recharge_bonus_threshold', '100', 'NUMBER', '充值赠送门槛'),
  ('recharge_bonus_rate', '0.05', 'NUMBER', '充值赠送比例'),
  ('order_auto_cancel_minutes', '30', 'NUMBER', '未支付自动取消(分钟)'),
  ('sms_enabled', '0', 'NUMBER', '是否启用短信(0=模拟)'),
  ('sms_provider', 'aliyun', 'STRING', '短信服务商'),
  ('invite_commission_rate', '0.05', 'NUMBER', '邀请佣金比例'),
  ('invite_enabled', '1', 'NUMBER', '是否启用邀请'),
  ('upload_max_size', '5', 'NUMBER', '上传最大MB'),
  ('upload_path', './uploads', 'STRING', '上传路径')
ON DUPLICATE KEY UPDATE `value`=VALUES(`value`);

-- 轮播图
INSERT INTO banners (image_url, title, sort_order, status) VALUES
  ('/uploads/banners/banner1.jpg', '三角洲护航火热上线', 1, 1),
  ('/uploads/banners/banner2.jpg', '新用户首单立减', 2, 1),
  ('/uploads/banners/banner3.jpg', '接单员招募中', 3, 1)
ON DUPLICATE KEY UPDATE title=VALUES(title);

-- 公告
INSERT INTO announcements (title, content, type, priority) VALUES
  ('欢迎使用三角洲护航平台', '平台提供专业的游戏代练护航服务，所有接单员均经过严格审核。如有问题请联系在线客服。', 'IMPORTANT', 1)
ON DUPLICATE KEY UPDATE content=VALUES(content);
