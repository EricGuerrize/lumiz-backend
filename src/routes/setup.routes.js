const express = require('express');
const router = express.Router();
const setupController = require('../controllers/setupController');

router.get('/validate', (req, res) => setupController.validate(req, res));
router.post('/complete', (req, res) => setupController.complete(req, res));

module.exports = router;
