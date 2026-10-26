const { Router } = require('express');
const { optionalAuth, requireAuth } = require('../middleware/require-auth');
const requirePermission = require('../middleware/require-permission');
const controlador = require('../controllers/users-controller');

const router = Router();
router.use(optionalAuth, requireAuth, requirePermission('users.manage'));
router.get('/', controlador.listar);
router.post('/', requirePermission('roles.manage'), controlador.crear);
router.put('/:id', controlador.actualizar);
router.put('/:id/password', controlador.cambiarContrasena);
module.exports = router;
