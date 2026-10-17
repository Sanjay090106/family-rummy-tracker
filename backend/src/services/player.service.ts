import { prisma } from "../config/prisma";
import { MembershipStatus } from "../generated/prisma/enums";

export class PlayerServiceError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "PlayerServiceError";
    this.statusCode = statusCode;
  }
}

export interface CreatePlayerInput {
  familyId: string;
  membershipId: string;
  displayName: string;
  actorUserId: string;
}

export interface UpdatePlayerInput {
  familyId: string;
  playerId: string;
  displayName?: string;
  isActive?: boolean;
  actorUserId: string;
}

export const playerService = {
  /**
   * List players belonging to a family.
   * Access requires the actor to have an ACTIVE membership in the family.
   */
  async listPlayers(familyId: string, actorUserId: string) {
    // Verify caller has an active membership in the family
    const callerMembership = await prisma.familyMembership.findUnique({
      where: {
        familyId_supabaseUserId: {
          familyId,
          supabaseUserId: actorUserId,
        },
      },
    });

    if (!callerMembership || callerMembership.status !== MembershipStatus.ACTIVE) {
      throw new PlayerServiceError(403, "Access denied: active family membership required");
    }

    const players = await prisma.player.findMany({
      where: {
        familyId,
      },
      select: {
        id: true,
        familyId: true,
        membershipId: true,
        displayName: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        membership: {
          select: {
            id: true,
            email: true,
            role: true,
            status: true,
          },
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    return players;
  },

  /**
   * Create a player linked to an eligible membership in the same family.
   * Business rules:
   * 1. Caller must have an ACTIVE membership in the family.
   * 2. Target membership must belong to the same family and be ACTIVE.
   * 3. Target membership must not already have a linked player (enforcing one-player-per-family-membership).
   * 4. Guest players are not supported.
   */
  async createPlayer(input: CreatePlayerInput) {
    const { familyId, membershipId, displayName, actorUserId } = input;
    const trimmedDisplayName = displayName.trim();

    return await prisma.$transaction(async (tx) => {
      // 1. Verify caller has active membership in the family
      const callerMembership = await tx.familyMembership.findUnique({
        where: {
          familyId_supabaseUserId: {
            familyId,
            supabaseUserId: actorUserId,
          },
        },
      });

      if (!callerMembership || callerMembership.status !== MembershipStatus.ACTIVE) {
        throw new PlayerServiceError(403, "Access denied: active family membership required");
      }

      // 2. Verify target membership belongs to the same family and is active
      const targetMembership = await tx.familyMembership.findUnique({
        where: {
          id: membershipId,
        },
        include: {
          player: true,
        },
      });

      if (!targetMembership || targetMembership.familyId !== familyId) {
        throw new PlayerServiceError(404, "Target membership not found in this family");
      }

      if (targetMembership.status !== MembershipStatus.ACTIVE) {
        throw new PlayerServiceError(400, "Cannot link player to an inactive family membership");
      }

      // 3. Enforce one-player-per-family-membership rule
      if (targetMembership.player) {
        throw new PlayerServiceError(409, "A player is already linked to this family membership");
      }

      // 4. Create player
      const player = await tx.player.create({
        data: {
          familyId,
          membershipId,
          displayName: trimmedDisplayName,
          isActive: true,
        },
        select: {
          id: true,
          familyId: true,
          membershipId: true,
          displayName: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          membership: {
            select: {
              id: true,
              email: true,
              role: true,
              status: true,
            },
          },
        },
      });

      return player;
    });
  },

  /**
   * Update a player belonging to the requested family.
   * Business rules:
   * 1. Caller must have an ACTIVE membership in the family.
   * 2. Player must exist and belong to the requested family.
   * 3. Update displayName and/or isActive status.
   */
  async updatePlayer(input: UpdatePlayerInput) {
    const { familyId, playerId, displayName, isActive, actorUserId } = input;

    return await prisma.$transaction(async (tx) => {
      // 1. Verify caller has active membership in the family
      const callerMembership = await tx.familyMembership.findUnique({
        where: {
          familyId_supabaseUserId: {
            familyId,
            supabaseUserId: actorUserId,
          },
        },
      });

      if (!callerMembership || callerMembership.status !== MembershipStatus.ACTIVE) {
        throw new PlayerServiceError(403, "Access denied: active family membership required");
      }

      // 2. Verify player exists and belongs to the requested family
      const existingPlayer = await tx.player.findUnique({
        where: {
          id: playerId,
        },
      });

      if (!existingPlayer || existingPlayer.familyId !== familyId) {
        throw new PlayerServiceError(404, "Player not found in this family");
      }

      // Prepare update payload
      const updateData: { displayName?: string; isActive?: boolean } = {};
      if (displayName !== undefined) {
        updateData.displayName = displayName.trim();
      }
      if (isActive !== undefined) {
        updateData.isActive = isActive;
      }

      const updatedPlayer = await tx.player.update({
        where: {
          id: playerId,
        },
        data: updateData,
        select: {
          id: true,
          familyId: true,
          membershipId: true,
          displayName: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          membership: {
            select: {
              id: true,
              email: true,
              role: true,
              status: true,
            },
          },
        },
      });

      return updatedPlayer;
    });
  },
};
