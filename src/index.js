import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

    // Логирование запросов
    app.use((req, res, next) => {
      console.log(`[${req.method}] ${req.url} from ${req.headers.origin || 'local'}`);
      if (req.method !== 'GET') console.log('Request body:', req.body);
      next();
    });

    app.get('/test', (req, res) => {
      res.json({ message: 'Server is running' });
    });

    app.post('/api/users/:telegramId/completed-dates', async (req, res) => {
      const { telegramId } = req.params;
      const { date } = req.body;
      if (!date) return res.status(400).json({ error: "Дата обязательна" });

      try {
        const user = await prisma.user.update({
          where: { telegramId },
          data: {
            completedDates: { push: date }
          }
        });
        res.json(user);
      } catch (error) {
        console.error("Ошибка добавления даты:", error);
        res.status(500).json({ error: "Ошибка сервера" });
      }
    });

    app.get('/api/users/:telegramId/completed-dates', async (req, res) => {
      const { telegramId } = req.params;
      try {
        const user = await prisma.user.findUnique({
          where: { telegramId },
          select: { completedDates: true }
        });
        if (!user) return res.status(404).json({ error: "Пользователь не найден" });
        res.json(user.completedDates);
      } catch (error) {
        console.error("Ошибка получения дат:", error);
        res.status(500).json({ error: "Ошибка сервера" });
      }
    });

    app.post('/api/users', async (req, res) => {
      const { telegramId, firstName, username, photoUrl } = req.body;
      try {
        let user = await prisma.user.findUnique({ where: { telegramId: String(telegramId) } });
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

    app.get('/api/goals/:userId', async (req, res) => {
      const { userId } = req.params;
      try {
        const goals = await prismaPostgres.goal.findMany({ where: { userId: String(userId) } });
        res.json(goals);
      } catch (err) {
        console.error('Error in /api/goals/:userId:', err);
        res.status(500).json({ error: err.message });
      }
    });

    app.post('/api/initialize-goals/:userId', async (req, res) => {
      const { userId } = req.params;
      const { goalsArray } = req.body;
      try {
        if (!goalsArray || !Array.isArray(goalsArray)) return res.status(400).json({ error: 'goalsArray must be an array' });

        for (const goal of goalsArray) {
          if (!goal.id || !goal.title || !goal.points || !goal.status || !goal.description)
            return res.status(400).json({ error: `Invalid goal data: ${JSON.stringify(goal)}` });

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

    app.put('/api/goals/:userId/:goalId', async (req, res) => {
      const { userId, goalId } = req.params;
      const { newStatus } = req.body;
      try {
        if (!newStatus) return res.status(400).json({ error: 'newStatus is required' });

        const goal = await prismaPostgres.goal.findFirst({ where: { id: String(goalId), userId: String(userId) } });
        if (!goal) return res.status(404).json({ error: 'Goal not found' });

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

    app.post('/api/users/:id/pts/increment', async (req, res) => {
      const { id } = req.params;
      const { amount } = req.body;

      const inc = Number(amount);
      if (!id) return res.status(400).json({ error: 'id is required in params' });
      if (!Number.isInteger(inc) || inc <= 0) {
        return res.status(400).json({ error: 'amount must be a positive integer' });
      }

      try {
        const user = await prisma.user.findUnique({ where: { id: String(id) } });
        if (!user) return res.status(404).json({ error: 'User not found' });

        const updated = await prisma.user.update({
          where: { id: String(id) },
          data: { pts: { increment: inc } }
        });

        res.json({
          success: true,
          user: {
            id: updated.id,
            telegramId: updated.telegramId,
            pts: updated.pts
          }
        });
      } catch (err) {
        console.error('Error incrementing pts:', err);
        res.status(500).json({ error: err.message });
      }
    });

    app.post('/api/check-completion/:userId', async (req, res) => {
      const { userId } = req.params;
      try {
        const goals = await prismaPostgres.goal.findMany({ where: { userId: String(userId) } });
        const currentTime = new Date();
        const updatedGoals = await Promise.all(
          goals.map(async (goal) => {
            if (goal.status === 'in_progress' && goal.startDate) {
              const timeDiff = (currentTime - new Date(goal.startDate)) / 1000;
              if (timeDiff >= 30) {
                await prismaPostgres.goal.update({
                  where: { id: String(goal.id) },
                  data: { status: 'not_started', startDate: null, completionDate: null },
                });
                return { ...goal, status: 'not_started', startDate: null, completionDate: null };
              }
            } else if (goal.status === 'done' && goal.completionDate) {
              const timeDiff = (currentTime - new Date(goal.completionDate)) / 1000;
              if (timeDiff >= 20) {
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

    app.post('/api/generate-report', async (req, res) => {
      try {
        const { goals } = req.body;
        if (!goals || !Array.isArray(goals) || goals.length === 0) {
          return res.status(400).json({ error: "Присылай массив goals" });
        }

        // статистика
        const doneCount = goals.filter(g => g.status === 'done').length;
        const totalCount = goals.length;
        const ratio = doneCount / totalCount;

        let diaryNote = '';
        if (ratio >= 1) {
          diaryNote = "Сегодня я справился со всеми задачами. Я доволен результатом и чувствую прогресс! 🔥";
        } else if (ratio >= 0.8) {
          diaryNote = "Сегодня я справился почти со всеми задачами. Я почти доволен результатом и чувствую прогресс! 🔥";
        } else if (ratio >= 0.5) {
          diaryNote = "Сегодня я сделал примерно половину запланированного. Есть куда расти, но я на правильном пути. ⚡";
        } else if (doneCount > 0) {
          diaryNote = "Сегодня я выполнил часть целей. Это только начало, завтра сделаю больше. 🌱";
        } else {
          diaryNote = "Сегодня получилось меньше, чем хотелось бы, но я не сдаюсь и завтра точно будет лучше. 💡";
        }

        // Формируем список целей: чистим заголовки, ставим эмодзи и делаем пустую строку между пунктами
        const goalsList = goals
          .map(g => {
            const title = String(g.title || '').replace(/\u00A0/g, ' ').trim(); // убираем NBSP и лишние пробелы
            const status = (g.status === 'done') ? '✅' : '☑️';
            return `${status} ${title}`;
          })
          .join('\n\n'); // одна пустая строка между целями

        // Дата
        const today = new Date().toLocaleDateString('ru-RU', {
          day: 'numeric',
          month: 'long'
        });

        // Собираем финальное сообщение через массив + join — так гарантированно не будет лишних отступов
        const finalMessage = [`${today} #v1 #дд`, goalsList, diaryNote].join('\n\n').trim();

        res.json({ message: finalMessage, success: true });
      } catch (err) {
        console.error('Error in /api/generate-report:', err);
        res.status(500).json({ error: 'Не удалось сгенерировать отчёт: ' + err.message });
      }
    });

    const PORT = process.env.PORT || 5002;
    app.listen(PORT, () => {
      console.log(`✅ Server running on port ${PORT}`);
      console.log(`✅ Hugging Face DialoGPT report generation enabled`);
    });

  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();