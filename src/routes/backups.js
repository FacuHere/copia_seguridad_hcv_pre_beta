const { Router } = require('express');
const { optionalAuth, requireAuth } = require('../middleware/require-auth');
const requirePermission = require('../middleware/require-permission');
const backupsController = require('../controllers/backups-controller');
const documentsController = require('../controllers/documents-controller');

const router = Router();
router.use(optionalAuth, requireAuth, requirePermission('backups.manage'));

router.post('/exportar', backupsController.exportar);
router.get('/resumen-clinico', backupsController.resumen);
router.get('/documentos/:id', documentsController.descargarParaRespaldo);
router.post('/exportar/:operationId/completar', backupsController.completar);
router.post('/restauraciones', backupsController.iniciarRestauracion);
router.post('/restauraciones/:operationId/registros', backupsController.guardarLote);
router.post('/restauraciones/:operationId/documentos/:documentId', backupsController.cargarArchivo);
router.post('/restauraciones/:operationId/confirmar', backupsController.confirmarRestauracion);
router.post('/operaciones/:operationId/cancelar', backupsController.cancelar);

module.exports = router;
