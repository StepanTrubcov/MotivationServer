import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { prisma } from './prismaClient.js';

dotenv.config();

const app = express();

// CORS
app.use(cors({
  origin: '*', // Разрешаем запросы с любого источника
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'ngrok-skip-browser-warning'], // Добавляем ngrok-skip-browser-warning
}));

app.use(express.json());

// Лог запросов
app.use((req, res, next) => {
  console.log(`[${req.method}] ${req.url} from ${req.headers.origin}`);
  console.log('Request headers:', req.headers);
  console.log('Request body:', req.body);
  next();
});

// Тест
app.get('/test', (req, res) => {
  res.json({ message: 'Server is running' });
});

// POST /api/users
app.post('/api/users', async (req, res) => {
  const { telegramId, firstName, username, photoUrl } = req.body;
  try {
    // Проверяем, существует ли пользователь
    let user = await prisma.user.findUnique({
      where: { telegramId },
    });

    if (user) {
      // Обновляем существующего пользователя
      user = await prisma.user.update({
        where: { telegramId },
        data: { firstName, username, photoUrl },
      });
    } else {
      // Создаем нового пользователя
      user = await prisma.user.create({
        data: { telegramId, firstName, username, photoUrl },
      });
    }

    res.json(user);
  } catch (err) {
    console.error('Error in /api/users:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET all
app.get('/api/users', async (req, res) => {
  try {
    const users = await prisma.user.findMany();
    res.json(users);
  } catch (err) {
    console.error('Error in /api/users:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET one
app.get('/api/users/:telegramId', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { telegramId: req.params.telegramId }
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    console.error('Error in /api/users/:telegramId:', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5002;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});