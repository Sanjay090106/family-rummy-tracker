import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const { getUserMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
}));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $transaction: vi.fn(),
    family: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    familyMembership: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
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

describe("Family & Membership API (Step 2)", () => {
  const mockFamilyId = "11111111-1111-4111-8111-111111111111";
  const mockOtherFamilyId = "22222222-2222-4222-8222-222222222222";
  const mockMembershipId1 = "33333333-3333-4333-8333-333333333333";
  const mockMembershipId2 = "44444444-4444-4444-8444-444444444444";
  const mockUserId1 = "user-uuid-111";
  const mockUserId2 = "user-uuid-222";

  beforeEach(() => {
    vi.clearAllMocks();

    // Default $transaction execution to evaluate the passed callback with mock client
    prismaMock.$transaction.mockImplementation(async (callback: any) => {
      return await callback(prismaMock);
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication Enforcement on All New Endpoints", () => {
    it("rejects GET /api/families without authentication", async () => {
      const res = await request(app).get("/api/families");
      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Authorization header is missing");
    });

    it("rejects POST /api/families without authentication", async () => {
      const res = await request(app)
        .post("/api/families")
        .send({ name: "Smith Family" });
      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Authorization header is missing");
    });

    it("rejects GET /api/families/:familyId without authentication", async () => {
      const res = await request(app).get(`/api/families/${mockFamilyId}`);
      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Authorization header is missing");
    });

    it("rejects GET /api/families/:familyId/members without authentication", async () => {
      const res = await request(app).get(`/api/families/${mockFamilyId}/members`);
      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Authorization header is missing");
    });

    it("rejects PATCH /api/families/:familyId/members/:membershipId without authentication", async () => {
      const res = await request(app)
        .patch(`/api/families/${mockFamilyId}/members/${mockMembershipId1}`)
        .send({ role: "MEMBER" });
      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Authorization header is missing");
    });

    it("rejects POST /api/families/:familyId/members/:membershipId/leave without authentication", async () => {
      const res = await request(app)
        .post(`/api/families/${mockFamilyId}/members/${mockMembershipId1}/leave`);
      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Authorization header is missing");
    });
  });

  describe("POST /api/families (Family Creation & Creator ADMIN Membership)", () => {
    it("creates a family and atomic ADMIN membership with verified email", async () => {
      getUserMock.mockResolvedValue({
        data: {
          user: {
            id: mockUserId1,
            email: "creator@example.com",
          },
        },
        error: null,
      });

      const fakeCreatedFamily = {
        id: mockFamilyId,
        name: "Sharma Family",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const fakeCreatedMembership = {
        id: mockMembershipId1,
        familyId: mockFamilyId,
        supabaseUserId: mockUserId1,
        email: "creator@example.com",
        role: "ADMIN",
        status: "ACTIVE",
        joinedAt: new Date().toISOString(),
      };

      prismaMock.family.create.mockResolvedValue(fakeCreatedFamily);
      prismaMock.familyMembership.create.mockResolvedValue(fakeCreatedMembership);

      const res = await request(app)
        .post("/api/families")
        .set("Authorization", "Bearer valid-token")
        .send({ name: "Sharma Family" });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe("ok");
      expect(res.body.data.name).toBe("Sharma Family");
      expect(res.body.data.membership.role).toBe("ADMIN");
      expect(res.body.data.membership.status).toBe("ACTIVE");

      // Verify Prisma transaction used
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(prismaMock.family.create).toHaveBeenCalledWith({
        data: { name: "Sharma Family" },
      });
      expect(prismaMock.familyMembership.create).toHaveBeenCalledWith({
        data: {
          familyId: mockFamilyId,
          supabaseUserId: mockUserId1,
          email: "creator@example.com",
          role: "ADMIN",
          status: "ACTIVE",
        },
      });
    });

    it("rejects creation if family name is empty or invalid", async () => {
      getUserMock.mockResolvedValue({
        data: {
          user: {
            id: mockUserId1,
            email: "creator@example.com",
          },
        },
        error: null,
      });

      const res = await request(app)
        .post("/api/families")
        .set("Authorization", "Bearer valid-token")
        .send({ name: "   " });

      expect(res.status).toBe(400);
      expect(res.body.status).toBe("error");
      expect(res.body.message).toBe("Request validation failed");
    });
  });

  describe("GET /api/families (Listing User Families)", () => {
    it("returns only families where user has an ACTIVE membership", async () => {
      getUserMock.mockResolvedValue({
        data: {
          user: {
            id: mockUserId1,
            email: "member@example.com",
          },
        },
        error: null,
      });

      const fakeMemberships = [
        {
          id: mockMembershipId1,
          role: "ADMIN",
          status: "ACTIVE",
          joinedAt: new Date(),
          family: {
            id: mockFamilyId,
            name: "Active Family",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      ];

      prismaMock.familyMembership.findMany.mockResolvedValue(fakeMemberships);

      const res = await request(app)
        .get("/api/families")
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].id).toBe(mockFamilyId);
      expect(res.body.data[0].membership.role).toBe("ADMIN");

      expect(prismaMock.familyMembership.findMany).toHaveBeenCalledWith({
        where: {
          supabaseUserId: mockUserId1,
          status: "ACTIVE",
        },
        select: expect.any(Object),
        orderBy: { joinedAt: "desc" },
      });
    });
  });

  describe("GET /api/families/:familyId (Family Details)", () => {
    it("returns family details for an ACTIVE member", async () => {
      getUserMock.mockResolvedValue({
        data: {
          user: {
            id: mockUserId1,
            email: "member@example.com",
          },
        },
        error: null,
      });

      // authorizeFamily check and getFamilyById check
      prismaMock.familyMembership.findUnique.mockResolvedValue({
        id: mockMembershipId1,
        familyId: mockFamilyId,
        supabaseUserId: mockUserId1,
        role: "MEMBER",
        status: "ACTIVE",
        joinedAt: new Date(),
        family: {
          id: mockFamilyId,
          name: "Active Family",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      const res = await request(app)
        .get(`/api/families/${mockFamilyId}`)
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.data.id).toBe(mockFamilyId);
      expect(res.body.data.currentUserMembership.role).toBe("MEMBER");
    });

    it("rejects access with 403 if user is not an active member of the family", async () => {
      getUserMock.mockResolvedValue({
        data: {
          user: {
            id: mockUserId2,
            email: "other@example.com",
          },
        },
        error: null,
      });

      prismaMock.familyMembership.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get(`/api/families/${mockOtherFamilyId}`)
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(403);
      expect(res.body.status).toBe("error");
      expect(res.body.message).toContain("Access denied: active family membership required");
    });

    it("rejects request if familyId is not a valid UUID", async () => {
      getUserMock.mockResolvedValue({
        data: {
          user: {
            id: mockUserId1,
          },
        },
        error: null,
      });

      const res = await request(app)
        .get("/api/families/not-a-uuid")
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(400);
      expect(res.body.status).toBe("error");
      expect(res.body.message).toBe("Request validation failed");
    });
  });

  describe("GET /api/families/:familyId/members (Member Listing)", () => {
    it("returns active members for an active family member", async () => {
      getUserMock.mockResolvedValue({
        data: {
          user: {
            id: mockUserId1,
            email: "member@example.com",
          },
        },
        error: null,
      });

      // authorizeFamily check
      prismaMock.familyMembership.findUnique.mockResolvedValue({
        id: mockMembershipId1,
        familyId: mockFamilyId,
        supabaseUserId: mockUserId1,
        role: "MEMBER",
        status: "ACTIVE",
      });

      prismaMock.familyMembership.findMany.mockResolvedValue([
        {
          id: mockMembershipId1,
          familyId: mockFamilyId,
          email: "member1@example.com",
          role: "ADMIN",
          status: "ACTIVE",
          joinedAt: new Date(),
        },
        {
          id: mockMembershipId2,
          familyId: mockFamilyId,
          email: "member2@example.com",
          role: "MEMBER",
          status: "ACTIVE",
          joinedAt: new Date(),
        },
      ]);

      const res = await request(app)
        .get(`/api/families/${mockFamilyId}/members`)
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.data.length).toBe(2);
      expect(res.body.data[0].email).toBe("member1@example.com");
      expect(res.body.data[1].email).toBe("member2@example.com");
    });

    it("rejects cross-family member listing for non-members", async () => {
      getUserMock.mockResolvedValue({
        data: {
          user: {
            id: mockUserId2,
          },
        },
        error: null,
      });

      prismaMock.familyMembership.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get(`/api/families/${mockOtherFamilyId}/members`)
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(403);
      expect(res.body.status).toBe("error");
    });
  });

  describe("PATCH /api/families/:familyId/members/:membershipId (Role Update)", () => {
    it("allows an active ADMIN to change another member's role to ADMIN", async () => {
      getUserMock.mockResolvedValue({
        data: {
          user: {
            id: mockUserId1,
          },
        },
        error: null,
      });

      // Actor is ADMIN in mockFamilyId
      prismaMock.familyMembership.findUnique
        .mockResolvedValueOnce({
          id: mockMembershipId1,
          familyId: mockFamilyId,
          supabaseUserId: mockUserId1,
          role: "ADMIN",
          status: "ACTIVE",
        })
        // Target is MEMBER in mockFamilyId
        .mockResolvedValueOnce({
          id: mockMembershipId2,
          familyId: mockFamilyId,
          supabaseUserId: mockUserId2,
          role: "MEMBER",
          status: "ACTIVE",
        });

      prismaMock.familyMembership.update.mockResolvedValue({
        id: mockMembershipId2,
        familyId: mockFamilyId,
        email: "member2@example.com",
        role: "ADMIN",
        status: "ACTIVE",
      });

      const res = await request(app)
        .patch(`/api/families/${mockFamilyId}/members/${mockMembershipId2}`)
        .set("Authorization", "Bearer valid-token")
        .send({ role: "ADMIN" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.data.role).toBe("ADMIN");
      expect(prismaMock.familyMembership.update).toHaveBeenCalledWith({
        where: { id: mockMembershipId2 },
        data: { role: "ADMIN" },
        select: expect.any(Object),
      });
    });

    it("forbids non-ADMIN members from changing member roles", async () => {
      getUserMock.mockResolvedValue({
        data: {
          user: {
            id: mockUserId2,
          },
        },
        error: null,
      });

      // Actor is only MEMBER in mockFamilyId
      prismaMock.familyMembership.findUnique.mockResolvedValueOnce({
        id: mockMembershipId2,
        familyId: mockFamilyId,
        supabaseUserId: mockUserId2,
        role: "MEMBER",
        status: "ACTIVE",
      });

      const res = await request(app)
        .patch(`/api/families/${mockFamilyId}/members/${mockMembershipId1}`)
        .set("Authorization", "Bearer valid-token")
        .send({ role: "MEMBER" });

      expect(res.status).toBe(403);
      expect(res.body.status).toBe("error");
      expect(res.body.message).toBe("Only an active family admin can change member roles");
      expect(prismaMock.familyMembership.update).not.toHaveBeenCalled();
    });

    it("prevents demoting the last active ADMIN", async () => {
      getUserMock.mockResolvedValue({
        data: {
          user: {
            id: mockUserId1,
          },
        },
        error: null,
      });

      // Actor is ADMIN
      prismaMock.familyMembership.findUnique
        .mockResolvedValueOnce({
          id: mockMembershipId1,
          familyId: mockFamilyId,
          supabaseUserId: mockUserId1,
          role: "ADMIN",
          status: "ACTIVE",
        })
        // Target is the same ADMIN
        .mockResolvedValueOnce({
          id: mockMembershipId1,
          familyId: mockFamilyId,
          supabaseUserId: mockUserId1,
          role: "ADMIN",
          status: "ACTIVE",
        });

      // Only 1 active ADMIN exists
      prismaMock.familyMembership.count.mockResolvedValue(1);

      const res = await request(app)
        .patch(`/api/families/${mockFamilyId}/members/${mockMembershipId1}`)
        .set("Authorization", "Bearer valid-token")
        .send({ role: "MEMBER" });

      expect(res.status).toBe(400);
      expect(res.body.status).toBe("error");
      expect(res.body.message).toContain("Cannot demote the last active admin of the family");
      expect(prismaMock.familyMembership.update).not.toHaveBeenCalled();
    });

    it("rejects updating membership belonging to another family", async () => {
      getUserMock.mockResolvedValue({
        data: {
          user: {
            id: mockUserId1,
          },
        },
        error: null,
      });

      // Actor is ADMIN in mockFamilyId
      prismaMock.familyMembership.findUnique
        .mockResolvedValueOnce({
          id: mockMembershipId1,
          familyId: mockFamilyId,
          supabaseUserId: mockUserId1,
          role: "ADMIN",
          status: "ACTIVE",
        })
        // Target belongs to mockOtherFamilyId
        .mockResolvedValueOnce({
          id: mockMembershipId2,
          familyId: mockOtherFamilyId,
          supabaseUserId: mockUserId2,
          role: "MEMBER",
          status: "ACTIVE",
        });

      const res = await request(app)
        .patch(`/api/families/${mockFamilyId}/members/${mockMembershipId2}`)
        .set("Authorization", "Bearer valid-token")
        .send({ role: "ADMIN" });

      expect(res.status).toBe(404);
      expect(res.body.status).toBe("error");
      expect(res.body.message).toBe("Member not found in this family");
    });
  });

  describe("POST /api/families/:familyId/members/:membershipId/leave (Leave Family)", () => {
    it("allows a member to leave their own membership", async () => {
      getUserMock.mockResolvedValue({
        data: {
          user: {
            id: mockUserId2,
          },
        },
        error: null,
      });

      // Target is caller's membership
      prismaMock.familyMembership.findUnique.mockResolvedValue({
        id: mockMembershipId2,
        familyId: mockFamilyId,
        supabaseUserId: mockUserId2,
        role: "MEMBER",
        status: "ACTIVE",
      });

      prismaMock.familyMembership.update.mockResolvedValue({
        id: mockMembershipId2,
        familyId: mockFamilyId,
        email: "member2@example.com",
        role: "MEMBER",
        status: "LEFT",
        leftAt: new Date(),
      });

      const res = await request(app)
        .post(`/api/families/${mockFamilyId}/members/${mockMembershipId2}/leave`)
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.data.status).toBe("LEFT");
      expect(prismaMock.familyMembership.update).toHaveBeenCalledWith({
        where: { id: mockMembershipId2 },
        data: expect.objectContaining({
          status: "LEFT",
        }),
        select: expect.any(Object),
      });
    });

    it("prevents leaving another user's membership", async () => {
      getUserMock.mockResolvedValue({
        data: {
          user: {
            id: mockUserId1,
          },
        },
        error: null,
      });

      // Target belongs to mockUserId2, but caller is mockUserId1
      prismaMock.familyMembership.findUnique.mockResolvedValue({
        id: mockMembershipId2,
        familyId: mockFamilyId,
        supabaseUserId: mockUserId2,
        role: "MEMBER",
        status: "ACTIVE",
      });

      const res = await request(app)
        .post(`/api/families/${mockFamilyId}/members/${mockMembershipId2}/leave`)
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(403);
      expect(res.body.status).toBe("error");
      expect(res.body.message).toBe("You can only leave your own family membership");
      expect(prismaMock.familyMembership.update).not.toHaveBeenCalled();
    });

    it("prevents the last active ADMIN from leaving the family", async () => {
      getUserMock.mockResolvedValue({
        data: {
          user: {
            id: mockUserId1,
          },
        },
        error: null,
      });

      // Target is mockUserId1 (caller is ADMIN)
      prismaMock.familyMembership.findUnique.mockResolvedValue({
        id: mockMembershipId1,
        familyId: mockFamilyId,
        supabaseUserId: mockUserId1,
        role: "ADMIN",
        status: "ACTIVE",
      });

      // Only 1 active ADMIN
      prismaMock.familyMembership.count.mockResolvedValue(1);

      const res = await request(app)
        .post(`/api/families/${mockFamilyId}/members/${mockMembershipId1}/leave`)
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(400);
      expect(res.body.status).toBe("error");
      expect(res.body.message).toContain("The last active admin cannot leave the family");
      expect(prismaMock.familyMembership.update).not.toHaveBeenCalled();
    });
  });
});
