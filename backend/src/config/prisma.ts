
import dotenv from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const result = dotenv.config({ path: ".env" });

if (result.error) {
    throw new Error("Could not load .env");
}

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    throw new Error("DATABASE_URL is missing from backend/.env");
}

const adapter = new PrismaPg(connectionString);

export const prisma = new PrismaClient({ adapter });
