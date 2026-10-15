const database = require('../config/database');
const { sendDatabaseError } = require('../utils/errors');

function requirePermission(permissionCode) {
  return async (req, res, next) => {
    if (req.authUnavailable) {
      return res.status(503).json({
        error: {
          code: 'AUTH_UNAVAILABLE',
          message: 'No se pudo validar la sesión.',
        },
      });
    }

    const userId = req.auth?.user?.id;
    if (userId === undefined || userId === null) {
      return res.status(401).json({
        error: { code: 'UNAUTHENTICATED', message: 'Debe iniciar sesión.' },
      });
    }

    try {
      const rows = await database.getPool().query(
        `SELECT 1
         FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p ON p.id = rp.permission_id
         WHERE ur.user_id = ? AND p.code = ?
         LIMIT 1`,
        [userId, permissionCode],
      );
      if (!rows.length) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'No tiene permiso para realizar esta operación.' } });
      }
      next();
    } catch (error) {
      sendDatabaseError(res, req, error, 'auth.permission_check', 'No se pudieron verificar los permisos.');
    }
  };
}

module.exports = requirePermission;
