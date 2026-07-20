/**
 * 图片上传模块
 * 支持: 本地存储 / 阿里云OSS / 腾讯云COS
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

class UploadService {
  constructor(config = {}) {
    this.uploadPath = config.uploadPath || path.join(__dirname, '..', 'uploads');
    this.maxSize = (config.maxSize || 5) * 1024 * 1024; // 默认 5MB
    this.allowedTypes = config.allowedTypes || ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    this.provider = config.provider || 'local'; // local / oss / cos

    // 确保上传目录存在
    const dirs = ['avatars', 'products', 'banners', 'chat', 'temp'];
    dirs.forEach(d => {
      const dir = path.join(this.uploadPath, d);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });
  }

  /**
   * 处理文件上传
   */
  async upload(file, category = 'temp') {
    // 验证文件类型
    if (!this.allowedTypes.includes(file.mimetype)) {
      return { success: false, msg: '不支持的文件类型' };
    }

    // 验证文件大小
    if (file.size > this.maxSize) {
      return { success: false, msg: `文件大小不能超过 ${this.maxSize / 1024 / 1024}MB` };
    }

    // 生成文件名
    const ext = path.extname(file.originalname) || '.jpg';
    const hash = crypto.randomBytes(8).toString('hex');
    const filename = `${Date.now()}_${hash}${ext}`;
    const relativePath = `${category}/${filename}`;

    if (this.provider === 'local') {
      return this._uploadLocal(file, relativePath);
    } else if (this.provider === 'oss') {
      return this._uploadOSS(file, relativePath);
    } else if (this.provider === 'cos') {
      return this._uploadCOS(file, relativePath);
    }

    return { success: false, msg: '未知存储 provider' };
  }

  /**
   * 本地存储
   */
  async _uploadLocal(file, relativePath) {
    const fullPath = path.join(this.uploadPath, relativePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // 如果是 buffer (multer memoryStorage)
    if (file.buffer) {
      fs.writeFileSync(fullPath, file.buffer);
    } else if (file.path) {
      fs.copyFileSync(file.path, fullPath);
    }

    return {
      success: true,
      url: `/uploads/${relativePath}`,
      path: fullPath
    };
  }

  /**
   * 阿里云 OSS
   */
  async _uploadOSS(file, relativePath) {
    const OSS = require('ali-oss');
    const client = new OSS({
      region: process.env.OSS_REGION || 'oss-cn-hangzhou',
      accessKeyId: process.env.OSS_ACCESS_KEY || '',
      accessKeySecret: process.env.OSS_SECRET_KEY || '',
      bucket: process.env.OSS_BUCKET || ''
    });

    const result = await client.put(relativePath, file.buffer || file.path);
    return {
      success: true,
      url: result.url,
      path: relativePath
    };
  }

  /**
   * 腾讯云 COS
   */
  async _uploadCOS(file, relativePath) {
    const COS = require('cos-nodejs-sdk-v5');
    const cos = new COS({
      SecretId: process.env.COS_SECRET_ID || '',
      SecretKey: process.env.COS_SECRET_KEY || ''
    });

    await cos.putObject({
      Bucket: process.env.COS_BUCKET || '',
      Region: process.env.COS_REGION || 'ap-guangzhou',
      Key: relativePath,
      Body: file.buffer || fs.readFileSync(file.path)
    });

    return {
      success: true,
      url: `https://${process.env.COS_BUCKET}.cos.${process.env.COS_REGION}.myqcloud.com/${relativePath}`,
      path: relativePath
    };
  }

  /**
   * 删除文件
   */
  async delete(url) {
    if (this.provider === 'local') {
      const fullPath = path.join(this.uploadPath, url.replace('/uploads/', ''));
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      return { success: true };
    }
    // OSS/COS 删除逻辑类似
    return { success: true };
  }
}

module.exports = UploadService;
