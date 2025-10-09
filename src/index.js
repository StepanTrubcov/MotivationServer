import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { createCanvas, loadImage } from 'canvas';
import fs from 'fs';
import multer from 'multer';

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
    // Ищем существующего пользователя
    const existingUser = await prisma.user.findUnique({
      where: { telegramId: String(telegramId) },
    });

    if (existingUser) {
      // Удаляем все достижения
      await prisma.achievement.deleteMany({ where: { userId: existingUser.id } });

      // Удаляем самого пользователя
      await prisma.user.delete({ where: { id: existingUser.id } });
    }

    // Создаём нового пользователя с переданными данными
    const newUser = await prisma.user.create({
      data: {
        telegramId: String(telegramId),
        firstName,
        username,
        photoUrl,
        registrationDate: new Date(),
        pts: 0,
        completedDates: [],
      },
    });

    res.json(newUser);
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
        if (!goalsArray || !Array.isArray(goalsArray)) {
          return res.status(400).json({ error: 'goalsArray must be an array' });
        }

        for (const goal of goalsArray) {
          if (!goal.id || !goal.title || !goal.points || !goal.status || !goal.description) {
            return res.status(400).json({ error: `Invalid goal data: ${JSON.stringify(goal)}` });
          }

          let statusValue;
          switch (goal.status) {
            case 'done': statusValue = 'completed'; break;
            case 'in_progress':
            case 'not_started': statusValue = goal.status; break;
            default:
              return res.status(400).json({ error: `Invalid status value: ${goal.status}` });
          }

          // УНИКАЛЬНЫЙ ID ДЛЯ КАЖДОГО ПОЛЬЗОВАТЕЛЯ
          const uniqueGoalId = `${userId}_${goal.id}`;

          await prismaPostgres.goal.upsert({
            where: { id: uniqueGoalId },
            update: {
              title: goal.title,
              points: goal.points,
              status: statusValue,
              completionDate: goal.completionDate ? new Date(goal.completionDate) : null,
              description: goal.description,
              userId: String(userId),
              startDate: goal.startDate ? new Date(goal.startDate) : null,
              progress: goal.progress || 0,
            },
            create: {
              id: uniqueGoalId,
              title: goal.title,
              points: goal.points,
              status: statusValue,
              completionDate: goal.completionDate ? new Date(goal.completionDate) : null,
              description: goal.description,
              userId: String(userId),
              startDate: goal.startDate ? new Date(goal.startDate) : null,
              progress: goal.progress || 0,
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

        let statusValue;
        switch (newStatus) {
          case 'done':
            statusValue = 'completed';
            break;
          case 'in_progress':
          case 'not_started':
            statusValue = newStatus;
            break;
          default:
            return res.status(400).json({ error: 'Invalid status value' });
        }

        const updatedGoal = await prismaPostgres.goal.update({
          where: { id: String(goalId) },
          data: {
            status: statusValue,
            startDate: statusValue === 'in_progress' && !goal.startDate ? new Date() : goal.startDate,
            completionDate: statusValue === 'completed' ? new Date() : goal.completionDate,
            progress: statusValue === 'completed' ? { increment: 1 } : undefined,
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
        // Получаем все цели пользователя
        const goals = await prismaPostgres.goal.findMany({ where: { userId: String(userId) } });
        const now = new Date();

        // Определяем начало текущего дня
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        const updatedGoals = await Promise.all(
          goals.map(async (goal) => {
            // 1️⃣ Цели в статусе "in_progress" проверяем на 30 дней
            if (goal.status === 'in_progress' && goal.startDate) {
              const startDate = new Date(goal.startDate);
              const daysDiff = Math.floor((now - startDate) / (1000 * 60 * 60 * 24)); // разница в днях
              if (daysDiff >= 30) {
                await prismaPostgres.goal.update({
                  where: { id: String(goal.id) },
                  data: {
                    status: 'not_started',
                    startDate: null,
                    completionDate: null,
                  },
                });
                return { ...goal, status: 'not_started', startDate: null, completionDate: null };
              }
            }

            // 2️⃣ Цели в статусе "completed" проверяем относительно начала дня
            else if (goal.status === 'completed' && goal.completionDate) {
              const completionDate = new Date(goal.completionDate);
              if (completionDate < startOfToday) { // если цель была завершена до сегодняшнего дня
                await prismaPostgres.goal.update({
                  where: { id: String(goal.id) },
                  data: {
                    status: 'in_progress', // меняем статус на in_progress
                    completionDate: null,  // сбрасываем completionDate
                    // startDate оставляем без изменений
                  },
                });
                return { ...goal, status: 'in_progress', completionDate: null };
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
        const doneCount = goals.filter(g => g.status === 'completed').length;
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
            const status = (g.status === 'completed') ? '✅' : '☑️';
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

    app.post('/api/users/:userId/achievements', async (req, res) => {
      const { userId } = req.params;
      const { achievements } = req.body;

      if (!achievements || !Array.isArray(achievements)) {
        return res.status(400).json({ error: 'Achievements must be an array' });
      }

      try {
        const processedAchievements = [];

        for (const ach of achievements) {
          // Проверяем есть ли такое достижение
          const existing = await prisma.achievement.findFirst({
            where: { userId, title: ach.title }
          });

          if (existing) {
            // ⚡ Ничего не меняем, просто возвращаем как есть
            processedAchievements.push(existing);
          } else {
            // ⚡ Если достижения нет — создаём
            const created = await prisma.achievement.create({
              data: {
                title: ach.title,
                description: ach.description,
                requirement: ach.requirement,
                status: ach.status,
                image: ach.image,
                points: ach.points,
                type: ach.type,
                goalIds: ach.goalIds || [],
                target: ach.target,
                userId
              }
            });
            processedAchievements.push(created);
          }
        }

        res.json(processedAchievements);
      } catch (err) {
        console.error('Error saving achievements:', err);
        res.status(500).json({ error: 'Не удалось сохранить достижения' });
      }
    });

    app.get('/api/users/:userId/achievements', async (req, res) => {
      const { userId } = req.params;

      try {
        const achievements = await prisma.achievement.findMany({
          where: { userId }
        });
        res.json(achievements);
      } catch (err) {
        console.error('Error fetching achievements:', err);
        res.status(500).json({ error: 'Не удалось получить достижения' });
      }
    });

    app.put('/api/users/:userId/achievements/:achievementId/status', async (req, res) => {
      const { userId, achievementId } = req.params;
      const { newStatus } = req.body;

      if (!newStatus) {
        return res.status(400).json({ error: 'newStatus is required' });
      }

      try {
        // Проверяем, что достижение принадлежит юзеру
        const achievement = await prisma.achievement.findFirst({
          where: { id: String(achievementId), userId: String(userId) }
        });

        if (!achievement) {
          return res.status(404).json({ error: 'Achievement not found' });
        }

        const updated = await prisma.achievement.update({
          where: { id: achievement.id },
          data: { status: newStatus }
        });

        res.json(updated);
      } catch (err) {
        console.error('Error updating achievement status:', err);
        res.status(500).json({ error: 'Не удалось изменить статус достижения' });
      }
    });

    app.post('/api/achievement/share', async (req, res) => {
      try {
        const { title, description, image, points, username } = req.body;

        if (!title || !description) {
          return res.status(400).json({ success: false, message: 'Не хватает данных' });
        }

        const width = 1200;
        const height = 630;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#0b0b0b';
        ctx.fillRect(0, 0, width, height);

        ctx.fillStyle = '#00ff99';
        ctx.font = 'bold 48px Inter';
        ctx.textAlign = 'left';
        ctx.fillText(`@${username || 'user'}`, 80, 100);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 80px Inter';
        ctx.fillText(title, 80, 200);

        ctx.font = '34px Inter';
        ctx.fillStyle = '#ffffff';
        const maxWidth = width - 160;
        const words = description.split(' ');
        let line = '';
        let y = 270;
        for (const word of words) {
          const testLine = line + word + ' ';
          const metrics = ctx.measureText(testLine);
          if (metrics.width > maxWidth) {
            ctx.fillText(line.trim(), 80, y);
            line = word + ' ';
            y += 45;
          } else {
            line = testLine;
          }
        }
        ctx.fillText(line.trim(), 80, y);

        ctx.fillStyle = '#00ff99';
        ctx.font = 'bold 40px Inter';
        ctx.fillText(`+${points || 0} очков`, 80, y + 70);

        const quotes = [
          '«Ты не обязан быть лучшим — просто будь лучше, чем вчера 💫»',
          '«Маленькие шаги каждый день ведут к большим результатам 🌱»',
          '«Дисциплина сильнее мотивации ⚡️»',
          '«Начни сейчас. Идеального момента не будет ⏳»',
          '«Пусть каждый день будет на 1% лучше, чем вчера 🚀»',
        ];
        const randomQuote = quotes[Math.floor(Math.random() * quotes.length)];

        ctx.font = 'italic 30px Inter';
        ctx.fillStyle = '#9b9b9b';
        ctx.fillText(randomQuote, 80, height - 60);

        const base64 = canvas.toDataURL('image/png');

        res.json({
          success: true,
          url: base64,
        });
      } catch (err) {
        console.error('❌ Ошибка генерации share-картинки:', err);
        res.status(500).json({ success: false, message: 'Ошибка генерации изображения' });
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