# ═══════════════════════════════════════════════════════
# 三角洲护航 SaaS 系统 — API 测试脚本
# ═══════════════════════════════════════════════════════
# 使用: bash test/api-test.sh

BASE="http://localhost:3001"
PASS=0
FAIL=0

assert() {
  local desc="$1" expected="$2" actual="$3"
  if echo "$actual" | grep -q "$expected"; then
    echo "  ✅ $desc"
    ((PASS++))
  else
    echo "  ❌ $desc (expected: $expected)"
    ((FAIL++))
  fi
}

echo "🧪 三角洲护航 API 测试"
echo "========================"

# ── 公共接口 ──
echo ""
echo "📋 公共接口"

R=$(curl -s "$BASE/api/categories")
assert "获取分类" '"code":0' "$R"

R=$(curl -s "$BASE/api/products?hot=1")
assert "热门商品" '"code":0' "$R"

R=$(curl -s "$BASE/api/banners")
assert "轮播图" '"code":0' "$R"

R=$(curl -s "$BASE/api/announcements")
assert "公告" '"code":0' "$R"

R=$(curl -s "$BASE/api/health")
assert "健康检查" '"status":"healthy"' "$R"

R=$(curl -s "$BASE/api/alive")
assert "存活检查" '"status":"ok"' "$R"

# ── 用户登录 ──
echo ""
echo "👤 用户认证"

R=$(curl -s -X POST "$BASE/api/user/login" -H 'Content-Type: application/json' -d '{"phone":"13800000001","code":"123456"}')
assert "用户登录" '"code":0' "$R"
USER_TOKEN=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])" 2>/dev/null)

R=$(curl -s "$BASE/api/user/profile" -H "Authorization: Bearer $USER_TOKEN")
assert "用户信息" '"code":0' "$R"

# ── 下单流程 ──
echo ""
echo "📋 下单流程"

R=$(curl -s -X POST "$BASE/api/orders" -H "Authorization: Bearer $USER_TOKEN" -H 'Content-Type: application/json' -d '{"product_id":1,"quantity":2,"game_info":"测试ID"}')
assert "创建订单" '"code":0' "$R"
ORDER_ID=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])" 2>/dev/null)

R=$(curl -s -X POST "$BASE/api/orders/$ORDER_ID/pay" -H "Authorization: Bearer $USER_TOKEN" -H 'Content-Type: application/json' -d '{"pay_method":"BALANCE"}')
# 可能余额不足，但接口应正常响应
assert "支付接口" '"code"' "$R"

R=$(curl -s "$BASE/api/user/orders" -H "Authorization: Bearer $USER_TOKEN")
assert "订单列表" '"code":0' "$R"

# ── 管理员 ──
echo ""
echo "🔧 管理后台"

R=$(curl -s -X POST "$BASE/api/admin/login" -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}')
assert "管理员登录" '"code":0' "$R"
ADMIN_TOKEN=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])" 2>/dev/null)

R=$(curl -s "$BASE/api/admin/dashboard" -H "Authorization: Bearer $ADMIN_TOKEN")
assert "仪表盘" '"code":0' "$R"

R=$(curl -s "$BASE/api/admin/orders" -H "Authorization: Bearer $ADMIN_TOKEN")
assert "订单管理" '"code":0' "$R"

R=$(curl -s "$BASE/api/admin/users" -H "Authorization: Bearer $ADMIN_TOKEN")
assert "用户管理" '"code":0' "$R"

R=$(curl -s "$BASE/api/admin/players" -H "Authorization: Bearer $ADMIN_TOKEN")
assert "接单员管理" '"code":0' "$R"

R=$(curl -s "$BASE/api/admin/configs" -H "Authorization: Bearer $ADMIN_TOKEN")
assert "系统配置" '"code":0' "$R"

R=$(curl -s "$BASE/api/admin/logs" -H "Authorization: Bearer $ADMIN_TOKEN")
assert "活动日志" '"code":0' "$R"

R=$(curl -s "$BASE/api/admin/search?q=138" -H "Authorization: Bearer $ADMIN_TOKEN")
assert "全局搜索" '"code":0' "$R"

R=$(curl -s "$BASE/api/admin/players/available" -H "Authorization: Bearer $ADMIN_TOKEN")
assert "可用接单员" '"code":0' "$R"

R=$(curl -s "$BASE/api/admin/permissions" -H "Authorization: Bearer $ADMIN_TOKEN")
assert "权限列表" '"code":0' "$R"

R=$(curl -s "$BASE/api/admin/backups" -H "Authorization: Bearer $ADMIN_TOKEN")
assert "备份列表" '"code":0' "$R"

R=$(curl -s "$BASE/api/admin/export/orders" -H "Authorization: Bearer $ADMIN_TOKEN")
assert "导出订单CSV" '订单号' "$R"

# ── 邀请系统 ──
echo ""
echo "🎁 邀请系统"

R=$(curl -s "$BASE/api/user/invite" -H "Authorization: Bearer $USER_TOKEN")
assert "邀请统计" '"code":0' "$R"

# ── 短信 ──
echo ""
echo "📱 短信验证"

R=$(curl -s -X POST "$BASE/api/sms/send" -H 'Content-Type: application/json' -d '{"phone":"13800000001"}')
assert "发送验证码" '"code":0' "$R"

# ── 结果 ──
echo ""
echo "========================"
echo "📊 测试结果: ✅ $PASS 通过  ❌ $FAIL 失败"
echo ""
