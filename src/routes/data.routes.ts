import express from 'express';
import UserData from '../models/UserData';

const router = express.Router();

// Endpoint para receber os dados do usuário
router.post('/data', async (req, res) => {
    const userData = req.body;

    try {
        const newUser = new UserData(userData);
        await newUser.save();
        res.status(201).json({ message: 'Dados salvos com sucesso!' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao salvar os dados.' });
    }
});

// Endpoint para buscar os dados do usuário
router.get('/data', async (req, res) => {
    try {
        const data = await UserData.find();
        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar os dados.' });
    }
});

export default router;