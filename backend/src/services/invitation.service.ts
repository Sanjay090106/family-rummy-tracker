import crypto from "node:crypto";
import { prisma } from "../config/prisma";
import { FamilyRole, InvitationStatus, MembershipStatus } from "../generated/prisma/enums";
import { emailService } from "./email.service";

export class InvitationServiceError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "InvitationServiceError";
    this.statusCode = statusCode;
  }
}

export interface CreateInvitationInput {
  familyId: string;
  email: string;
  actorUserId: string;
}

export interface ListInvitationsInput {
  familyId: string;
  status?: InvitationStatus;
  actorUserId: string;
}

export interface RevokeInvitationInput {
  familyId: string;
  invitationId: string;
  actorUserId: string;
}

export interface AcceptInvitationInput {
  rawToken: string;
  user: {
    id: string;
    email?: string;
    email_confirmed_at?: string | null;
  };
}

export const invitationService = {
  /**
   * Helper to hash a raw cryptographically secure token using SHA-256.
   * Only the hash is ever stored in the database.
   */
  hashToken(rawToken: string): string {
    return crypto.createHash("sha256").update(rawToken).digest("hex");
  },

  /**
   * Create and send a family invitation.
   * Security & Business Rules:
   * 1. Inviter must be an ACTIVE ADMIN in the specified family.
   * 2. Recipient email normalized to lowercase and trimmed.
   * 3. Target email must not already have an ACTIVE membership in this family.
   * 4. If an existing pending invitation for this email and family exists, revoke it or replace it.
   * 5. Generate raw cryptographically secure 32-byte hex token.
   * 6. Store only SHA-256 hash in database with 7-day expiration.
   * 7. Deliver email AFTER database transaction commits. If email delivery fails,
   *    delete or revoke the invitation so user is not left with false success.
   */
  async createInvitation(input: CreateInvitationInput) {
    const { familyId, email, actorUserId } = input;
    const normalizedEmail = email.trim().toLowerCase();

    // 1. Verify caller is an active ADMIN in the family
    const callerMembership = await prisma.familyMembership.findUnique({
      where: {
        familyId_supabaseUserId: {
          familyId,
          supabaseUserId: actorUserId,
        },
      },
      include: {
        family: true,
      },
    });

    if (!callerMembership || callerMembership.status !== MembershipStatus.ACTIVE) {
      throw new InvitationServiceError(403, "Access denied: active family membership required");
    }

    if (callerMembership.role !== FamilyRole.ADMIN) {
      throw new InvitationServiceError(403, "Only an active family admin can invite members");
    }

    // 2. Check if user with this email already has an ACTIVE membership in this family
    const existingMembership = await prisma.familyMembership.findFirst({
      where: {
        familyId,
        email: normalizedEmail,
        status: MembershipStatus.ACTIVE,
      },
    });

    if (existingMembership) {
      throw new InvitationServiceError(
        409,
        "A member with this email is already an active member of the family"
      );
    }

    // 3. Generate raw cryptographically secure token and its SHA-256 hash
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = this.hashToken(rawToken);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // 4. Save invitation in DB transaction
    const invitation = await prisma.$transaction(async (tx) => {
      // Mark any previous PENDING invitations for this email in this family as REVOKED
      await tx.familyInvitation.updateMany({
        where: {
          familyId,
          email: normalizedEmail,
          status: InvitationStatus.PENDING,
        },
        data: {
          status: InvitationStatus.REVOKED,
          revokedAt: now,
        },
      });

      return await tx.familyInvitation.create({
        data: {
          familyId,
          email: normalizedEmail,
          tokenHash,
          status: InvitationStatus.PENDING,
          expiresAt,
          invitedByMembershipId: callerMembership.id,
        },
        select: {
          id: true,
          familyId: true,
          email: true,
          status: true,
          expiresAt: true,
          createdAt: true,
        },
      });
    });

    // 5. Send invitation email AFTER DB commit.
    // Deliberate failure-handling: If email delivery fails, roll back/delete the pending invitation record
    // so we never falsely claim to the user that an invitation was sent.
    try {
      await emailService.sendInvitationEmail({
        toEmail: normalizedEmail,
        familyName: callerMembership.family.name,
        inviterEmail: callerMembership.email,
        rawToken,
      });
    } catch (deliveryError) {
      // Revert the created invitation so no ghost invitation remains
      try {
        await prisma.familyInvitation.delete({
          where: { id: invitation.id },
        });
      } catch (cleanupError) {
        console.error("Failed to cleanup invitation after email delivery error:", cleanupError);
      }
      throw deliveryError;
    }

    return invitation;
  },

  /**
   * List invitations for a family.
   * Access requires the caller to be an ACTIVE ADMIN in the family.
   */
  async listInvitations(input: ListInvitationsInput) {
    const { familyId, status, actorUserId } = input;

    // Verify caller is active ADMIN
    const callerMembership = await prisma.familyMembership.findUnique({
      where: {
        familyId_supabaseUserId: {
          familyId,
          supabaseUserId: actorUserId,
        },
      },
    });

    if (!callerMembership || callerMembership.status !== MembershipStatus.ACTIVE) {
      throw new InvitationServiceError(403, "Access denied: active family membership required");
    }

    if (callerMembership.role !== FamilyRole.ADMIN) {
      throw new InvitationServiceError(403, "Only an active family admin can view invitations");
    }

    const whereClause: { familyId: string; status?: InvitationStatus } = { familyId };
    if (status) {
      whereClause.status = status;
    }

    const invitations = await prisma.familyInvitation.findMany({
      where: whereClause,
      select: {
        id: true,
        familyId: true,
        email: true,
        status: true,
        expiresAt: true,
        acceptedAt: true,
        revokedAt: true,
        createdAt: true,
        invitedByMembershipId: true,
        acceptedByMembershipId: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return invitations;
  },

  /**
   * Revoke a pending family invitation.
   * Access requires caller to be an ACTIVE ADMIN in the family.
   */
  async revokeInvitation(input: RevokeInvitationInput) {
    const { familyId, invitationId, actorUserId } = input;

    return await prisma.$transaction(async (tx) => {
      // Verify caller is active ADMIN in this family
      const callerMembership = await tx.familyMembership.findUnique({
        where: {
          familyId_supabaseUserId: {
            familyId,
            supabaseUserId: actorUserId,
          },
        },
      });

      if (!callerMembership || callerMembership.status !== MembershipStatus.ACTIVE) {
        throw new InvitationServiceError(403, "Access denied: active family membership required");
      }

      if (callerMembership.role !== FamilyRole.ADMIN) {
        throw new InvitationServiceError(403, "Only an active family admin can revoke invitations");
      }

      const invitation = await tx.familyInvitation.findUnique({
        where: {
          id: invitationId,
        },
      });

      if (!invitation || invitation.familyId !== familyId) {
        throw new InvitationServiceError(404, "Invitation not found in this family");
      }

      if (invitation.status !== InvitationStatus.PENDING) {
        throw new InvitationServiceError(
          400,
          `Cannot revoke invitation with status ${invitation.status}`
        );
      }

      const revoked = await tx.familyInvitation.update({
        where: { id: invitationId },
        data: {
          status: InvitationStatus.REVOKED,
          revokedAt: new Date(),
        },
        select: {
          id: true,
          familyId: true,
          email: true,
          status: true,
          revokedAt: true,
        },
      });

      return revoked;
    });
  },

  /**
   * Accept an invitation using the raw token.
   * Security & Business Rules:
   * 1. Requires authenticated Supabase user.
   * 2. Requires verified email (valid email and non-null email_confirmed_at).
   * 3. Authenticated user's email must match normalized invitation email.
   * 4. Hash token and locate invitation.
   * 5. Verify invitation is PENDING, not expired, not revoked, not accepted.
   * 6. Check user does not already have an ACTIVE membership in this family.
   * 7. Concurrency safeguard: Conditional updateMany inside transaction ensuring exactly one winner.
   * 8. Create FamilyMembership (role: MEMBER, status: ACTIVE).
   * 9. Link acceptedByMembershipId in the invitation.
   */
  async acceptInvitation(input: AcceptInvitationInput) {
    const { rawToken, user } = input;

    // 1. Validate email and email verification
    if (!user.email) {
      throw new InvitationServiceError(400, "Authenticated user must have an email address");
    }

    if (!user.email_confirmed_at) {
      throw new InvitationServiceError(
        403,
        "Your email address must be verified before accepting an invitation"
      );
    }

    const normalizedUserEmail = user.email.trim().toLowerCase();
    const tokenHash = this.hashToken(rawToken);
    const now = new Date();

    return await prisma.$transaction(async (tx) => {
      // 2. Lookup invitation by tokenHash
      const invitation = await tx.familyInvitation.findUnique({
        where: { tokenHash },
        include: { family: true },
      });

      if (!invitation) {
        throw new InvitationServiceError(404, "Invalid or expired invitation token");
      }

      // 3. Status checks
      if (invitation.status === InvitationStatus.REVOKED) {
        throw new InvitationServiceError(410, "This invitation has been revoked");
      }

      if (invitation.status === InvitationStatus.ACCEPTED) {
        throw new InvitationServiceError(409, "This invitation has already been accepted");
      }

      if (invitation.status !== InvitationStatus.PENDING || invitation.expiresAt <= now) {
        throw new InvitationServiceError(410, "This invitation has expired");
      }

      // 4. Verify email matches invitation email
      if (invitation.email.toLowerCase() !== normalizedUserEmail) {
        throw new InvitationServiceError(
          403,
          "This invitation was sent to a different email address"
        );
      }

      // 5. Verify user is not already an ACTIVE member of this family
      const existingMembership = await tx.familyMembership.findUnique({
        where: {
          familyId_supabaseUserId: {
            familyId: invitation.familyId,
            supabaseUserId: user.id,
          },
        },
      });

      if (existingMembership && existingMembership.status === MembershipStatus.ACTIVE) {
        throw new InvitationServiceError(
          409,
          "You are already an active member of this family"
        );
      }

      // 6. Conditional database update to prevent race conditions & double-consumption
      const updateResult = await tx.familyInvitation.updateMany({
        where: {
          id: invitation.id,
          status: InvitationStatus.PENDING,
          expiresAt: { gt: now },
        },
        data: {
          status: InvitationStatus.ACCEPTED,
          acceptedAt: now,
        },
      });

      if (updateResult.count === 0) {
        throw new InvitationServiceError(
          409,
          "Invitation is no longer valid or has already been accepted"
        );
      }

      // 7. Upsert/create family membership for the user
      // If user had previously LEFT this family, reactivate membership; otherwise create new.
      let membership;
      if (existingMembership) {
        membership = await tx.familyMembership.update({
          where: { id: existingMembership.id },
          data: {
            status: MembershipStatus.ACTIVE,
            role: FamilyRole.MEMBER,
            joinedAt: now,
            leftAt: null,
          },
        });
      } else {
        membership = await tx.familyMembership.create({
          data: {
            familyId: invitation.familyId,
            supabaseUserId: user.id,
            email: normalizedUserEmail,
            role: FamilyRole.MEMBER,
            status: MembershipStatus.ACTIVE,
            joinedAt: now,
          },
        });
      }

      // 8. Link acceptedByMembershipId back to invitation
      await tx.familyInvitation.update({
        where: { id: invitation.id },
        data: {
          acceptedByMembershipId: membership.id,
        },
      });

      return {
        membership: {
          id: membership.id,
          familyId: membership.familyId,
          role: membership.role,
          status: membership.status,
          joinedAt: membership.joinedAt,
        },
        family: {
          id: invitation.family.id,
          name: invitation.family.name,
        },
      };
    });
  },
};
