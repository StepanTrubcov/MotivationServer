import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.resolve(__dirname, '..', '.env');
console.log('Attempting to load .env from:', envPath);
const result = dotenv.config({ path: envPath });
if (result.error) {
  console.error('Error loading .env:', result.error);
  process.exit(1);
}
console.log('Loaded .env:', result.parsed);
console.log('MONGODB_URL in index.js:', process.env.MONGODB_URL);
console.log('DATABASE_URL in index.js:', process.env.DATABASE_URL);

async function startServer() {
  try {
    const { prisma } = await import('./prismaClient.js');
    console.log('MongoDB Prisma client loaded successfully');

    const { prismaPostgres } = await import('./prismaPostgresClient.js');
    console.log('Postgres Prisma client loaded successfully');

    const app = express();

    app.use(cors({
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'ngrok-skip-browser-warning'],
    }));

    app.use(express.json());

    app.use((req, res, next) => {
      console.log(`[${req.method}] ${req.url} from ${req.headers.origin}`);
      console.log('Request headers:', req.headers);
      console.log('Request body:', req.body);
      next();
    });

    // Тестовый маршрут
    app.get('/test', (req, res) => {
      res.json({ message: 'Server is running' });
    });

    // Создание/обновление профиля пользователя
    app.post('/api/users', async (req, res) => {
      const { telegramId, firstName, username, photoUrl } = req.body;
      try {
        let user = await prisma.user.findUnique({
          where: { telegramId: String(telegramId) },
        });
        if (user) {
          user = await prisma.user.update({
            where: { telegramId: String(telegramId) },
            data: { firstName, username, photoUrl },
          });
        } else {
          user = await prisma.user.create({
            data: { telegramId: String(telegramId), firstName, username, photoUrl },
          });
        }
        res.json(user);
      } catch (err) {
        console.error('Error in /api/users:', err);
        res.status(500).json({ error: err.message });
      }
    });

    // Получение всех целей пользователя
    app.get('/api/goals/:userId', async (req, res) => {
      const { userId } = req.params;
      console.log('Fetching goals for userId:', userId);
      try {
        const goals = await prismaPostgres.goal.findMany({
          where: { userId: String(userId) },
        });
        res.json(goals);
      } catch (err) {
        console.error('Error in /api/goals/:userId:', err);
        res.status(500).json({ error: err.message });
      }
    });

    // Инициализация целей пользователя
    app.post('/api/initialize-goals/:userId', async (req, res) => {
      const { userId } = req.params;
      const { goalsArray } = req.body;
      console.log('Initializing goals for userId:', userId, 'Goals:', goalsArray);
      try {
        if (!prismaPostgres) {
          throw new Error('Prisma Postgres client is not initialized');
        }
        if (!goalsArray || !Array.isArray(goalsArray)) {
          return res.status(400).json({ error: 'goalsArray must be an array' });
        }

        for (const goal of goalsArray) {
          if (!goal.id || !goal.title || !goal.points || !goal.status || !goal.description) {
            console.error('Invalid goal data:', goal);
            return res.status(400).json({ error: `Invalid goal data: ${JSON.stringify(goal)}` });
          }

          await prismaPostgres.goal.upsert({
            where: { id: String(goal.id) },
            update: {
              title: goal.title,
              points: goal.points,
              status: goal.status,
              completionDate: goal.completionDate ? new Date(goal.completionDate) : null,
              description: goal.description,
              userId: String(userId),
              startDate: goal.startDate ? new Date(goal.startDate) : null,
            },
            create: {
              id: String(goal.id),
              title: goal.title,
              points: goal.points,
              status: goal.status,
              completionDate: goal.completionDate ? new Date(goal.completionDate) : null,
              description: goal.description,
              userId: String(userId),
              startDate: goal.startDate ? new Date(goal.startDate) : null,
            },
          });
        }
        res.json({ message: 'Goals initialized' });
      } catch (err) {
        console.error('Error in /api/initialize-goals/:userId:', err);
        res.status(500).json({ error: err.message });
      }
    });

    // Обновление статуса цели
    app.put('/api/goals/:userId/:goalId', async (req, res) => {
      const { userId, goalId } = req.params;
      const { newStatus } = req.body;
      console.log(`Updating status for goal ${goalId} to ${newStatus} for user ${userId}`);
      try {
        if (!newStatus) {
          return res.status(400).json({ error: 'newStatus is required' });
        }
        const goal = await prismaPostgres.goal.findUnique({
          where: { id: String(goalId), userId: String(userId) },
        });
        if (!goal) {
          return res.status(404).json({ error: 'Goal not found' });
        }
        const updatedGoal = await prismaPostgres.goal.update({
          where: { id: String(goalId) },
          data: {
            status: newStatus,
            startDate: newStatus === 'in_progress' && !goal.startDate ? new Date() : goal.startDate,
            completionDate: newStatus === 'done' ? new Date() : goal.completionDate,
          },
        });
        res.json(updatedGoal);
      } catch (err) {
        console.error(`Error updating status for goal ${goalId}:`, err);
        res.status(500).json({ error: err.message });
      }
    });

    // Проверка завершения целей (на основе таймеров)
    app.post('/api/check-completion/:userId', async (req, res) => {
      const { userId } = req.params;
      console.log('Checking goal completion for user:', userId);
      try {
        const goals = await prismaPostgres.goal.findMany({
          where: { userId: String(userId) },
        });

        const currentTime = new Date();
        const updatedGoals = await Promise.all(
          goals.map(async (goal) => {
            if (goal.status === 'in_progress' && goal.startDate) {
              const timeDiff = (currentTime - new Date(goal.startDate)) / 1000; // Разница в секундах
              if (timeDiff >= 30) { // 30 секунд для статуса in_progress
                await prismaPostgres.goal.update({
                  where: { id: String(goal.id) },
                  data: { status: 'not_started', startDate: null, completionDate: null },
                });
                return { ...goal, status: 'not_started', startDate: null, completionDate: null };
              }
            } else if (goal.status === 'done' && goal.completionDate) {
              const timeDiff = (currentTime - new Date(goal.completionDate)) / 1000;
              if (timeDiff >= 20) { // 20 секунд для статуса done
                await prismaPostgres.goal.update({
                  where: { id: String(goal.id) },
                  data: { status: 'not_started', startDate: null, completionDate: null },
                });
                return { ...goal, status: 'not_started', startDate: null, completionDate: null };
              }
            }
            return goal;
          })
        );
        res.json(updatedGoals);
      } catch (err) {
        console.error('Error in /api/check-completion/:userId:', err);
        res.status(500).json({ error: err.message });
      }
    });

    const PORT = process.env.PORT || 5002;
    app.listen(PORT, () => {
      console.log(`✅ Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();