const express = require('express');
const router = express.Router();
const clinicMembersController = require('../controllers/clinicMembersController');
const { authenticateFlexible } = require('../middleware/authMiddleware');

router.use(authenticateFlexible);

router.get('/', (req, res) => clinicMembersController.list(req, res));
router.post('/', (req, res) => clinicMembersController.create(req, res));
router.patch('/:id', (req, res) => clinicMembersController.update(req, res));
router.delete('/:id', (req, res) => clinicMembersController.remove(req, res));

module.exports = router;
