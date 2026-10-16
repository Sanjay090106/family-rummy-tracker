
import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const { queryRawMock } = vi.hoisted(() => ({
    queryRawMock: vi.fn(),
}));

vi.mock("../src/config/prisma", () => ({
    prisma: {
        $queryRaw: queryRawMock,
    },
}));

import app from "../src/server";

afterEach(() => {
    vi.clearAllMocks();
});

describe("GET /api/health/db", () => {
    it("returns success when the database is reachable", async () => {
        queryRawMock.mockResolvedValue([{ "?column?": 1 }]);

        const response = await request(app).get("/api/health/db");

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            status: "ok",
            message: "Database connection is healthy",
        });
    });

    it("returns 503 when the database is unavailable", async () => {
        queryRawMock.mockRejectedValue(new Error("Database connection failed"));

        const response = await request(app).get("/api/health/db");

        expect(response.status).toBe(503);
        expect(response.body).toEqual({
            status: "error",
            message: "Database connection is unavailable",
        });
    });
});
