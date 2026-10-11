import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/server";

describe("GET /api/health", () => {
  it("returns a successful health response", async () => {
    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "ok",
      message: "Family Rummy Tracker API is running",
    });
  });
});