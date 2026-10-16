import { prisma } from "./config/prisma";
import app from "./server";

const PORT = Number(process.env.PORT) || 3000;

async function startServer() {
  try {
    await prisma.$connect();

    const server = app.listen(PORT, () => {
      console.log(
        `Family Rummy Tracker API running on http://localhost:${PORT}`,
      );
    });

    let isShuttingDown = false;

    const shutdown = (signal: string) => {
      if (isShuttingDown) {
        return;
      }

      isShuttingDown = true;
      console.log(`${signal} received. Shutting down gracefully.`);

      server.close((error) => {
        void (async () => {
          try {
            await prisma.$disconnect();
          } catch (disconnectError) {
            console.error("Failed to disconnect Prisma:", disconnectError);
            process.exitCode = 1;
          }

          if (error) {
            console.error("Failed to close HTTP server:", error);
            process.exitCode = 1;
          }
        })();
      });
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  } catch (error) {
    console.error("Failed to start the API server:", error);

    try {
      await prisma.$disconnect();
    } catch (disconnectError) {
      console.error("Failed to disconnect Prisma:", disconnectError);
    }

    process.exitCode = 1;
  }
}

void startServer();
