import { PrismaClient } from "@prisma/client";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to run this migration");
}

const prisma = new PrismaClient();
let migrated = 0;

try {
  const documents = await prisma.templateFile.findMany({
    select: { id: true, content: true },
  });

  for (const document of documents) {
    if (typeof document.content !== "string") continue;

    let content;
    try {
      content = JSON.parse(document.content);
    } catch {
      console.warn(`Skipping ${document.id}: content is not valid JSON`);
      continue;
    }

    await prisma.templateFile.update({
      where: { id: document.id },
      data: { content },
    });
    migrated += 1;
  }

  console.log(`Migrated ${migrated} template document(s) to native JSON.`);
} finally {
  await prisma.$disconnect();
}
