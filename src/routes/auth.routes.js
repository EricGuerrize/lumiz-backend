const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.post('/resolve-phone', (req, res) => authController.resolvePhone(req, res));

module.exports = router;
