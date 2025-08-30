import { PrismaClient } from '@prisma/client';

console.log('Initializing Prisma MongoDB client...');
console.log('MONGODB_URL:', process.env.MONGODB_URL);

if (!process.env.MONGODB_URL) {
  throw new Error('MONGODB_URL is not defined in .env');
}

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.MONGODB_URL,
    },
  },
});

console.log('Prisma MongoDB client initialized successfully');
console.log('prisma.user defined:', !!prisma.user);

prisma.$connect()
  .then(() => console.log('Prisma MongoDB connected successfully'))
  .catch((err) => {
    console.error('Prisma MongoDB connection error:', err);
    throw err;
  });