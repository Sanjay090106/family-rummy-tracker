
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { prisma } from "./config/prisma";

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    message: "Family Rummy Tracker API is running",
  });
});

app.get("/api/health/db", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    res.status(200).json({
      status: "ok",
      message: "Database connection is healthy",
    });
  } catch (error) {
    console.error(
      "Database health check failed:",
      error instanceof Error ? error.message : "Unknown error",
    );

    res.status(503).json({
      status: "error",
      message: "Database connection is unavailable",
    });
  }
});

export default app;
