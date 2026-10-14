import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

dotenv.config({ path: "backend/.env" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations"
  },
  datasource: {
    url: process.env["DATABASE_URL"] ?? "",
    shadowDatabaseUrl: process.env["SHADOW_DATABASE_URL"]
  }
});
