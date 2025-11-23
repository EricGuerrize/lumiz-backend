const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authenticateFlexible } = require('../middleware/authMiddleware');

// Rota pública para vincular email (finalizar cadastro)
router.post('/link-email', (req, res) => {
    return userController.linkEmail(req, res);
});

module.exports = router;
