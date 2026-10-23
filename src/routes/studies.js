const { Router } = require('express');
const { optionalAuth, requireAuth } = require('../middleware/require-auth');
const requirePermission = require('../middleware/require-permission');
const studiesController = require('../controllers/studies-controller');

const router = Router();

router.get('/pacientes/:patientId/estudios', optionalAuth, requireAuth, requirePermission('studies.read'), studiesController.listarPorPaciente);
router.post('/estudios', optionalAuth, requireAuth, requirePermission('studies.create'), studiesController.crear);
router.get('/estudios/:id', optionalAuth, requireAuth, requirePermission('studies.read'), studiesController.obtener);
router.put('/estudios/:id', optionalAuth, requireAuth, requirePermission('studies.update'), studiesController.actualizar);

module.exports = router;
