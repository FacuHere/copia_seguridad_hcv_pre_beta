const database = require('../config/database');

async function userHasPermission(userId, permissionCode) {
  const rows = await database.getPool().query(
    `SELECT 1
     FROM user_roles ur
     JOIN role_permissions rp ON rp.role_id = ur.role_id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE ur.user_id = ? AND p.code = ?
     LIMIT 1`,
    [userId, permissionCode],
  );
  return rows.length > 0;
}

module.exports = { userHasPermission };
