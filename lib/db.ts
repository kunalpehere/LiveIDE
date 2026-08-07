import { PrismaClient } from "@prisma/client"
import { mockDb } from "./mock-db"
 
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

const useMockDb =
  process.env.NODE_ENV === "development" &&
  process.env.ENABLE_MOCK_DB === "true"

if (process.env.ENABLE_MOCK_DB === "true" && process.env.NODE_ENV !== "development") {
  throw new Error("ENABLE_MOCK_DB may only be used when NODE_ENV=development")
}

if (!useMockDb && !process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is required. For local in-memory development only, set ENABLE_MOCK_DB=true.",
  )
}

let prisma: PrismaClient | null = null

if (!useMockDb) {
  prisma = globalForPrisma.prisma || new PrismaClient()
  if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma
}

// Keep one Prisma-shaped contract throughout the application. The development
// mock implements only the delegates used by the app at runtime.
export const db: PrismaClient = (prisma || mockDb) as unknown as PrismaClient
