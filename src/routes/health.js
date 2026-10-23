const { Router } = require('express');
const healthController = require('../controllers/health-controller');

const router = Router();

router.get('/database', healthController.database);
router.get('/storage', healthController.storage);

module.exports = router;
