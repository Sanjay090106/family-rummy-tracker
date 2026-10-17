import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const { getUserMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
}));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $transaction: vi.fn(),
    family: {
      findUnique: vi.fn(),
    },
    familyMembership: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    player: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
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

describe("Player API (Step 3)", () => {
  const mockFamilyId = "11111111-1111-4111-8111-111111111111";
  const mockOtherFamilyId = "22222222-2222-4222-8222-222222222222";
  const mockMembershipId1 = "33333333-3333-4333-8333-333333333333";
  const mockMembershipId2 = "44444444-4444-4444-8444-444444444444";
  const mockPlayerId1 = "55555555-5555-4555-8555-555555555555";
  const mockPlayerId2 = "66666666-6666-4666-8666-666666666666";
  const mockUserId1 = "user-uuid-111";
  const mockUserId2 = "user-uuid-222";

  beforeEach(() => {
    vi.clearAllMocks();

    prismaMock.$transaction.mockImplementation(async (callback: any) => {
      return await callback(prismaMock);
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication Requirements", () => {
    it("rejects GET /api/families/:familyId/players without authentication", async () => {
      const res = await request(app).get(`/api/families/${mockFamilyId}/players`);
      expect(res.status).toBe(401);
      expect(res.body.status).toBe("error");
      expect(res.body.message).toBe("Authorization header is missing");
    });

    it("rejects POST /api/families/:familyId/players without authentication", async () => {
      const res = await request(app)
        .post(`/api/families/${mockFamilyId}/players`)
        .send({
          membershipId: mockMembershipId1,
          displayName: "Grandma",
        });
      expect(res.status).toBe(401);
      expect(res.body.status).toBe("error");
    });

    it("rejects PATCH /api/families/:familyId/players/:playerId without authentication", async () => {
      const res = await request(app)
        .patch(`/api/families/${mockFamilyId}/players/${mockPlayerId1}`)
        .send({ displayName: "Grandma Upgraded" });
      expect(res.status).toBe(401);
      expect(res.body.status).toBe("error");
    });
  });

  describe("Family Authorization & Cross-Family Isolation", () => {
    it("rejects player listing when user is not an active member of the family", async () => {
      getUserMock.mockResolvedValue({
        data: {
          user: {
            id: mockUserId1,
            email: "user@example.com",
          },
        },
        error: null,
      });

      // authorizeFamily check returns null (not a member)
      prismaMock.familyMembership.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get(`/api/families/${mockOtherFamilyId}/players`)
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(403);
      expect(res.body.status).toBe("error");
      expect(res.body.message).toContain("Access denied: active family membership required");
    });

    it("rejects player listing when membership status is not ACTIVE", async () => {
      getUserMock.mockResolvedValue({
        data: {
          user: {
            id: mockUserId1,
            email: "user@example.com",
          },
        },
        error: null,
      });

      prismaMock.familyMembership.findUnique.mockResolvedValue({
        id: mockMembershipId1,
        familyId: mockFamilyId,
        supabaseUserId: mockUserId1,
        role: "MEMBER",
        status: "LEFT",
      });

      const res = await request(app)
        .get(`/api/families/${mockFamilyId}/players`)
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(403);
      expect(res.body.status).toBe("error");
      expect(res.body.message).toContain("Access denied: active family membership required");
    });
  });

  describe("GET /api/families/:familyId/players", () => {
    it("returns list of players belonging to the requested family", async () => {
      getUserMock.mockResolvedValue({
        data: {
          user: {
            id: mockUserId1,
            email: "user@example.com",
          },
        },
        error: null,
      });

      // Active member check in authorizeFamily
      prismaMock.familyMembership.findUnique.mockResolvedValue({
        id: mockMembershipId1,
        familyId: mockFamilyId,
        supabaseUserId: mockUserId1,
        role: "ADMIN",
        status: "ACTIVE",
      });

      const mockPlayers = [
        {
          id: mockPlayerId1,
          familyId: mockFamilyId,
          membershipId: mockMembershipId1,
          displayName: "Mom",
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          membership: {
            id: mockMembershipId1,
            email: "mom@example.com",
            role: "ADMIN",
            status: "ACTIVE",
          },
        },
      ];

      prismaMock.player.findMany.mockResolvedValue(mockPlayers);

      const res = await request(app)
        .get(`/api/families/${mockFamilyId}/players`)
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].displayName).toBe("Mom");
      expect(prismaMock.player.findMany).toHaveBeenCalledWith({
        where: { familyId: mockFamilyId },
        select: expect.any(Object),
        orderBy: { createdAt: "asc" },
      });
    });

    it("rejects request if familyId is an invalid UUID", async () => {
      getUserMock.mockResolvedValue({
        data: {
          user: {
            id: mockUserId1,
          },
        },
        error: null,
      });

      const res = await request(app)
        .get("/api/families/invalid-uuid/players")
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(400);
      expect(res.body.status).toBe("error");
      expect(res.body.message).toBe("Request validation failed");
    });
  });

  describe("POST /api/families/:familyId/players (Create Player)", () => {
    it("successfully creates a player for an eligible family membership", async () => {
      getUserMock.mockResolvedValue({
        data: {
          user: {
            id: mockUserId1,
            email: "user@example.com",
          },
        },
        error: null,
      });

      // 1. authorizeFamily check
      // 2. playerService caller membership check
      prismaMock.familyMembership.findUnique
        .mockResolvedValueOnce({
          id: mockMembershipId1,
          familyId: mockFamilyId,
          supabaseUserId: mockUserId1,
          role: "ADMIN",
          status: "ACTIVE",
        })
        .mockResolvedValueOnce({
          id: mockMembershipId1,
          familyId: mockFamilyId,
          supabaseUserId: mockUserId1,
          role: "ADMIN",
          status: "ACTIVE",
        })
        // 3. targetMembership check (has no player linked)
        .mockResolvedValueOnce({
          id: mockMembershipId2,
          familyId: mockFamilyId,
          supabaseUserId: mockUserId2,
          role: "MEMBER",
          status: "ACTIVE",
          player: null,
        });

      const createdPlayer = {
        id: mockPlayerId1,
        familyId: mockFamilyId,
        membershipId: mockMembershipId2,
        displayName: "Aunt Sarah",
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        membership: {
          id: mockMembershipId2,
          email: "sarah@example.com",
          role: "MEMBER",
          status: "ACTIVE",
        },
      };

      prismaMock.player.create.mockResolvedValue(createdPlayer);

      const res = await request(app)
        .post(`/api/families/${mockFamilyId}/players`)
        .set("Authorization", "Bearer valid-token")
        .send({
          membershipId: mockMembershipId2,
          displayName: "Aunt Sarah",
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe("ok");
      expect(res.body.data.id).toBe(mockPlayerId1);
      expect(res.body.data.displayName).toBe("Aunt Sarah");
      expect(prismaMock.player.create).toHaveBeenCalledWith({
        data: {
          familyId: mockFamilyId,
          membershipId: mockMembershipId2,
          displayName: "Aunt Sarah",
          isActive: true,
        },
        select: expect.any(Object),
      });
    });

    it("rejects duplicate player creation when membership already has a player (one-player-per-membership)", async () => {
      getUserMock.mockResolvedValue({
        data: {
          user: {
            id: mockUserId1,
            email: "user@example.com",
          },
        },
        error: null,
      });

      // authorizeFamily check + playerService check
      prismaMock.familyMembership.findUnique
        .mockResolvedValueOnce({
          id: mockMembershipId1,
          familyId: mockFamilyId,
          supabaseUserId: mockUserId1,
          role: "ADMIN",
          status: "ACTIVE",
        })
        .mockResolvedValueOnce({
          id: mockMembershipId1,
          familyId: mockFamilyId,
          supabaseUserId: mockUserId1,
          role: "ADMIN",
          status: "ACTIVE",
        })
        // targetMembership already has a linked player
        .mockResolvedValueOnce({
          id: mockMembershipId2,
          familyId: mockFamilyId,
          supabaseUserId: mockUserId2,
          role: "MEMBER",
          status: "ACTIVE",
          player: { id: mockPlayerId2 },
        });

      const res = await request(app)
        .post(`/api/families/${mockFamilyId}/players`)
        .set("Authorization", "Bearer valid-token")
        .send({
          membershipId: mockMembershipId2,
          displayName: "Another Player",
        });

      expect(res.status).toBe(409);
      expect(res.body.status).toBe("error");
      expect(res.body.message).toContain("A player is already linked to this family membership");
      expect(prismaMock.player.create).not.toHaveBeenCalled();
    });

    it("rejects creating player linked to membership from another family", async () => {
      getUserMock.mockResolvedValue({
        data: {
          user: {
            id: mockUserId1,
            email: "user@example.com",
          },
        },
        error: null,
      });

      prismaMock.familyMembership.findUnique
        .mockResolvedValueOnce({
          id: mockMembershipId1,
          familyId: mockFamilyId,
          supabaseUserId: mockUserId1,
          role: "ADMIN",
          status: "ACTIVE",
        })
        .mockResolvedValueOnce({
          id: mockMembershipId1,
          familyId: mockFamilyId,
          supabaseUserId: mockUserId1,
          role: "ADMIN",
          status: "ACTIVE",
        })
        // Target membership belongs to mockOtherFamilyId
        .mockResolvedValueOnce({
          id: mockMembershipId2,
          familyId: mockOtherFamilyId,
          supabaseUserId: mockUserId2,
          role: "MEMBER",
          status: "ACTIVE",
          player: null,
        });

      const res = await request(app)
        .post(`/api/families/${mockFamilyId}/players`)
        .set("Authorization", "Bearer valid-token")
        .send({
          membershipId: mockMembershipId2,
          displayName: "Cross Family Player",
        });

      expect(res.status).toBe(404);
      expect(res.body.status).toBe("error");
      expect(res.body.message).toBe("Target membership not found in this family");
      expect(prismaMock.player.create).not.toHaveBeenCalled();
    });

    it("rejects creation if displayName is blank or whitespace", async () => {
      getUserMock.mockResolvedValue({
        data: {
          user: {
            id: mockUserId1,
          },
        },
        error: null,
      });

      const res = await request(app)
        .post(`/api/families/${mockFamilyId}/players`)
        .set("Authorization", "Bearer valid-token")
        .send({
          membershipId: mockMembershipId1,
          displayName: "   ",
        });

      expect(res.status).toBe(400);
      expect(res.body.status).toBe("error");
      expect(res.body.message).toBe("Request validation failed");
    });
  });

  describe("PATCH /api/families/:familyId/players/:playerId (Update Player)", () => {
    it("updates player displayName and active status", async () => {
      getUserMock.mockResolvedValue({
        data: {
          user: {
            id: mockUserId1,
            email: "user@example.com",
          },
        },
        error: null,
      });

      // authorizeFamily check + playerService check
      prismaMock.familyMembership.findUnique
        .mockResolvedValueOnce({
          id: mockMembershipId1,
          familyId: mockFamilyId,
          supabaseUserId: mockUserId1,
          role: "ADMIN",
          status: "ACTIVE",
        })
        .mockResolvedValueOnce({
          id: mockMembershipId1,
          familyId: mockFamilyId,
          supabaseUserId: mockUserId1,
          role: "ADMIN",
          status: "ACTIVE",
        });

      // existingPlayer check
      prismaMock.player.findUnique.mockResolvedValue({
        id: mockPlayerId1,
        familyId: mockFamilyId,
        membershipId: mockMembershipId1,
        displayName: "Old Name",
        isActive: true,
      });

      const updatedPlayer = {
        id: mockPlayerId1,
        familyId: mockFamilyId,
        membershipId: mockMembershipId1,
        displayName: "New Name",
        isActive: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        membership: {
          id: mockMembershipId1,
          email: "user@example.com",
          role: "ADMIN",
          status: "ACTIVE",
        },
      };

      prismaMock.player.update.mockResolvedValue(updatedPlayer);

      const res = await request(app)
        .patch(`/api/families/${mockFamilyId}/players/${mockPlayerId1}`)
        .set("Authorization", "Bearer valid-token")
        .send({
          displayName: "New Name",
          isActive: false,
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.data.displayName).toBe("New Name");
      expect(res.body.data.isActive).toBe(false);

      expect(prismaMock.player.update).toHaveBeenCalledWith({
        where: { id: mockPlayerId1 },
        data: {
          displayName: "New Name",
          isActive: false,
        },
        select: expect.any(Object),
      });
    });

    it("rejects update if player belongs to another family", async () => {
      getUserMock.mockResolvedValue({
        data: {
          user: {
            id: mockUserId1,
            email: "user@example.com",
          },
        },
        error: null,
      });

      prismaMock.familyMembership.findUnique
        .mockResolvedValueOnce({
          id: mockMembershipId1,
          familyId: mockFamilyId,
          supabaseUserId: mockUserId1,
          role: "ADMIN",
          status: "ACTIVE",
        })
        .mockResolvedValueOnce({
          id: mockMembershipId1,
          familyId: mockFamilyId,
          supabaseUserId: mockUserId1,
          role: "ADMIN",
          status: "ACTIVE",
        });

      // Player belongs to mockOtherFamilyId
      prismaMock.player.findUnique.mockResolvedValue({
        id: mockPlayerId1,
        familyId: mockOtherFamilyId,
        membershipId: mockMembershipId2,
        displayName: "Other Family Player",
        isActive: true,
      });

      const res = await request(app)
        .patch(`/api/families/${mockFamilyId}/players/${mockPlayerId1}`)
        .set("Authorization", "Bearer valid-token")
        .send({
          displayName: "Hacked Name",
        });

      expect(res.status).toBe(404);
      expect(res.body.status).toBe("error");
      expect(res.body.message).toBe("Player not found in this family");
      expect(prismaMock.player.update).not.toHaveBeenCalled();
    });

    it("rejects update if neither displayName nor isActive is provided", async () => {
      getUserMock.mockResolvedValue({
        data: {
          user: {
            id: mockUserId1,
          },
        },
        error: null,
      });

      const res = await request(app)
        .patch(`/api/families/${mockFamilyId}/players/${mockPlayerId1}`)
        .set("Authorization", "Bearer valid-token")
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.status).toBe("error");
      expect(res.body.message).toBe("Request validation failed");
    });
  });
});
