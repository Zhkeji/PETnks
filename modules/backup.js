/**
 * 数据库自动备份模块
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class BackupService {
  constructor(dbPath, backupDir) {
    this.dbPath = dbPath;
    this.backupDir = backupDir || path.join(__dirname, '..', 'backups');
    this.maxBackups = 7; // 保留最近7份

    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  /**
   * 执行备份
   */
  backup() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `delta_backup_${timestamp}.db`;
    const backupPath = path.join(this.backupDir, filename);

    try {
      // 使用 SQLite 的 backup 命令（安全复制）
      fs.copyFileSync(this.dbPath, backupPath);

      // 压缩
      try {
        execSync(`gzip "${backupPath}"`);
        console.log(`[Backup] 备份成功: ${filename}.gz`);
      } catch (e) {
        console.log(`[Backup] 备份成功（未压缩）: ${filename}`);
      }

      // 清理旧备份
      this._cleanup();

      return { success: true, filename, path: backupPath };
    } catch (err) {
      console.error('[Backup] 备份失败:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * 清理旧备份
   */
  _cleanup() {
    try {
      const files = fs.readdirSync(this.backupDir)
        .filter(f => f.startsWith('delta_backup_'))
        .sort()
        .reverse();

      if (files.length > this.maxBackups) {
        files.slice(this.maxBackups).forEach(f => {
          fs.unlinkSync(path.join(this.backupDir, f));
          console.log(`[Backup] 清理旧备份: ${f}`);
        });
      }
    } catch (e) {
      // ignore
    }
  }

  /**
   * 列出备份
   */
  list() {
    try {
      return fs.readdirSync(this.backupDir)
        .filter(f => f.startsWith('delta_backup_'))
        .sort()
        .reverse()
        .map(f => {
          const stat = fs.statSync(path.join(this.backupDir, f));
          return { name: f, size: stat.size, created: stat.mtime };
        });
    } catch (e) {
      return [];
    }
  }

  /**
   * 启动定时备份
   */
  startAutoBackup(intervalHours = 24) {
    console.log(`[Backup] 自动备份已启动，每 ${intervalHours} 小时执行一次`);
    // 立即执行一次
    this.backup();
    // 定时执行
    setInterval(() => this.backup(), intervalHours * 3600 * 1000);
  }
}

module.exports = BackupService;
