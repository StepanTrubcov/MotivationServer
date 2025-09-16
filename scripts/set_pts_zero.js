// scripts/set_pts_zero.js
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Setting pts = 0 for all users (this will update all user documents)...');
  const result = await prisma.user.updateMany({
    data: {
      pts: 0
    }
  });
  console.log('Updated count:', result.count);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
