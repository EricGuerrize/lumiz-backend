const express = require('express');
const router = express.Router();

const onboardingController = require('../controllers/onboardingController');
const { authenticateFlexible } = require('../middleware/authMiddleware');
const { validate } = require('../middleware/validationMiddleware');
const {
  updateStateSchema,
  recordStepSchema,
  saveManualMdrSchema,
  requestOcrSchema,
  confirmMdrConfigSchema,
  recordNpsSchema
} = require('../validators/onboarding.validators');

router.get('/state', (req, res) => onboardingController.getState(req, res));
router.patch('/state', validate(updateStateSchema), (req, res) => onboardingController.updateState(req, res));
router.post('/steps', validate(recordStepSchema), (req, res) => onboardingController.recordStep(req, res));

router.post('/mdr/manual', validate(saveManualMdrSchema), (req, res) => onboardingController.saveManualMdr(req, res));
router.post('/mdr/ocr', validate(requestOcrSchema), (req, res) => onboardingController.requestOcr(req, res));
router.post('/mdr/:configId/confirm', validate(confirmMdrConfigSchema), (req, res) => onboardingController.confirmMdrConfig(req, res));
router.get('/mdr', (req, res) => onboardingController.getMdrConfig(req, res));

router.get('/assistant/prompts', (req, res) => onboardingController.getAssistantPrompts(req, res));

router.get('/metrics', authenticateFlexible, (req, res) => onboardingController.getMetrics(req, res));
router.post('/nps', validate(recordNpsSchema), (req, res) => onboardingController.recordNps(req, res));

module.exports = router;

