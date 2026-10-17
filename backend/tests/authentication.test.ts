import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express, { Request, Response } from "express";
import { z } from "zod";

const { getUserMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
}));

vi.mock("../src/config/supabase", () => ({
  getSupabaseClient: () => ({
    auth: {
      getUser: getUserMock,
    },
  }),
  supabase: {
    get auth() {
      return {
        getUser: getUserMock,
      };
    },
  },
}));

import { authenticate } from "../src/middleware/authenticate";
import { validateRequest } from "../src/middleware/validate-request";
import { errorHandler } from "../src/middleware/error-handler";

function createTestApp() {
  const app = express();
  app.use(express.json());

  // Protected route testing authenticate middleware
  app.get("/api/test-protected", authenticate, (req: Request, res: Response) => {
    res.status(200).json({
      status: "ok",
      user: req.user,
    });
  });

  // Protected route with validation
  const testValidationSchema = {
    params: z.object({
      id: z.string().uuid(),
    }),
    query: z.object({
      filter: z.string().min(1),
    }),
    body: z.object({
      name: z.string().min(2),
    }),
  };

  app.post(
    "/api/test-validation/:id",
    authenticate,
    validateRequest(testValidationSchema),
    (req: Request, res: Response) => {
      res.status(200).json({
        status: "ok",
        params: req.params,
        query: req.query,
        body: req.body,
        user: req.user,
      });
    }
  );

  // Route triggering unexpected 500 error
  app.get("/api/test-crash", (_req: Request, _res: Response) => {
    throw new Error("Internal secret connection string leak attempt");
  });

  app.use(errorHandler);

  return app;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("Authentication & Security Middleware", () => {
  const testApp = createTestApp();

  describe("Token Verification & Client User-ID Independence", () => {
    it("rejects requests missing an Authorization header", async () => {
      const response = await request(testApp).get("/api/test-protected");

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        status: "error",
        message: "Authorization header is missing",
      });
      expect(getUserMock).not.toHaveBeenCalled();
    });

    it("rejects non-Bearer authorization schemes", async () => {
      const response = await request(testApp)
        .get("/api/test-protected")
        .set("Authorization", "Basic dXNlcjpwYXNz");

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        status: "error",
        message: "Authorization header must use Bearer scheme",
      });
      expect(getUserMock).not.toHaveBeenCalled();
    });

    it("rejects malformed Bearer header without token", async () => {
      const response = await request(testApp)
        .get("/api/test-protected")
        .set("Authorization", "Bearer ");

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        status: "error",
        message: "Bearer token is missing",
      });
      expect(getUserMock).not.toHaveBeenCalled();
    });

    it("rejects invalid or expired token returned by Supabase", async () => {
      getUserMock.mockResolvedValue({
        data: { user: null },
        error: { message: "Invalid JWT token" },
      });

      const response = await request(testApp)
        .get("/api/test-protected")
        .set("Authorization", "Bearer invalid-token");

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        status: "error",
        message: "Invalid or expired authentication token",
      });
      expect(getUserMock).toHaveBeenCalledWith("invalid-token");
    });

    it("authenticates valid token and populates server-verified user info, ignoring any client spoofing", async () => {
      const verifiedUser = {
        id: "server-verified-uuid-456",
        email: "verified@example.com",
        app_metadata: { role: "member" },
        user_metadata: { displayName: "Alice" },
        aud: "authenticated",
        role: "authenticated",
      };

      getUserMock.mockResolvedValue({
        data: { user: verifiedUser },
        error: null,
      });

      const response = await request(testApp)
        .get("/api/test-protected")
        .set("Authorization", "Bearer valid-jwt-token")
        .set("x-user-id", "spoofed-user-id-999"); // client attempts to supply forged user ID

      expect(response.status).toBe(200);
      expect(response.body.status).toBe("ok");
      expect(response.body.user.id).toBe("server-verified-uuid-456");
      expect(response.body.user.email).toBe("verified@example.com");
      expect(getUserMock).toHaveBeenCalledWith("valid-jwt-token");
    });
  });

  describe("Request Validation Middleware", () => {
    it("returns 400 with structured validation issues for invalid params, query, and body", async () => {
      getUserMock.mockResolvedValue({
        data: {
          user: {
            id: "user-123",
            email: "test@example.com",
          },
        },
        error: null,
      });

      const response = await request(testApp)
        .post("/api/test-validation/not-a-uuid")
        .set("Authorization", "Bearer valid-token")
        .query({ filter: "" })
        .send({ name: "A" });

      expect(response.status).toBe(400);
      expect(response.body.status).toBe("error");
      expect(response.body.message).toBe("Request validation failed");
      expect(Array.isArray(response.body.errors)).toBe(true);
      expect(response.body.errors.length).toBeGreaterThan(0);
    });

    it("passes validation when params, query, and body meet schema requirements", async () => {
      const validUuid = "123e4567-e89b-12d3-a456-426614174000";
      getUserMock.mockResolvedValue({
        data: {
          user: {
            id: "user-123",
            email: "test@example.com",
          },
        },
        error: null,
      });

      const response = await request(testApp)
        .post(`/api/test-validation/${validUuid}`)
        .set("Authorization", "Bearer valid-token")
        .query({ filter: "active" })
        .send({ name: "Family Game Night" });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe("ok");
      expect(response.body.params.id).toBe(validUuid);
      expect(response.body.query.filter).toBe("active");
      expect(response.body.body.name).toBe("Family Game Night");
    });
  });

  describe("Centralized Error Handler", () => {
    it("returns generic 500 error and masks sensitive internal details or stack traces", async () => {
      const response = await request(testApp).get("/api/test-crash");

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        status: "error",
        message: "Internal server error",
      });
      expect(response.body.stack).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toContain("secret connection string");
    });

    it("handles malformed JSON body payloads with clean 400 error", async () => {
      const response = await request(testApp)
        .post("/api/test-validation/123e4567-e89b-12d3-a456-426614174000")
        .set("Authorization", "Bearer valid-token")
        .set("Content-Type", "application/json")
        .send("invalid-json{");

      expect(response.status).toBe(400);
      expect(response.body.status).toBe("error");
      expect(response.body.message).toBe("Malformed JSON payload in request body");
    });
  });
});
