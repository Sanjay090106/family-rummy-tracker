
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

    gameSession: {
      findUnique: vi.fn(),
    },

    gameSet: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },

    round: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },

    sessionParticipant: {
      findMany: vi.fn(),
      count: vi.fn(),
    },

    roundScore: {
      count: vi.fn(),
      createMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      groupBy: vi.fn(),
    },

    scoreAudit: {
      create: vi.fn(),
    },
  },
}));

vi.mock("../src/config/supabase", () => ({
  getSupabaseClient: () => ({
    auth: {
      getUser: getUserMock,
    },
  }),
  supabase: {
    get auth() {
      return { getUser: getUserMock };
    },
  },
}));

vi.mock("../src/config/prisma", () => ({
  prisma: prismaMock,
}));

import app from "../src/server";

describe("Scoring API", () => {
  const familyId = "11111111-1111-4111-8111-111111111111";
  const membershipId = "33333333-3333-4333-8333-333333333333";
  const sessionId = "44444444-4444-4444-8444-444444444444";
  const setId = "77777777-7777-4777-8777-777777777777";
  const roundId = "88888888-8888-4888-8888-888888888888";
  const scoreId = "99999999-9999-4999-8999-999999999999";

  const participant1 = "55555555-5555-4555-8555-555555555555";
  const participant2 = "66666666-6666-4666-8666-666666666666";
  const userId = "user-uuid-111";

  const session = {
    id: sessionId,
    familyId,
    status: "IN_PROGRESS",
    version: 1,
  };

  const membership = {
    id: membershipId,
    familyId,
    status: "ACTIVE",
  };

  const auth = () => ({
    data: {
      user: {
        id: userId,
        email: "user@example.com",
      },
    },
    error: null,
  });

  const authenticateRequest = (req: request.Test) =>
    req.set("Authorization", "Bearer valid-token");

  beforeEach(() => {
    vi.clearAllMocks();

    getUserMock.mockResolvedValue(auth());

    prismaMock.gameSession.findUnique.mockResolvedValue(session);
    prismaMock.familyMembership.findUnique.mockResolvedValue(membership);

    prismaMock.$queryRaw.mockResolvedValue([{ id: sessionId }]);

    prismaMock.$transaction.mockImplementation(
      async (callback: (tx: typeof prismaMock) => unknown) =>
        await callback(prismaMock),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication and family access", () => {
    it("rejects an unauthenticated request to list sets", async () => {
      const res = await request(app).get(
        `/api/sessions/${sessionId}/sets`,
      );

      expect(res.status).toBe(401);
    });

    it("rejects leaderboard access without active family membership", async () => {
      prismaMock.familyMembership.findUnique.mockResolvedValue(null);

      const res = await authenticateRequest(
        request(app).get(`/api/sessions/${sessionId}/leaderboard`),
      );

      expect(res.status).toBe(403);
      expect(res.body.message).toContain("active member");
    });

    it("rejects a session that does not exist", async () => {
      prismaMock.gameSession.findUnique.mockResolvedValue(null);

      const res = await authenticateRequest(
        request(app).get(`/api/sessions/${sessionId}/leaderboard`),
      );

      expect(res.status).toBe(404);
    });
  });

  describe("Set creation", () => {
    it("creates the next sequential set", async () => {
      prismaMock.gameSet.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ setNumber: 2 });

      prismaMock.gameSet.create.mockResolvedValue({
        id: setId,
        sessionId,
        setNumber: 3,
        status: "IN_PROGRESS",
      });

      const res = await authenticateRequest(
        request(app).post(`/api/sessions/${sessionId}/sets`),
      );

      expect(res.status).toBe(201);
      expect(res.body.data.setNumber).toBe(3);
      expect(prismaMock.gameSet.create).toHaveBeenCalledWith({
        data: {
          sessionId,
          setNumber: 3,
          status: "IN_PROGRESS",
        },
      });
    });

    it("does not create another set while one is unfinished", async () => {
      prismaMock.gameSet.findFirst.mockResolvedValueOnce({ id: setId });

      const res = await authenticateRequest(
        request(app).post(`/api/sessions/${sessionId}/sets`),
      );

      expect(res.status).toBe(409);
      expect(prismaMock.gameSet.create).not.toHaveBeenCalled();
    });
  });

  describe("Score entry validation", () => {
    it("rejects negative points", async () => {
      const res = await authenticateRequest(
        request(app)
          .post(`/api/sessions/${sessionId}/rounds/${roundId}/scores`)
          .send({
            scores: [
              { participantId: participant1, points: -5 },
              { participantId: participant2, points: 10 },
            ],
          }),
      );

      expect(res.status).toBe(400);
      expect(prismaMock.roundScore.createMany).not.toHaveBeenCalled();
    });

    it("rejects duplicate participant IDs in one score submission", async () => {
      const res = await authenticateRequest(
        request(app)
          .post(`/api/sessions/${sessionId}/rounds/${roundId}/scores`)
          .send({
            scores: [
              { participantId: participant1, points: 10 },
              { participantId: participant1, points: 20 },
            ],
          }),
      );

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("one score per round");
      expect(prismaMock.roundScore.createMany).not.toHaveBeenCalled();
    });

    it("rejects a score submission containing a participant outside the session", async () => {
      const foreignParticipant = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

      prismaMock.round.findFirst.mockResolvedValue({
        id: roundId,
        sessionId,
        setId,
        roundNumber: 1,
        status: "IN_PROGRESS",
      });

      prismaMock.gameSet.findFirst.mockResolvedValue({
        id: setId,
        sessionId,
        setNumber: 1,
        status: "IN_PROGRESS",
      });

      prismaMock.sessionParticipant.findMany.mockResolvedValue([
        { id: participant1 },
        { id: participant2 },
      ]);

      const res = await authenticateRequest(
        request(app)
          .post(`/api/sessions/${sessionId}/rounds/${roundId}/scores`)
          .send({
            scores: [
              { participantId: participant1, points: 10 },
              { participantId: foreignParticipant, points: 20 },
            ],
          }),
      );

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("every participant");
      expect(prismaMock.roundScore.createMany).not.toHaveBeenCalled();
    });
  });

  describe("Round and set completion", () => {
    it("does not complete a round before every participant has a score", async () => {
      prismaMock.round.findFirst.mockResolvedValue({
        id: roundId,
        sessionId,
        setId,
        roundNumber: 1,
        status: "IN_PROGRESS",
      });

      prismaMock.gameSet.findFirst.mockResolvedValue({
        id: setId,
        sessionId,
        setNumber: 1,
        status: "IN_PROGRESS",
      });

      prismaMock.sessionParticipant.count.mockResolvedValue(2);
      prismaMock.roundScore.count.mockResolvedValue(1);

      const res = await authenticateRequest(
        request(app).post(
          `/api/sessions/${sessionId}/rounds/${roundId}/complete`,
        ),
      );

      expect(res.status).toBe(409);
      expect(res.body.message).toContain("Every participant");
      expect(prismaMock.round.update).not.toHaveBeenCalled();
    });

    it("does not complete a set when it has no rounds", async () => {
      prismaMock.gameSet.findFirst.mockResolvedValue({
        id: setId,
        sessionId,
        setNumber: 1,
        status: "IN_PROGRESS",
      });

      prismaMock.round.findMany.mockResolvedValue([]);

      const res = await authenticateRequest(
        request(app).post(
          `/api/sessions/${sessionId}/sets/${setId}/complete`,
        ),
      );

      expect(res.status).toBe(409);
      expect(prismaMock.gameSet.update).not.toHaveBeenCalled();
    });
  });

  describe("Score correction and audit", () => {
    it("updates a score and records an audit entry", async () => {
      prismaMock.roundScore.findFirst.mockResolvedValue({
        id: scoreId,
        roundId,
        participantId: participant1,
        points: 25,
      });

      prismaMock.round.findFirst.mockResolvedValue({
        id: roundId,
        sessionId,
        setId,
        roundNumber: 1,
        status: "IN_PROGRESS",
      });

      prismaMock.gameSet.findFirst.mockResolvedValue({
        id: setId,
        sessionId,
        setNumber: 1,
        status: "IN_PROGRESS",
      });

      prismaMock.roundScore.update.mockResolvedValue({
        id: scoreId,
        points: 15,
      });

      prismaMock.scoreAudit.create.mockResolvedValue({
        id: "audit-id",
      });

      const res = await authenticateRequest(
        request(app)
          .patch(`/api/sessions/${sessionId}/scores/${scoreId}`)
          .send({
            points: 15,
            reason: "Corrected entry",
          }),
      );

      expect(res.status).toBe(200);
      expect(res.body.data.points).toBe(15);

      expect(prismaMock.roundScore.update).toHaveBeenCalledWith({
        where: { id: scoreId },
        data: { points: 15 },
      });

      expect(prismaMock.scoreAudit.create).toHaveBeenCalledWith({
        data: {
          scoreId,
          sessionId,
          familyId,
          actorMembershipId: membershipId,
          oldPoints: 25,
          newPoints: 15,
          reason: "Corrected entry",
        },
      });
    });
  });

  describe("Leaderboard", () => {
    it("sorts by lowest total and gives tied players the same rank", async () => {
      prismaMock.sessionParticipant.findMany.mockResolvedValue([
        {
          id: participant1,
          playerId: "player-1",
          displayName: "Alice",
          joinedAt: new Date("2026-10-01T10:00:00Z"),
        },
        {
          id: participant2,
          playerId: "player-2",
          displayName: "Bob",
          joinedAt: new Date("2026-10-01T10:01:00Z"),
        },
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          playerId: "player-3",
          displayName: "Charlie",
          joinedAt: new Date("2026-10-01T10:02:00Z"),
        },
      ]);

      prismaMock.roundScore.groupBy.mockResolvedValue([
        {
          participantId: participant1,
          _sum: { points: 10 },
        },
        {
          participantId: participant2,
          _sum: { points: 10 },
        },
        {
          participantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          _sum: { points: 20 },
        },
      ]);

      const res = await authenticateRequest(
        request(app).get(`/api/sessions/${sessionId}/leaderboard`),
      );

      expect(res.status).toBe(200);
      expect(res.body.data.leaderboard).toEqual([
        {
          rank: 1,
          participantId: participant1,
          playerId: "player-1",
          displayName: "Alice",
          totalPoints: 10,
        },
        {
          rank: 1,
          participantId: participant2,
          playerId: "player-2",
          displayName: "Bob",
          totalPoints: 10,
        },
        {
          rank: 3,
          participantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          playerId: "player-3",
          displayName: "Charlie",
          totalPoints: 20,
        },
      ]);
    });

    it("includes participants who have no recorded scores", async () => {
      prismaMock.sessionParticipant.findMany.mockResolvedValue([
        {
          id: participant1,
          playerId: "player-1",
          displayName: "Alice",
          joinedAt: new Date("2026-10-01T10:00:00Z"),
        },
        {
          id: participant2,
          playerId: "player-2",
          displayName: "Bob",
          joinedAt: new Date("2026-10-01T10:01:00Z"),
        },
      ]);

      prismaMock.roundScore.groupBy.mockResolvedValue([
        {
          participantId: participant1,
          _sum: { points: 10 },
        },
      ]);

      const res = await authenticateRequest(
        request(app).get(`/api/sessions/${sessionId}/leaderboard`),
      );

      expect(res.status).toBe(200);
      expect(res.body.data.leaderboard).toHaveLength(2);
      expect(res.body.data.leaderboard[0].displayName).toBe("Bob");
      expect(res.body.data.leaderboard[0].totalPoints).toBe(0);
      expect(res.body.data.leaderboard[0].rank).toBe(1);
    });
  });
});
