-- SQLite → MySQL 数据迁移指南
-- ═══════════════════════════════════════════

-- 步骤 1: 在 MySQL 中执行建表脚本
-- mysql -u root -p < migrations/001_init_mysql.sql

-- 步骤 2: 从 SQLite 导出数据
-- sqlite3 delta.db ".dump" > delta_dump.sql

-- 步骤 3: 转换并导入（需要手动处理以下差异）

-- SQLite → MySQL 语法差异:
-- 1. AUTOINCREMENT → AUTO_INCREMENT
-- 2. DATETIME DEFAULT CURRENT_TIMESTAMP → 保持不变(MySQL兼容)
-- 3. INTEGER → BIGINT
-- 4. REAL → DECIMAL(12,2)
-- 5. CHECK 约束 → ENUM 类型
-- 6. BOOLEAN 0/1 → TINYINT

-- 步骤 4: 修改 server.js 数据库连接
-- 将 SQLite 替换为 mysql2:
-- npm install mysql2
-- 
-- const mysql = require('mysql2/promise');
-- const pool = mysql.createPool({
--   host: 'localhost',
--   user: 'root',
--   password: 'your_password',
--   database: 'delta_escort',
--   waitForConnections: true,
--   connectionLimit: 10
-- });

-- 步骤 5: 修改查询语法
-- SQLite: db.prepare(sql).all(...params)
-- MySQL:  const [rows] = await pool.execute(sql, params)
--
-- SQLite: db.prepare(sql).get(...params)  
-- MySQL:  const [rows] = await pool.execute(sql, params); return rows[0];
--
-- SQLite: db.prepare(sql).run(...params)
-- MySQL:  const [result] = await pool.execute(sql, params); return result;
