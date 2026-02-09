const express = require('express');

const router = express.Router();
const mdrController = require('../controllers/mdrController');
const { authenticateFlexible } = require('../middleware/authMiddleware');

router.use(authenticateFlexible);

router.get('/config', (req, res) => mdrController.getConfig(req, res));
router.post('/config', (req, res) => mdrController.saveConfig(req, res));
router.post('/simulate', (req, res) => mdrController.simulate(req, res));

module.exports = router;
