import { prisma } from "../config/prisma";
import { FamilyRole, MembershipStatus } from "../generated/prisma/enums";

export class FamilyServiceError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "FamilyServiceError";
    this.statusCode = statusCode;
  }
}

export interface CreateFamilyInput {
  name: string;
  supabaseUserId: string;
  email: string;
}

export interface UpdateRoleInput {
  familyId: string;
  targetMembershipId: string;
  newRole: FamilyRole;
  actorUserId: string;
}

export interface LeaveFamilyInput {
  familyId: string;
  membershipId: string;
  actorUserId: string;
}

export const familyService = {
  /**
   * List all families where the authenticated user has an ACTIVE membership.
   */
  async listUserFamilies(supabaseUserId: string) {
    const memberships = await prisma.familyMembership.findMany({
      where: {
        supabaseUserId,
        status: MembershipStatus.ACTIVE,
      },
      select: {
        id: true,
        role: true,
        status: true,
        joinedAt: true,
        family: {
          select: {
            id: true,
            name: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
      orderBy: {
        joinedAt: "desc",
      },
    });

    return memberships.map((m) => ({
      ...m.family,
      membership: {
        id: m.id,
        role: m.role,
        status: m.status,
        joinedAt: m.joinedAt,
      },
    }));
  },

  /**
   * Create a new family and atomically create the creator's initial ADMIN membership.
   */
  async createFamily(input: CreateFamilyInput) {
    const trimmedName = input.name.trim();

    return await prisma.$transaction(async (tx) => {
      const family = await tx.family.create({
        data: {
          name: trimmedName,
        },
      });

      const membership = await tx.familyMembership.create({
        data: {
          familyId: family.id,
          supabaseUserId: input.supabaseUserId,
          email: input.email,
          role: FamilyRole.ADMIN,
          status: MembershipStatus.ACTIVE,
        },
      });

      return {
        ...family,
        membership: {
          id: membership.id,
          role: membership.role,
          status: membership.status,
          joinedAt: membership.joinedAt,
        },
      };
    });
  },

  /**
   * Get family details. Requires caller to have an ACTIVE membership in this family.
   */
  async getFamilyById(familyId: string, supabaseUserId: string) {
    const membership = await prisma.familyMembership.findUnique({
      where: {
        familyId_supabaseUserId: {
          familyId,
          supabaseUserId,
        },
      },
      include: {
        family: true,
      },
    });

    if (!membership || membership.status !== MembershipStatus.ACTIVE) {
      throw new FamilyServiceError(403, "Access denied: active family membership required");
    }

    const { family } = membership;

    return {
      id: family.id,
      name: family.name,
      createdAt: family.createdAt,
      updatedAt: family.updatedAt,
      currentUserMembership: {
        id: membership.id,
        role: membership.role,
        status: membership.status,
        joinedAt: membership.joinedAt,
      },
    };
  },

  /**
   * List active members in a family. Requires caller to have an ACTIVE membership in this family.
   */
  async listActiveMembers(familyId: string, supabaseUserId: string) {
    const callerMembership = await prisma.familyMembership.findUnique({
      where: {
        familyId_supabaseUserId: {
          familyId,
          supabaseUserId,
        },
      },
    });

    if (!callerMembership || callerMembership.status !== MembershipStatus.ACTIVE) {
      throw new FamilyServiceError(403, "Access denied: active family membership required");
    }

    const members = await prisma.familyMembership.findMany({
      where: {
        familyId,
        status: MembershipStatus.ACTIVE,
      },
      select: {
        id: true,
        familyId: true,
        email: true,
        role: true,
        status: true,
        joinedAt: true,
      },
      orderBy: {
        joinedAt: "asc",
      },
    });

    return members;
  },

  /**
   * Update a member's role.
   * Security & Business rules:
   * - Caller must be an ACTIVE ADMIN in this family.
   * - Target membership must belong to this family.
   * - Target membership must be ACTIVE.
   * - If demoting an ADMIN to MEMBER, ensure this is not the last ACTIVE ADMIN in the family.
   */
  async updateMemberRole(input: UpdateRoleInput) {
    const { familyId, targetMembershipId, newRole, actorUserId } = input;

    return await prisma.$transaction(async (tx) => {
      // 1. Check actor membership
      const actorMembership = await tx.familyMembership.findUnique({
        where: {
          familyId_supabaseUserId: {
            familyId,
            supabaseUserId: actorUserId,
          },
        },
      });

      if (!actorMembership || actorMembership.status !== MembershipStatus.ACTIVE) {
        throw new FamilyServiceError(403, "Access denied: active family membership required");
      }

      if (actorMembership.role !== FamilyRole.ADMIN) {
        throw new FamilyServiceError(403, "Only an active family admin can change member roles");
      }

      // 2. Check target membership
      const targetMembership = await tx.familyMembership.findUnique({
        where: {
          id: targetMembershipId,
        },
      });

      if (!targetMembership || targetMembership.familyId !== familyId) {
        throw new FamilyServiceError(404, "Member not found in this family");
      }

      if (targetMembership.status !== MembershipStatus.ACTIVE) {
        throw new FamilyServiceError(400, "Cannot change role of an inactive member");
      }

      // 3. If target is currently ADMIN and changing to MEMBER, verify not last active ADMIN
      if (targetMembership.role === FamilyRole.ADMIN && newRole === FamilyRole.MEMBER) {
        const activeAdminCount = await tx.familyMembership.count({
          where: {
            familyId,
            role: FamilyRole.ADMIN,
            status: MembershipStatus.ACTIVE,
          },
        });

        if (activeAdminCount <= 1) {
          throw new FamilyServiceError(
            400,
            "Cannot demote the last active admin of the family"
          );
        }
      }

      // 4. Update role
      const updated = await tx.familyMembership.update({
        where: {
          id: targetMembershipId,
        },
        data: {
          role: newRole,
        },
        select: {
          id: true,
          familyId: true,
          email: true,
          role: true,
          status: true,
          joinedAt: true,
          leftAt: true,
        },
      });

      return updated;
    });
  },

  /**
   * Leave a family.
   * Security & Business rules:
   * - Member can only leave their own membership (self-service).
   * - Membership must belong to the specified familyId.
   * - Membership must be ACTIVE.
   * - The last ACTIVE ADMIN cannot leave without promoting another admin first.
   */
  async leaveFamily(input: LeaveFamilyInput) {
    const { familyId, membershipId, actorUserId } = input;

    return await prisma.$transaction(async (tx) => {
      const membership = await tx.familyMembership.findUnique({
        where: {
          id: membershipId,
        },
      });

      if (!membership || membership.familyId !== familyId) {
        throw new FamilyServiceError(404, "Membership not found in this family");
      }

      // Prevent leaving another member's membership
      if (membership.supabaseUserId !== actorUserId) {
        throw new FamilyServiceError(403, "You can only leave your own family membership");
      }

      if (membership.status !== MembershipStatus.ACTIVE) {
        throw new FamilyServiceError(400, "Membership is not active");
      }

      // If actor is an ADMIN, check if they are the last active admin
      if (membership.role === FamilyRole.ADMIN) {
        const activeAdminCount = await tx.familyMembership.count({
          where: {
            familyId,
            role: FamilyRole.ADMIN,
            status: MembershipStatus.ACTIVE,
          },
        });

        if (activeAdminCount <= 1) {
          throw new FamilyServiceError(
            400,
            "The last active admin cannot leave the family without promoting another admin first"
          );
        }
      }

      const updated = await tx.familyMembership.update({
        where: {
          id: membershipId,
        },
        data: {
          status: MembershipStatus.LEFT,
          leftAt: new Date(),
        },
        select: {
          id: true,
          familyId: true,
          email: true,
          role: true,
          status: true,
          joinedAt: true,
          leftAt: true,
        },
      });

      return updated;
    });
  },
};
