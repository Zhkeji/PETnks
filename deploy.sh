#!/bin/bash
# 一键部署脚本
set -e

echo "🎮 三角洲护航 SaaS 系统 - 部署脚本"
echo "=================================="

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "📦 安装 Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

echo "✅ Node.js $(node -v)"

# 安装依赖
echo "📦 安装依赖..."
npm ci --production 2>/dev/null || npm install --production

# 创建目录
mkdir -p uploads backups

# 复制环境配置
if [ ! -f .env ]; then
    cp .env.example .env
    echo "⚠️  已创建 .env 配置文件，请修改 JWT_SECRET"
fi

# PM2 部署
if ! command -v pm2 &> /dev/null; then
    echo "📦 安装 PM2..."
    npm install -g pm2
fi

# 停止旧进程
pm2 delete delta-escort 2>/dev/null || true

# 启动
echo "🚀 启动服务..."
pm2 start server.js --name delta-escort --max-memory-restart 512M
pm2 save
pm2 startup

echo ""
echo "✅ 部署完成！"
echo ""
echo "   用户端:     http://localhost:3001"
echo "   管理后台:   http://localhost:3001/admin"
echo "   接单员端:   http://localhost:3001/player"
echo "   健康检查:   http://localhost:3001/api/health"
echo ""
echo "   管理员: admin / admin123"
echo "   客服:   kefu / kefu123"
echo ""
echo "📝 建议配置 Nginx 反向代理 + SSL 证书"
echo "   参考: https://nginx.org/en/docs/beginners_guide.html"
