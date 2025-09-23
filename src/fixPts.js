import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const updated = await prisma.user.updateMany({
    where: {},
    data: { pts: 0 },
  });

  console.log(`✅ Updated ${updated.count} users, set pts = 0`);
}

main()
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
