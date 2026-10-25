const { Router } = require('express');
const { optionalAuth, requireAuth } = require('../middleware/require-auth');
const requirePermission = require('../middleware/require-permission');
const patientsController = require('../controllers/patients-controller');

const router = Router();

router.get('/', optionalAuth, requireAuth, requirePermission('patients.read'), patientsController.listar);
router.post('/', optionalAuth, requireAuth, requirePermission('patients.create'), patientsController.crear);
router.get('/:id', optionalAuth, requireAuth, requirePermission('patients.read'), patientsController.obtener);
router.put('/:id', optionalAuth, requireAuth, requirePermission('patients.update'), patientsController.actualizar);

module.exports = router;
