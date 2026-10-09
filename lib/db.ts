import { PrismaClient } from "@prisma/client"
import { mockDb } from "./mock-db"
import { getDatabaseConfiguration } from "./runtime-config.mjs"
 
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

const { useMockDb, databaseUrl, nodeEnv } = getDatabaseConfiguration()

let prisma: PrismaClient | null = null

if (!useMockDb) {
  prisma = globalForPrisma.prisma || new PrismaClient({ datasourceUrl: databaseUrl })
  if (nodeEnv !== "production") globalForPrisma.prisma = prisma
}

// Keep one Prisma-shaped contract throughout the application. The development
// mock implements only the delegates used by the app at runtime.
export const db: PrismaClient = (prisma || mockDb) as unknown as PrismaClient
