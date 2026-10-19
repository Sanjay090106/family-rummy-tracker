
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { prisma } from "./config/prisma";

import familyRoutes from "./routes/family.routes";
import invitationRoutes from "./routes/invitation.routes";
import memberRoutes from "./routes/member.routes";
import playerRoutes from "./routes/player.routes";
import sessionRoutes from "./routes/session.routes";
import scoringRoutes from "./routes/scoring.routes";

import { errorHandler } from "./middleware/error-handler";

const app = express();

// Security and request middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Health check
app.get("/api/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    message: "Family Rummy Tracker API is running",
  });
});

// Database health check
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

// API routes
app.use("/api", familyRoutes);
app.use("/api", invitationRoutes);
app.use("/api", memberRoutes);
app.use("/api", playerRoutes);
app.use("/api", sessionRoutes);
app.use("/api", scoringRoutes);

// Centralized error handler
// Must be registered after all routes.
app.use(errorHandler);

export default app;
