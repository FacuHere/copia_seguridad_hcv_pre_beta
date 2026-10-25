const { Router } = require('express');
const { optionalAuth, requireAuth } = require('../middleware/require-auth');
const authController = require('../controllers/auth-controller');
const usersController = require('../controllers/users-controller');

const router = Router();

router.post('/login', authController.iniciarSesion);
router.get('/me', optionalAuth, requireAuth, authController.obtenerSesion);
router.get('/permisos', optionalAuth, requireAuth, usersController.permisos);
router.post('/logout', optionalAuth, authController.cerrarSesion);

module.exports = router;
