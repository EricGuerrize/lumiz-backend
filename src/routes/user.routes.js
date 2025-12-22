const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authenticateFlexible } = require('../middleware/authMiddleware');
const { validate } = require('../middleware/validationMiddleware');
const { linkEmailSchema } = require('../validators/user.validators');

// Rota pública para vincular email (finalizar cadastro)
router.post('/link-email', validate(linkEmailSchema), (req, res) => {
    return userController.linkEmail(req, res);
});

module.exports = router;
