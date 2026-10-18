import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import crypto from "node:crypto";

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
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    familyInvitation: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

const { sendInvitationEmailMock } = vi.hoisted(() => ({
  sendInvitationEmailMock: vi.fn(),
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

vi.mock("../src/services/email.service", () => ({
  emailService: {
    sendInvitationEmail: sendInvitationEmailMock,
  },
  EmailDeliveryError: class EmailDeliveryError extends Error {
    statusCode: number;
    constructor(statusCode: number, message: string) {
      super(message);
      this.name = "EmailDeliveryError";
      this.statusCode = statusCode;
    }
  },
}));

import app from "../src/server";

describe("Family Invitation APIs (Step 4)", () => {
  const mockFamilyId = "11111111-1111-4111-8111-111111111111";
  const mockOtherFamilyId = "22222222-2222-4222-8222-222222222222";
  const mockAdminMembershipId = "33333333-3333-4333-8333-333333333333";
  const mockMemberMembershipId = "44444444-4444-4444-8444-444444444444";
  const mockInvitationId = "55555555-5555-4555-8555-555555555555";
  const mockUserId1 = "user-uuid-111";
  const mockUserId2 = "user-uuid-222";
  const rawToken = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  beforeEach(() => {
    vi.clearAllMocks();

    prismaMock.$transaction.mockImplementation(async (callback: any) => {
      return await callback(prismaMock);
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication Requirements on All 4 Endpoints", () => {
    it("rejects POST /api/families/:familyId/invitations without authentication", async () => {
      const res = await request(app)
        .post(`/api/families/${mockFamilyId}/invitations`)
        .send({ email: "invitee@example.com" });
      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Authorization header is missing");
    });

    it("rejects GET /api/families/:familyId/invitations without authentication", async () => {
      const res = await request(app).get(`/api/families/${mockFamilyId}/invitations`);
      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Authorization header is missing");
    });

    it("rejects POST /api/families/:familyId/invitations/:invitationId/revoke without authentication", async () => {
      const res = await request(app)
        .post(`/api/families/${mockFamilyId}/invitations/${mockInvitationId}/revoke`);
      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Authorization header is missing");
    });

    it("rejects POST /api/invitations/:token/accept without authentication", async () => {
      const res = await request(app).post(`/api/invitations/${rawToken}/accept`);
      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Authorization header is missing");
    });
  });

  describe("POST /api/families/:familyId/invitations (Create Invitation)", () => {
    it("allows active ADMIN to create invitation, hashes token, and calls email delivery", async () => {
      getUserMock.mockResolvedValue({
        data: {
          user: {
            id: mockUserId1,
            email: "admin@example.com",
            email_confirmed_at: "2026-01-01T00:00:00Z",
          },
        },
        error: null,
      });

      // authorizeFamily check
      prismaMock.familyMembership.findUnique.mockResolvedValue({
        id: mockAdminMembershipId,
        familyId: mockFamilyId,
        supabaseUserId: mockUserId1,
        email: "admin@example.com",
        role: "ADMIN",
        status: "ACTIVE",
        family: { id: mockFamilyId, name: "Smith Family" },
      });

      // Check if user already an active member
      prismaMock.familyMembership.findFirst.mockResolvedValue(null);

      // Create invitation in DB
      prismaMock.familyInvitation.create.mockResolvedValue({
        id: mockInvitationId,
        familyId: mockFamilyId,
        email: "invitee@example.com",
        status: "PENDING",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        createdAt: new Date().toISOString(),
      });

      sendInvitationEmailMock.mockResolvedValue({ sent: true });

      const res = await request(app)
        .post(`/api/families/${mockFamilyId}/invitations`)
        .set("Authorization", "Bearer valid-token")
        .send({ email: "  Invitee@Example.COM  " });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe("ok");
      expect(res.body.data.email).toBe("invitee@example.com");
      expect(res.body.data.tokenHash).toBeUndefined();
      expect(res.body.data.rawToken).toBeUndefined();

      // Check that raw token was hashed in DB creation
      expect(prismaMock.familyInvitation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          familyId: mockFamilyId,
          email: "invitee@example.com",
          tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        }),
        select: expect.any(Object),
      });

      // Check emailService was called with raw token
      expect(sendInvitationEmailMock).toHaveBeenCalledWith(
        expect.objectContaining({
          toEmail: "invitee@example.com",
          familyName: "Smith Family",
          inviterEmail: "admin@example.com",
          rawToken: expect.any(String),
        })
      );
    });

    it("forbids non-ADMIN members from creating invitations", async () => {
      getUserMock.mockResolvedValue({
        data: {
          user: {
            id: mockUserId2,
            email: "member@example.com",
            email_confirmed_at: "2026-01-01T00:00:00Z",
          },
        },
        error: null,
      });

      // authorizeFamily check returns MEMBER role
      prismaMock.familyMembership.findUnique.mockResolvedValue({
        id: mockMemberMembershipId,
        familyId: mockFamilyId,
        supabaseUserId: mockUserId2,
        role: "MEMBER",
        status: "ACTIVE",
      });

      const res = await request(app)
        .post(`/api/families/${mockFamilyId}/invitations`)
        .set("Authorization", "Bearer valid-token")
        .send({ email: "invitee@example.com" });

      expect(res.status).toBe(403);
      expect(res.body.status).toBe("error");
      expect(prismaMock.familyInvitation.create).not.toHaveBeenCalled();
      expect(sendInvitationEmailMock).not.toHaveBeenCalled();
    });

    it("rejects invitation when user already has active membership in family", async () => {
      getUserMock.mockResolvedValue({
        data: {
          user: {
            id: mockUserId1,
            email: "admin@example.com",
            email_confirmed_at: "2026-01-01T00:00:00Z",
          },
        },
        error: null,
      });

      prismaMock.familyMembership.findUnique.mockResolvedValue({
        id: mockAdminMembershipId,
        familyId: mockFamilyId,
        supabaseUserId: mockUserId1,
        role: "ADMIN",
        status: "ACTIVE",
        family: { id: mockFamilyId, name: "Smith Family" },
      });

      prismaMock.familyMembership.findFirst.mockResolvedValue({
        id: mockMemberMembershipId,
        familyId: mockFamilyId,
        email: "invitee@example.com",
        status: "ACTIVE",
      });

      const res = await request(app)
        .post(`/api/families/${mockFamilyId}/invitations`)
        .set("Authorization", "Bearer valid-token")
        .send({ email: "invitee@example.com" });

      expect(res.status).toBe(409);
      expect(res.body.status).toBe("error");
      expect(res.body.message).toContain("already an active member");
      expect(prismaMock.familyInvitation.create).not.toHaveBeenCalled();
    });

    it("rolls back invitation and returns error if email delivery fails", async () => {
      getUserMock.mockResolvedValue({
        data: {
          user: {
            id: mockUserId1,
            email: "admin@example.com",
            email_confirmed_at: "2026-01-01T00:00:00Z",
          },
        },
        error: null,
      });

      prismaMock.familyMembership.findUnique.mockResolvedValue({
        id: mockAdminMembershipId,
        familyId: mockFamilyId,
        supabaseUserId: mockUserId1,
        email: "admin@example.com",
        role: "ADMIN",
        status: "ACTIVE",
        family: { id: mockFamilyId, name: "Smith Family" },
      });

      prismaMock.familyMembership.findFirst.mockResolvedValue(null);

      prismaMock.familyInvitation.create.mockResolvedValue({
        id: mockInvitationId,
        familyId: mockFamilyId,
        email: "invitee@example.com",
        status: "PENDING",
      });

      const { EmailDeliveryError } = await import("../src/services/email.service");
      sendInvitationEmailMock.mockRejectedValue(
        new EmailDeliveryError(502, "Failed to deliver invitation email")
      );

      const res = await request(app)
        .post(`/api/families/${mockFamilyId}/invitations`)
        .set("Authorization", "Bearer valid-token")
        .send({ email: "invitee@example.com" });

      expect(res.status).toBe(500);
      expect(res.body.status).toBe("error");
      expect(res.body.message).toBe("Internal server error");
      expect(prismaMock.familyInvitation.delete).toHaveBeenCalledWith({
        where: { id: mockInvitationId },
      });
    });
  });

  describe("GET /api/families/:familyId/invitations (List Invitations)", () => {
    it("allows active ADMIN to list invitations and never returns tokenHash", async () => {
      getUserMock.mockResolvedValue({
        data: {
          user: {
            id: mockUserId1,
            email: "admin@example.com",
            email_confirmed_at: "2026-01-01T00:00:00Z",
          },
        },
        error: null,
      });

      prismaMock.familyMembership.findUnique.mockResolvedValue({
        id: mockAdminMembershipId,
        familyId: mockFamilyId,
        supabaseUserId: mockUserId1,
        role: "ADMIN",
        status: "ACTIVE",
      });

      prismaMock.familyInvitation.findMany.mockResolvedValue([
        {
          id: mockInvitationId,
          familyId: mockFamilyId,
          email: "invitee@example.com",
          status: "PENDING",
          expiresAt: new Date(),
          createdAt: new Date(),
          invitedByMembershipId: mockAdminMembershipId,
          acceptedByMembershipId: null,
        },
      ]);

      const res = await request(app)
        .get(`/api/families/${mockFamilyId}/invitations`)
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].email).toBe("invitee@example.com");
      expect(res.body.data[0].tokenHash).toBeUndefined();
    });
  });

  describe("POST /api/families/:familyId/invitations/:invitationId/revoke (Revoke)", () => {
    it("allows active ADMIN to revoke an invitation", async () => {
      getUserMock.mockResolvedValue({
        data: {
          user: {
            id: mockUserId1,
            email: "admin@example.com",
            email_confirmed_at: "2026-01-01T00:00:00Z",
          },
        },
        error: null,
      });

      prismaMock.familyMembership.findUnique.mockResolvedValue({
        id: mockAdminMembershipId,
        familyId: mockFamilyId,
        supabaseUserId: mockUserId1,
        role: "ADMIN",
        status: "ACTIVE",
      });

      prismaMock.familyInvitation.findUnique.mockResolvedValue({
        id: mockInvitationId,
        familyId: mockFamilyId,
        status: "PENDING",
      });

      prismaMock.familyInvitation.update.mockResolvedValue({
        id: mockInvitationId,
        familyId: mockFamilyId,
        email: "invitee@example.com",
        status: "REVOKED",
        revokedAt: new Date(),
      });

      const res = await request(app)
        .post(`/api/families/${mockFamilyId}/invitations/${mockInvitationId}/revoke`)
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.data.status).toBe("REVOKED");
    });

    it("rejects revoking invitation belonging to another family", async () => {
      getUserMock.mockResolvedValue({
        data: {
          user: {
            id: mockUserId1,
            email: "admin@example.com",
            email_confirmed_at: "2026-01-01T00:00:00Z",
          },
        },
        error: null,
      });

      prismaMock.familyMembership.findUnique.mockResolvedValue({
        id: mockAdminMembershipId,
        familyId: mockFamilyId,
        supabaseUserId: mockUserId1,
        role: "ADMIN",
        status: "ACTIVE",
      });

      prismaMock.familyInvitation.findUnique.mockResolvedValue({
        id: mockInvitationId,
        familyId: mockOtherFamilyId,
        status: "PENDING",
      });

      const res = await request(app)
        .post(`/api/families/${mockFamilyId}/invitations/${mockInvitationId}/revoke`)
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(404);
      expect(res.body.status).toBe("error");
      expect(res.body.message).toBe("Invitation not found in this family");
      expect(prismaMock.familyInvitation.update).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/invitations/:token/accept (Accept Invitation)", () => {
    it("successfully accepts invitation when email is verified and matches invitation", async () => {
      getUserMock.mockResolvedValue({
        data: {
          user: {
            id: mockUserId2,
            email: "invitee@example.com",
            email_confirmed_at: "2026-01-01T00:00:00Z",
          },
        },
        error: null,
      });

      const futureDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

      prismaMock.familyInvitation.findUnique.mockResolvedValue({
        id: mockInvitationId,
        familyId: mockFamilyId,
        email: "invitee@example.com",
        tokenHash,
        status: "PENDING",
        expiresAt: futureDate,
        family: { id: mockFamilyId, name: "Smith Family" },
      });

      prismaMock.familyMembership.findUnique.mockResolvedValue(null);
      prismaMock.familyInvitation.updateMany.mockResolvedValue({ count: 1 });

      prismaMock.familyMembership.create.mockResolvedValue({
        id: mockMemberMembershipId,
        familyId: mockFamilyId,
        supabaseUserId: mockUserId2,
        email: "invitee@example.com",
        role: "MEMBER",
        status: "ACTIVE",
        joinedAt: new Date(),
      });

      const res = await request(app)
        .post(`/api/invitations/${rawToken}/accept`)
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.data.membership.role).toBe("MEMBER");
      expect(res.body.data.membership.status).toBe("ACTIVE");
      expect(res.body.data.family.id).toBe(mockFamilyId);

      // Verify token hash was looked up
      expect(prismaMock.familyInvitation.findUnique).toHaveBeenCalledWith({
        where: { tokenHash },
        include: { family: true },
      });

      // Verify conditional updateMany used for single-use race condition guard
      expect(prismaMock.familyInvitation.updateMany).toHaveBeenCalledWith({
        where: {
          id: mockInvitationId,
          status: "PENDING",
          expiresAt: expect.objectContaining({ gt: expect.any(Date) }),
        },
        data: expect.objectContaining({
          status: "ACCEPTED",
        }),
      });
    });

    it("rejects acceptance if user email is unverified (email_confirmed_at is null)", async () => {
      getUserMock.mockResolvedValue({
        data: {
          user: {
            id: mockUserId2,
            email: "invitee@example.com",
            email_confirmed_at: null,
          },
        },
        error: null,
      });

      const res = await request(app)
        .post(`/api/invitations/${rawToken}/accept`)
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(403);
      expect(res.body.status).toBe("error");
      expect(res.body.message).toContain("must be verified");
      expect(prismaMock.familyInvitation.updateMany).not.toHaveBeenCalled();
    });

    it("rejects acceptance if authenticated email does not match invitation recipient", async () => {
      getUserMock.mockResolvedValue({
        data: {
          user: {
            id: mockUserId2,
            email: "different@example.com",
            email_confirmed_at: "2026-01-01T00:00:00Z",
          },
        },
        error: null,
      });

      prismaMock.familyInvitation.findUnique.mockResolvedValue({
        id: mockInvitationId,
        familyId: mockFamilyId,
        email: "invitee@example.com",
        tokenHash,
        status: "PENDING",
        expiresAt: new Date(Date.now() + 86400000),
        family: { id: mockFamilyId, name: "Smith Family" },
      });

      const res = await request(app)
        .post(`/api/invitations/${rawToken}/accept`)
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(403);
      expect(res.body.status).toBe("error");
      expect(res.body.message).toContain("sent to a different email address");
      expect(prismaMock.familyInvitation.updateMany).not.toHaveBeenCalled();
    });

    it("rejects acceptance if invitation is expired", async () => {
      getUserMock.mockResolvedValue({
        data: {
          user: {
            id: mockUserId2,
            email: "invitee@example.com",
            email_confirmed_at: "2026-01-01T00:00:00Z",
          },
        },
        error: null,
      });

      // Expired yesterday
      const pastDate = new Date(Date.now() - 86400000);

      prismaMock.familyInvitation.findUnique.mockResolvedValue({
        id: mockInvitationId,
        familyId: mockFamilyId,
        email: "invitee@example.com",
        tokenHash,
        status: "PENDING",
        expiresAt: pastDate,
        family: { id: mockFamilyId, name: "Smith Family" },
      });

      const res = await request(app)
        .post(`/api/invitations/${rawToken}/accept`)
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(410);
      expect(res.body.status).toBe("error");
      expect(res.body.message).toContain("expired");
    });

    it("rejects acceptance if invitation is already revoked", async () => {
      getUserMock.mockResolvedValue({
        data: {
          user: {
            id: mockUserId2,
            email: "invitee@example.com",
            email_confirmed_at: "2026-01-01T00:00:00Z",
          },
        },
        error: null,
      });

      prismaMock.familyInvitation.findUnique.mockResolvedValue({
        id: mockInvitationId,
        familyId: mockFamilyId,
        email: "invitee@example.com",
        tokenHash,
        status: "REVOKED",
        expiresAt: new Date(Date.now() + 86400000),
        family: { id: mockFamilyId, name: "Smith Family" },
      });

      const res = await request(app)
        .post(`/api/invitations/${rawToken}/accept`)
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(410);
      expect(res.body.status).toBe("error");
      expect(res.body.message).toContain("revoked");
    });

    it("rejects concurrent acceptance when conditional update returns count 0", async () => {
      getUserMock.mockResolvedValue({
        data: {
          user: {
            id: mockUserId2,
            email: "invitee@example.com",
            email_confirmed_at: "2026-01-01T00:00:00Z",
          },
        },
        error: null,
      });

      prismaMock.familyInvitation.findUnique.mockResolvedValue({
        id: mockInvitationId,
        familyId: mockFamilyId,
        email: "invitee@example.com",
        tokenHash,
        status: "PENDING",
        expiresAt: new Date(Date.now() + 86400000),
        family: { id: mockFamilyId, name: "Smith Family" },
      });

      prismaMock.familyMembership.findUnique.mockResolvedValue(null);

      // Concurrent request won the race: updateMany count is 0
      prismaMock.familyInvitation.updateMany.mockResolvedValue({ count: 0 });

      const res = await request(app)
        .post(`/api/invitations/${rawToken}/accept`)
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(409);
      expect(res.body.status).toBe("error");
      expect(res.body.message).toContain("already been accepted");
      expect(prismaMock.familyMembership.create).not.toHaveBeenCalled();
    });
  });
});
