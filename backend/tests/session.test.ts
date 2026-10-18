import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const { getUserMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
}));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    familyMembership: {
      findUnique: vi.fn(),
    },
    player: {
      findMany: vi.fn(),
    },
    gameSession: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    sessionParticipant: {
      findMany: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
  },
}));

/** Construct a Prisma-like error with a .code property for duck-type mocking. */
function makePrismaKnownError(code: string, meta?: Record<string, unknown>): Error & { code: string; meta: Record<string, unknown> } {
  const err = new Error(`Prisma error ${code}`) as Error & { code: string; meta: Record<string, unknown> };
  err.code = code;
  err.meta = meta ?? {};
  return err;
}

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

vi.mock("../src/config/prisma", () => ({
  prisma: prismaMock,
}));

import app from "../src/server";

describe("Game Sessions API (Step 5)", () => {
  const mockFamilyId = "11111111-1111-4111-8111-111111111111";
  const mockOtherFamilyId = "22222222-2222-4222-8222-222222222222";
  const mockMembershipId = "33333333-3333-4333-8333-333333333333";
  const mockSessionId = "44444444-4444-4444-8444-444444444444";
  const mockPlayerId1 = "55555555-5555-4555-8555-555555555555";
  const mockPlayerId2 = "66666666-6666-4666-8666-666666666666";
  const mockUserId = "user-uuid-111";

  beforeEach(() => {
    vi.clearAllMocks();

    // Simulate SELECT ... FOR UPDATE finding the session row.
    prismaMock.$queryRaw.mockResolvedValue([{ id: "44444444-4444-4444-8444-444444444444" }]);

    prismaMock.$transaction.mockImplementation(async (callback: any) => {
      return await callback(prismaMock);
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication Requirements on all 7 Endpoints", () => {
    it("rejects GET /api/families/:familyId/sessions without auth", async () => {
      const res = await request(app).get(`/api/families/${mockFamilyId}/sessions`);
      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Authorization header is missing");
    });

    it("rejects POST /api/families/:familyId/sessions without auth", async () => {
      const res = await request(app).post(`/api/families/${mockFamilyId}/sessions`).send({});
      expect(res.status).toBe(401);
    });

    it("rejects GET /api/sessions/:sessionId without auth", async () => {
      const res = await request(app).get(`/api/sessions/${mockSessionId}`);
      expect(res.status).toBe(401);
    });

    it("rejects PATCH /api/sessions/:sessionId without auth", async () => {
      const res = await request(app)
        .patch(`/api/sessions/${mockSessionId}`)
        .send({ sessionDate: "2026-10-18" });
      expect(res.status).toBe(401);
    });

    it("rejects POST /api/sessions/:sessionId/participants without auth", async () => {
      const res = await request(app)
        .post(`/api/sessions/${mockSessionId}/participants`)
        .send({ playerIds: [mockPlayerId1] });
      expect(res.status).toBe(401);
    });

    it("rejects POST /api/sessions/:sessionId/complete without auth", async () => {
      const res = await request(app).post(`/api/sessions/${mockSessionId}/complete`);
      expect(res.status).toBe(401);
    });

    it("rejects POST /api/sessions/:sessionId/cancel without auth", async () => {
      const res = await request(app).post(`/api/sessions/${mockSessionId}/cancel`);
      expect(res.status).toBe(401);
    });
  });

  describe("Active Family Membership & Cross-Family Isolation", () => {
    it("rejects session listing when user has no active membership in family", async () => {
      getUserMock.mockResolvedValue({
        data: { user: { id: mockUserId, email: "user@example.com" } },
        error: null,
      });

      prismaMock.familyMembership.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get(`/api/families/${mockOtherFamilyId}/sessions`)
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(403);
      expect(res.body.message).toContain("Access denied: active family membership required");
    });

    it("rejects session details when session belongs to a family where user is not an active member", async () => {
      getUserMock.mockResolvedValue({
        data: { user: { id: mockUserId, email: "user@example.com" } },
        error: null,
      });

      // Session belongs to mockOtherFamilyId
      prismaMock.gameSession.findUnique.mockResolvedValue({
        id: mockSessionId,
        familyId: mockOtherFamilyId,
        participants: [],
      });

      // User has no membership in mockOtherFamilyId
      prismaMock.familyMembership.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get(`/api/sessions/${mockSessionId}`)
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(403);
      expect(res.body.message).toContain("Access denied: active family membership required");
    });
  });

  describe("POST /api/families/:familyId/sessions (Create Session)", () => {
    it("creates a session with strict valid date and links creator membership", async () => {
      getUserMock.mockResolvedValue({
        data: { user: { id: mockUserId, email: "user@example.com" } },
        error: null,
      });

      // authorizeFamily check and service membership check
      prismaMock.familyMembership.findUnique.mockResolvedValue({
        id: mockMembershipId,
        familyId: mockFamilyId,
        supabaseUserId: mockUserId,
        role: "MEMBER",
        status: "ACTIVE",
      });

      prismaMock.gameSession.create.mockResolvedValue({
        id: mockSessionId,
        familyId: mockFamilyId,
        sessionDate: new Date("2026-10-18T00:00:00.000Z"),
        status: "IN_PROGRESS",
        version: 1,
        createdByMembershipId: mockMembershipId,
      });

      prismaMock.gameSession.findUnique.mockResolvedValue({
        id: mockSessionId,
        familyId: mockFamilyId,
        sessionDate: new Date("2026-10-18T00:00:00.000Z"),
        status: "IN_PROGRESS",
        version: 1,
        createdByMembershipId: mockMembershipId,
        participants: [],
      });

      const res = await request(app)
        .post(`/api/families/${mockFamilyId}/sessions`)
        .set("Authorization", "Bearer valid-token")
        .send({ sessionDate: "2026-10-18" });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe("ok");
      expect(res.body.data.id).toBe(mockSessionId);
      expect(res.body.data.createdByMembershipId).toBe(mockMembershipId);
      expect(res.body.data.status).toBe("IN_PROGRESS");
    });

    it("rejects impossible calendar dates (e.g. Feb 30)", async () => {
      getUserMock.mockResolvedValue({
        data: { user: { id: mockUserId, email: "user@example.com" } },
        error: null,
      });

      const res = await request(app)
        .post(`/api/families/${mockFamilyId}/sessions`)
        .set("Authorization", "Bearer valid-token")
        .send({ sessionDate: "2026-02-30" });

      expect(res.status).toBe(400);
      expect(res.body.status).toBe("error");
      expect(res.body.message).toBe("Request validation failed");
    });

    it("creates session with initial participants atomically", async () => {
      getUserMock.mockResolvedValue({
        data: { user: { id: mockUserId, email: "user@example.com" } },
        error: null,
      });

      prismaMock.familyMembership.findUnique.mockResolvedValue({
        id: mockMembershipId,
        familyId: mockFamilyId,
        supabaseUserId: mockUserId,
        role: "MEMBER",
        status: "ACTIVE",
      });

      prismaMock.gameSession.create.mockResolvedValue({
        id: mockSessionId,
        familyId: mockFamilyId,
        sessionDate: new Date("2026-10-18T00:00:00.000Z"),
        status: "IN_PROGRESS",
        version: 1,
        createdByMembershipId: mockMembershipId,
      });

      prismaMock.player.findMany.mockResolvedValue([
        { id: mockPlayerId1, familyId: mockFamilyId, displayName: "Dad", isActive: true },
        { id: mockPlayerId2, familyId: mockFamilyId, displayName: "Mom", isActive: true },
      ]);

      prismaMock.gameSession.findUnique.mockResolvedValue({
        id: mockSessionId,
        familyId: mockFamilyId,
        status: "IN_PROGRESS",
        version: 1,
        participants: [
          { playerId: mockPlayerId1, displayName: "Dad" },
          { playerId: mockPlayerId2, displayName: "Mom" },
        ],
      });

      const res = await request(app)
        .post(`/api/families/${mockFamilyId}/sessions`)
        .set("Authorization", "Bearer valid-token")
        .send({
          sessionDate: "2026-10-18",
          playerIds: [mockPlayerId1, mockPlayerId2],
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe("ok");
      expect(prismaMock.sessionParticipant.create).toHaveBeenCalledTimes(2);
    });
  });

  describe("GET /api/families/:familyId/sessions (List Sessions)", () => {
    it("returns sessions for family with optional status filtering", async () => {
      getUserMock.mockResolvedValue({
        data: { user: { id: mockUserId, email: "user@example.com" } },
        error: null,
      });

      prismaMock.familyMembership.findUnique.mockResolvedValue({
        id: mockMembershipId,
        familyId: mockFamilyId,
        supabaseUserId: mockUserId,
        role: "MEMBER",
        status: "ACTIVE",
      });

      prismaMock.gameSession.findMany.mockResolvedValue([
        {
          id: mockSessionId,
          familyId: mockFamilyId,
          status: "IN_PROGRESS",
          sessionDate: new Date("2026-10-18"),
          _count: { participants: 3, sets: 1 },
        },
      ]);

      const res = await request(app)
        .get(`/api/families/${mockFamilyId}/sessions?status=IN_PROGRESS`)
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.data.length).toBe(1);
      expect(prismaMock.gameSession.findMany).toHaveBeenCalledWith({
        where: {
          familyId: mockFamilyId,
          status: "IN_PROGRESS",
        },
        select: expect.any(Object),
        orderBy: expect.any(Array),
      });
    });
  });

  describe("GET /api/sessions/:sessionId", () => {
    it("returns session details and participants for active member", async () => {
      getUserMock.mockResolvedValue({
        data: { user: { id: mockUserId, email: "user@example.com" } },
        error: null,
      });

      prismaMock.gameSession.findUnique.mockResolvedValue({
        id: mockSessionId,
        familyId: mockFamilyId,
        status: "IN_PROGRESS",
        sessionDate: new Date("2026-10-18"),
        participants: [
          { id: "part-1", playerId: mockPlayerId1, displayName: "Dad" },
        ],
      });

      prismaMock.familyMembership.findUnique.mockResolvedValue({
        id: mockMembershipId,
        familyId: mockFamilyId,
        supabaseUserId: mockUserId,
        status: "ACTIVE",
      });

      const res = await request(app)
        .get(`/api/sessions/${mockSessionId}`)
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.data.id).toBe(mockSessionId);
      expect(res.body.data.participants.length).toBe(1);
    });

    it("returns 404 if session does not exist", async () => {
      getUserMock.mockResolvedValue({
        data: { user: { id: mockUserId, email: "user@example.com" } },
        error: null,
      });

      prismaMock.gameSession.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get(`/api/sessions/${mockSessionId}`)
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(404);
      expect(res.body.message).toBe("Game session not found");
    });
  });

  describe("PATCH /api/sessions/:sessionId (Update Session)", () => {
    it("allows updating sessionDate while IN_PROGRESS", async () => {
      getUserMock.mockResolvedValue({
        data: { user: { id: mockUserId, email: "user@example.com" } },
        error: null,
      });

      prismaMock.gameSession.findUnique
        .mockResolvedValueOnce({
          id: mockSessionId,
          familyId: mockFamilyId,
          status: "IN_PROGRESS",
          participants: [],
        })
        .mockResolvedValueOnce({
          id: mockSessionId,
          familyId: mockFamilyId,
          sessionDate: new Date("2026-10-20T00:00:00.000Z"),
          status: "IN_PROGRESS",
          participants: [],
        });

      prismaMock.familyMembership.findUnique.mockResolvedValue({
        id: mockMembershipId,
        familyId: mockFamilyId,
        supabaseUserId: mockUserId,
        status: "ACTIVE",
      });

      prismaMock.gameSession.updateMany.mockResolvedValue({ count: 1 });

      const res = await request(app)
        .patch(`/api/sessions/${mockSessionId}`)
        .set("Authorization", "Bearer valid-token")
        .send({ sessionDate: "2026-10-20" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(prismaMock.gameSession.updateMany).toHaveBeenCalledWith({
        where: { id: mockSessionId, status: "IN_PROGRESS" },
        data: { sessionDate: expect.any(Date) },
      });
    });

    it("rejects updating session when status is terminal (COMPLETED)", async () => {
      getUserMock.mockResolvedValue({
        data: { user: { id: mockUserId, email: "user@example.com" } },
        error: null,
      });

      prismaMock.gameSession.findUnique.mockResolvedValue({
        id: mockSessionId,
        familyId: mockFamilyId,
        status: "COMPLETED",
        participants: [],
      });

      prismaMock.familyMembership.findUnique.mockResolvedValue({
        id: mockMembershipId,
        familyId: mockFamilyId,
        supabaseUserId: mockUserId,
        status: "ACTIVE",
      });

      const res = await request(app)
        .patch(`/api/sessions/${mockSessionId}`)
        .set("Authorization", "Bearer valid-token")
        .send({ sessionDate: "2026-10-20" });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("terminal status COMPLETED");
      expect(prismaMock.gameSession.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/sessions/:sessionId/participants (Add Participants)", () => {
    it("adds participants and snapshots display name", async () => {
      getUserMock.mockResolvedValue({
        data: { user: { id: mockUserId, email: "user@example.com" } },
        error: null,
      });

      prismaMock.gameSession.findUnique.mockResolvedValue({
        id: mockSessionId,
        familyId: mockFamilyId,
        status: "IN_PROGRESS",
        participants: [],
      });

      prismaMock.familyMembership.findUnique.mockResolvedValue({
        id: mockMembershipId,
        familyId: mockFamilyId,
        supabaseUserId: mockUserId,
        status: "ACTIVE",
      });

      prismaMock.sessionParticipant.findMany.mockResolvedValue([]);

      prismaMock.player.findMany.mockResolvedValue([
        { id: mockPlayerId1, familyId: mockFamilyId, displayName: "Uncle Bob", isActive: true },
      ]);

      prismaMock.sessionParticipant.create.mockResolvedValue({
        id: "part-123",
        sessionId: mockSessionId,
        familyId: mockFamilyId,
        playerId: mockPlayerId1,
        displayName: "Uncle Bob",
        joinedAt: new Date(),
      });

      const res = await request(app)
        .post(`/api/sessions/${mockSessionId}/participants`)
        .set("Authorization", "Bearer valid-token")
        .send({ playerIds: [mockPlayerId1] });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe("ok");
      expect(prismaMock.sessionParticipant.create).toHaveBeenCalledWith({
        data: {
          sessionId: mockSessionId,
          familyId: mockFamilyId,
          playerId: mockPlayerId1,
          displayName: "Uncle Bob",
        },
        select: expect.any(Object),
      });
    });

    it("rejects duplicate participants with 409", async () => {
      getUserMock.mockResolvedValue({
        data: { user: { id: mockUserId, email: "user@example.com" } },
        error: null,
      });

      prismaMock.gameSession.findUnique.mockResolvedValue({
        id: mockSessionId,
        familyId: mockFamilyId,
        status: "IN_PROGRESS",
        participants: [],
      });

      prismaMock.familyMembership.findUnique.mockResolvedValue({
        id: mockMembershipId,
        familyId: mockFamilyId,
        supabaseUserId: mockUserId,
        status: "ACTIVE",
      });

      // Player already in session
      prismaMock.sessionParticipant.findMany.mockResolvedValue([
        { id: "part-1", playerId: mockPlayerId1 },
      ]);

      const res = await request(app)
        .post(`/api/sessions/${mockSessionId}/participants`)
        .set("Authorization", "Bearer valid-token")
        .send({ playerIds: [mockPlayerId1] });

      expect(res.status).toBe(409);
      expect(res.body.message).toContain("already participants");
      expect(prismaMock.sessionParticipant.create).not.toHaveBeenCalled();
    });

    it("rejects inactive players with 400", async () => {
      getUserMock.mockResolvedValue({
        data: { user: { id: mockUserId, email: "user@example.com" } },
        error: null,
      });

      prismaMock.gameSession.findUnique.mockResolvedValue({
        id: mockSessionId,
        familyId: mockFamilyId,
        status: "IN_PROGRESS",
        participants: [],
      });

      prismaMock.familyMembership.findUnique.mockResolvedValue({
        id: mockMembershipId,
        familyId: mockFamilyId,
        supabaseUserId: mockUserId,
        status: "ACTIVE",
      });

      prismaMock.sessionParticipant.findMany.mockResolvedValue([]);

      prismaMock.player.findMany.mockResolvedValue([
        { id: mockPlayerId1, familyId: mockFamilyId, displayName: "Inactive Bob", isActive: false },
      ]);

      const res = await request(app)
        .post(`/api/sessions/${mockSessionId}/participants`)
        .set("Authorization", "Bearer valid-token")
        .send({ playerIds: [mockPlayerId1] });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("Cannot add inactive player");
      expect(prismaMock.sessionParticipant.create).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/sessions/:sessionId/complete & /cancel (Transitions)", () => {
    it("completes session, increments version, and requires at least 2 participants", async () => {
      getUserMock.mockResolvedValue({
        data: { user: { id: mockUserId, email: "user@example.com" } },
        error: null,
      });

      prismaMock.gameSession.findUnique
        .mockResolvedValueOnce({
          id: mockSessionId,
          familyId: mockFamilyId,
          status: "IN_PROGRESS",
          version: 1,
          participants: [],
        })
        // Session status read after acquiring the row lock.
        .mockResolvedValueOnce({
          id: mockSessionId,
          familyId: mockFamilyId,
          status: "IN_PROGRESS",
          version: 1,
          participants: [],
        })
        // Session returned after the conditional transition.
        .mockResolvedValueOnce({
          id: mockSessionId,
          familyId: mockFamilyId,
          status: "COMPLETED",
          version: 2,
          participants: [],
        });

      prismaMock.familyMembership.findUnique.mockResolvedValue({
        id: mockMembershipId,
        familyId: mockFamilyId,
        supabaseUserId: mockUserId,
        status: "ACTIVE",
      });

      // Has 2 participants
      prismaMock.sessionParticipant.count.mockResolvedValue(2);
      prismaMock.gameSession.updateMany.mockResolvedValue({ count: 1 });

      const res = await request(app)
        .post(`/api/sessions/${mockSessionId}/complete`)
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(prismaMock.gameSession.updateMany).toHaveBeenCalledWith({
        where: { id: mockSessionId, status: "IN_PROGRESS" },
        data: { status: "COMPLETED", version: { increment: 1 } },
      });
    });

    it("rejects completion with fewer than 2 participants", async () => {
      getUserMock.mockResolvedValue({
        data: { user: { id: mockUserId, email: "user@example.com" } },
        error: null,
      });

      prismaMock.gameSession.findUnique.mockResolvedValue({
        id: mockSessionId,
        familyId: mockFamilyId,
        status: "IN_PROGRESS",
        participants: [],
      });

      prismaMock.familyMembership.findUnique.mockResolvedValue({
        id: mockMembershipId,
        familyId: mockFamilyId,
        supabaseUserId: mockUserId,
        status: "ACTIVE",
      });

      // Only 1 participant
      prismaMock.sessionParticipant.count.mockResolvedValue(1);

      const res = await request(app)
        .post(`/api/sessions/${mockSessionId}/complete`)
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("at least 2 participants are required");
      expect(prismaMock.gameSession.updateMany).not.toHaveBeenCalled();
    });

    it("cancels session atomically and increments version", async () => {
      getUserMock.mockResolvedValue({
        data: { user: { id: mockUserId, email: "user@example.com" } },
        error: null,
      });

      prismaMock.gameSession.findUnique
        .mockResolvedValueOnce({
          id: mockSessionId,
          familyId: mockFamilyId,
          status: "IN_PROGRESS",
          version: 1,
          participants: [],
        })
        // Session status read after acquiring the row lock.
        .mockResolvedValueOnce({
          id: mockSessionId,
          familyId: mockFamilyId,
          status: "IN_PROGRESS",
          version: 1,
          participants: [],
        })
        // Session returned after the conditional transition.
        .mockResolvedValueOnce({
          id: mockSessionId,
          familyId: mockFamilyId,
          status: "CANCELLED",
          version: 2,
          participants: [],
        });

      prismaMock.familyMembership.findUnique.mockResolvedValue({
        id: mockMembershipId,
        familyId: mockFamilyId,
        supabaseUserId: mockUserId,
        status: "ACTIVE",
      });

      prismaMock.gameSession.updateMany.mockResolvedValue({ count: 1 });

      const res = await request(app)
        .post(`/api/sessions/${mockSessionId}/cancel`)
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(prismaMock.gameSession.updateMany).toHaveBeenCalledWith({
        where: { id: mockSessionId, status: "IN_PROGRESS" },
        data: { status: "CANCELLED", version: { increment: 1 } },
      });
    });

    it("rejects cancelling already terminal session (COMPLETED)", async () => {
      getUserMock.mockResolvedValue({
        data: { user: { id: mockUserId, email: "user@example.com" } },
        error: null,
      });

      prismaMock.gameSession.findUnique.mockResolvedValue({
        id: mockSessionId,
        familyId: mockFamilyId,
        status: "COMPLETED",
        version: 2,
        participants: [],
      });

      prismaMock.familyMembership.findUnique.mockResolvedValue({
        id: mockMembershipId,
        familyId: mockFamilyId,
        supabaseUserId: mockUserId,
        status: "ACTIVE",
      });

      const res = await request(app)
        .post(`/api/sessions/${mockSessionId}/cancel`)
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("status COMPLETED");
      expect(prismaMock.gameSession.updateMany).not.toHaveBeenCalled();
    });

    // ── Step 5.1 Regression: Concurrent Transition ───────────────────────────
    it("returns 409 when conditional updateMany returns count:0 (concurrent transition — complete)", async () => {
      getUserMock.mockResolvedValue({
        data: { user: { id: mockUserId, email: "user@example.com" } },
        error: null,
      });

      prismaMock.gameSession.findUnique.mockResolvedValue({
        id: mockSessionId,
        familyId: mockFamilyId,
        status: "IN_PROGRESS",
        version: 1,
        participants: [],
      });

      prismaMock.familyMembership.findUnique.mockResolvedValue({
        id: mockMembershipId,
        familyId: mockFamilyId,
        supabaseUserId: mockUserId,
        status: "ACTIVE",
      });

      prismaMock.sessionParticipant.count.mockResolvedValue(2);
      // Simulate a concurrent process already completing the session
      prismaMock.gameSession.updateMany.mockResolvedValue({ count: 0 });

      const res = await request(app)
        .post(`/api/sessions/${mockSessionId}/complete`)
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(409);
      expect(res.body.message).toContain("concurrently updated");
    });

    it("returns 409 when conditional updateMany returns count:0 (concurrent transition — cancel)", async () => {
      getUserMock.mockResolvedValue({
        data: { user: { id: mockUserId, email: "user@example.com" } },
        error: null,
      });

      prismaMock.gameSession.findUnique.mockResolvedValue({
        id: mockSessionId,
        familyId: mockFamilyId,
        status: "IN_PROGRESS",
        version: 1,
        participants: [],
      });

      prismaMock.familyMembership.findUnique.mockResolvedValue({
        id: mockMembershipId,
        familyId: mockFamilyId,
        supabaseUserId: mockUserId,
        status: "ACTIVE",
      });

      // Simulate a concurrent process already cancelling the session
      prismaMock.gameSession.updateMany.mockResolvedValue({ count: 0 });

      const res = await request(app)
        .post(`/api/sessions/${mockSessionId}/cancel`)
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(409);
      expect(res.body.message).toContain("concurrently updated");
    });
  });

  // ── Step 5.1 Regression: P2002 Duplicate-Participant and Rollback ─────────
  describe("POST /api/sessions/:sessionId/participants — P2002 concurrent insert regression", () => {
    it("maps Prisma P2002 on sessionParticipant.create to HTTP 409 (concurrent duplicate insert)", async () => {
      getUserMock.mockResolvedValue({
        data: { user: { id: mockUserId, email: "user@example.com" } },
        error: null,
      });

      prismaMock.gameSession.findUnique.mockResolvedValue({
        id: mockSessionId,
        familyId: mockFamilyId,
        status: "IN_PROGRESS",
        participants: [],
      });

      prismaMock.familyMembership.findUnique.mockResolvedValue({
        id: mockMembershipId,
        familyId: mockFamilyId,
        supabaseUserId: mockUserId,
        status: "ACTIVE",
      });

      // No pre-existing participants detected (race window between check and insert)
      prismaMock.sessionParticipant.findMany.mockResolvedValue([]);

      prismaMock.player.findMany.mockResolvedValue([
        { id: mockPlayerId1, familyId: mockFamilyId, displayName: "Dad", isActive: true },
      ]);

      // Simulate P2002 thrown by the DB during the insert
      const p2002 = makePrismaKnownError("P2002", {
        target: ["sessionId", "playerId"],
      });

      // Override the transaction to pass through but have sessionParticipant.create throw
      prismaMock.$transaction.mockImplementation(async (callback: any) => {
        // On first call to create, throw P2002
        prismaMock.sessionParticipant.create.mockRejectedValueOnce(p2002);
        return await callback(prismaMock);
      });

      const res = await request(app)
        .post(`/api/sessions/${mockSessionId}/participants`)
        .set("Authorization", "Bearer valid-token")
        .send({ playerIds: [mockPlayerId1] });

      // The service should catch P2002 and translate it to 409
      expect(res.status).toBe(409);
      expect(res.body.message).toContain("concurrently added");
    });

    it("re-throws unrelated Prisma errors (not P2002) as 500", async () => {
      getUserMock.mockResolvedValue({
        data: { user: { id: mockUserId, email: "user@example.com" } },
        error: null,
      });

      prismaMock.gameSession.findUnique.mockResolvedValue({
        id: mockSessionId,
        familyId: mockFamilyId,
        status: "IN_PROGRESS",
        participants: [],
      });

      prismaMock.familyMembership.findUnique.mockResolvedValue({
        id: mockMembershipId,
        familyId: mockFamilyId,
        supabaseUserId: mockUserId,
        status: "ACTIVE",
      });

      prismaMock.sessionParticipant.findMany.mockResolvedValue([]);

      prismaMock.player.findMany.mockResolvedValue([
        { id: mockPlayerId1, familyId: mockFamilyId, displayName: "Dad", isActive: true },
      ]);

      // Simulate an unrelated Prisma error (P1001 = connection refused)
      const p1001 = makePrismaKnownError("P1001");

      prismaMock.$transaction.mockImplementation(async (callback: any) => {
        prismaMock.sessionParticipant.create.mockRejectedValueOnce(p1001);
        return await callback(prismaMock);
      });

      const res = await request(app)
        .post(`/api/sessions/${mockSessionId}/participants`)
        .set("Authorization", "Bearer valid-token")
        .send({ playerIds: [mockPlayerId1] });

      // Non-P2002 errors should surface as 500
      expect(res.status).toBe(500);
    });
  });
});
