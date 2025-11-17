const express = require('express');
const router = express.Router();

const onboardingController = require('../controllers/onboardingController');
const { authenticateFlexible } = require('../middleware/authMiddleware');

router.get('/state', (req, res) => onboardingController.getState(req, res));
router.patch('/state', (req, res) => onboardingController.updateState(req, res));
router.post('/steps', (req, res) => onboardingController.recordStep(req, res));

router.post('/mdr/manual', (req, res) => onboardingController.saveManualMdr(req, res));
router.post('/mdr/ocr', (req, res) => onboardingController.requestOcr(req, res));
router.post('/mdr/:configId/confirm', (req, res) => onboardingController.confirmMdrConfig(req, res));
router.get('/mdr', (req, res) => onboardingController.getMdrConfig(req, res));

router.get('/assistant/prompts', (req, res) => onboardingController.getAssistantPrompts(req, res));

router.get('/metrics', authenticateFlexible, (req, res) => onboardingController.getMetrics(req, res));
router.post('/nps', (req, res) => onboardingController.recordNps(req, res));

module.exports = router;

