/**
 * RBAC 权限系统
 * 角色: ADMIN(超级管理员) / OPERATOR(运营) / FINANCE(财务) / CS(客服)
 * 权限: 粒度化权限控制
 */

const PERMISSIONS = {
  // 订单
  'order:view': '查看订单',
  'order:assign': '派单',
  'order:refund': '退款',
  'order:cancel': '取消订单',
  'order:export': '导出订单',

  // 用户
  'user:view': '查看用户',
  'user:edit': '编辑用户',
  'user:ban': '封禁用户',
  'user:export': '导出用户',

  // 接单员
  'player:view': '查看接单员',
  'player:review': '审核接单员',
  'player:ban': '封禁接单员',

  // 商品
  'product:view': '查看商品',
  'product:create': '创建商品',
  'product:edit': '编辑商品',
  'product:delete': '删除商品',

  // 财务
  'finance:view': '查看财务',
  'finance:withdraw': '审核提现',
  'finance:export': '导出财务',
  'finance:recharge': '手动充值',

  // 系统
  'system:config': '系统配置',
  'system:banner': '轮播图管理',
  'system:announcement': '公告管理',
  'system:log': '查看日志',
};

const ROLES = {
  ADMIN: {
    name: '超级管理员',
    permissions: Object.keys(PERMISSIONS) // 全部权限
  },
  OPERATOR: {
    name: '运营',
    permissions: [
      'order:view', 'order:assign', 'order:export',
      'player:view', 'player:review',
      'product:view', 'product:create', 'product:edit',
      'system:banner', 'system:announcement',
      'user:view'
    ]
  },
  FINANCE: {
    name: '财务',
    permissions: [
      'order:view', 'order:refund', 'order:export',
      'finance:view', 'finance:withdraw', 'finance:export', 'finance:recharge',
      'user:view', 'user:export'
    ]
  },
  CS: {
    name: '客服',
    permissions: [
      'order:view', 'order:assign',
      'user:view',
      'player:view'
    ]
  }
};

/**
 * 检查权限
 */
function checkPermission(adminRole, requiredPermission) {
  const role = ROLES[adminRole];
  if (!role) return false;
  return role.permissions.includes(requiredPermission);
}

/**
 * 权限中间件
 */
function requirePermission(...perms) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ code: 401, msg: '未登录' });
    
    // ADMIN 角色拥有所有权限
    if (req.user.role === 'ADMIN') return next();

    const hasPermission = perms.some(p => checkPermission(req.user.role, p));
    if (!hasPermission) {
      return res.status(403).json({ code: 403, msg: '权限不足', required: perms });
    }
    next();
  };
}

/**
 * 获取角色权限列表
 */
function getRolePermissions(role) {
  return ROLES[role]?.permissions || [];
}

/**
 * 获取所有权限定义
 */
function getAllPermissions() {
  return PERMISSIONS;
}

/**
 * 获取所有角色定义
 */
function getAllRoles() {
  return Object.entries(ROLES).map(([key, val]) => ({
    key,
    name: val.name,
    permissions: val.permissions
  }));
}

module.exports = { PERMISSIONS, ROLES, checkPermission, requirePermission, getRolePermissions, getAllPermissions, getAllRoles };
