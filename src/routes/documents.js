const { Router } = require('express');
const { optionalAuth, requireAuth } = require('../middleware/require-auth');
const requirePermission = require('../middleware/require-permission');
const { requireStorageReady } = require('../services/storage-readiness');
const documentsController = require('../controllers/documents-controller');

const router = Router();

router.get('/estudios/:studyId/documentos', optionalAuth, requireAuth, requirePermission('documents.read'), documentsController.listarPorEstudio);
router.post('/estudios/:studyId/documentos', optionalAuth, requireAuth, requirePermission('documents.upload'), requireStorageReady, documentsController.cargar);
router.get('/documentos/:id/download', optionalAuth, requireAuth, requirePermission('documents.download'), requireStorageReady, documentsController.descargar);
router.get('/documentos/:id/content', optionalAuth, requireAuth, requirePermission('documents.read'), requireStorageReady, documentsController.visualizar);
router.put('/documentos/:id', optionalAuth, requireAuth, requirePermission('documents.replace'), requireStorageReady, documentsController.reemplazar);
router.delete('/documentos/:id', optionalAuth, requireAuth, requirePermission('documents.delete'), requireStorageReady, documentsController.eliminar);

module.exports = router;
