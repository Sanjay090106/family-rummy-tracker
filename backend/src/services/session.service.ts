import { prisma } from "../config/prisma";
import { MembershipStatus, SessionStatus } from "../generated/prisma/enums";

/**
 * Checks Prisma error codes without depending on the error class.
 */
function isPrismaErrorCode(err: unknown, code: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as Record<string, unknown>).code === code
  );
}

export class SessionServiceError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "SessionServiceError";
    this.statusCode = statusCode;
  }
}

export interface ListSessionsInput {
  familyId: string;
  status?: SessionStatus;
  actorUserId: string;
}

export interface CreateSessionInput {
  familyId: string;
  sessionDate?: string;
  playerIds?: string[];
  actorUserId: string;
}

export interface GetSessionInput {
  sessionId: string;
  actorUserId: string;
}

export interface UpdateSessionInput {
  sessionId: string;
  sessionDate: string;
  actorUserId: string;
}

export interface AddParticipantsInput {
  sessionId: string;
  playerIds: string[];
  actorUserId: string;
}

export interface TransitionSessionInput {
  sessionId: string;
  actorUserId: string;
}

/**
 * Validates a strict YYYY-MM-DD date and returns UTC midnight.
 */
export function parseStrictCalendarDate(dateStr: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new SessionServiceError(
      400,
      "Invalid date format; expected YYYY-MM-DD"
    );
  }

  const [year, month, day] = dateStr.split("-").map(Number);

  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) {
    throw new SessionServiceError(
      400,
      "Invalid calendar date in YYYY-MM-DD"
    );
  }

  // setUTCFullYear handles years 0001–0099 correctly.
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new SessionServiceError(
      400,
      "Invalid calendar date in YYYY-MM-DD"
    );
  }

  return date;
}

export function getTodayUtcDate(): Date {
  const now = new Date();

  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
}

const participantSelect = {
  id: true,
  sessionId: true,
  familyId: true,
  playerId: true,
  displayName: true,
  joinedAt: true,
} as const;

/**
 * Locks the session row within a transaction.
 * Participant additions and session transitions use this same lock.
 */
async function lockSessionRow(tx: any, sessionId: string): Promise<void> {
  const rows = await tx.$queryRaw`
    SELECT "id"
    FROM "GameSession"
    WHERE "id" = ${sessionId}::uuid
    FOR UPDATE
  `;

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new SessionServiceError(404, "Game session not found");
  }
}

export const sessionService = {
  /**
   * Gets a session and verifies the caller's active family membership.
   */
  async getSessionWithActiveMembership(
    sessionId: string,
    actorUserId: string
  ) {
    const session = await prisma.gameSession.findUnique({
      where: { id: sessionId },
      include: {
        family: true,
        participants: {
          select: participantSelect,
          orderBy: { joinedAt: "asc" },
        },
      },
    });

    if (!session) {
      throw new SessionServiceError(404, "Game session not found");
    }

    const membership = await prisma.familyMembership.findUnique({
      where: {
        familyId_supabaseUserId: {
          familyId: session.familyId,
          supabaseUserId: actorUserId,
        },
      },
    });

    if (!membership || membership.status !== MembershipStatus.ACTIVE) {
      throw new SessionServiceError(
        403,
        "Access denied: active family membership required"
      );
    }

    return { session, membership };
  },

  /**
   * Lists sessions for a family.
   */
  async listSessions(input: ListSessionsInput) {
    const { familyId, status, actorUserId } = input;

    const membership = await prisma.familyMembership.findUnique({
      where: {
        familyId_supabaseUserId: {
          familyId,
          supabaseUserId: actorUserId,
        },
      },
    });

    if (!membership || membership.status !== MembershipStatus.ACTIVE) {
      throw new SessionServiceError(
        403,
        "Access denied: active family membership required"
      );
    }

    const whereClause: {
      familyId: string;
      status?: SessionStatus;
    } = { familyId };

    if (status) {
      whereClause.status = status;
    }

    return prisma.gameSession.findMany({
      where: whereClause,
      select: {
        id: true,
        familyId: true,
        sessionDate: true,
        status: true,
        version: true,
        createdByMembershipId: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            participants: true,
            sets: true,
          },
        },
      },
      orderBy: [
        { sessionDate: "desc" },
        { createdAt: "desc" },
      ],
    });
  },

  /**
   * Creates a session and optionally adds initial participants.
   * All creation operations happen in one transaction.
   */
  async createSession(input: CreateSessionInput) {
    const { familyId, sessionDate, playerIds, actorUserId } = input;

    const membership = await prisma.familyMembership.findUnique({
      where: {
        familyId_supabaseUserId: {
          familyId,
          supabaseUserId: actorUserId,
        },
      },
    });

    if (!membership || membership.status !== MembershipStatus.ACTIVE) {
      throw new SessionServiceError(
        403,
        "Access denied: active family membership required"
      );
    }

    const dateToStore = sessionDate
      ? parseStrictCalendarDate(sessionDate)
      : getTodayUtcDate();

    return prisma.$transaction(async (tx) => {
      const session = await tx.gameSession.create({
        data: {
          familyId,
          sessionDate: dateToStore,
          status: SessionStatus.IN_PROGRESS,
          version: 1,
          createdByMembershipId: membership.id,
        },
      });

      if (playerIds && playerIds.length > 0) {
        if (new Set(playerIds).size !== playerIds.length) {
          throw new SessionServiceError(
            409,
            "Duplicate player IDs supplied in participant list"
          );
        }

        const players = await tx.player.findMany({
          where: {
            id: { in: playerIds },
            familyId,
          },
        });

        if (players.length !== playerIds.length) {
          throw new SessionServiceError(
            404,
            "One or more players not found in this family"
          );
        }

        const inactivePlayer = players.find(
          (player: { isActive: boolean }) => !player.isActive
        );

        if (inactivePlayer) {
          throw new SessionServiceError(
            400,
            `Cannot add inactive player '${inactivePlayer.displayName}' to session`
          );
        }

        for (const player of players) {
          await tx.sessionParticipant.create({
            data: {
              sessionId: session.id,
              familyId,
              playerId: player.id,
              displayName: player.displayName,
            },
          });
        }
      }

      const created = await tx.gameSession.findUnique({
        where: { id: session.id },
        include: {
          participants: {
            select: participantSelect,
            orderBy: { joinedAt: "asc" },
          },
        },
      });

      if (!created) {
        throw new SessionServiceError(
          500,
          "Failed to create game session"
        );
      }

      return created;
    });
  },

  /**
   * Gets session details.
   */
  async getSession(input: GetSessionInput) {
    const { session } = await this.getSessionWithActiveMembership(
      input.sessionId,
      input.actorUserId
    );

    return session;
  },

  /**
   * Updates the session date only while the session is in progress.
   * The conditional database update protects against concurrent transitions.
   */
  async updateSession(input: UpdateSessionInput) {
    const { sessionId, sessionDate, actorUserId } = input;

    const { session } = await this.getSessionWithActiveMembership(
      sessionId,
      actorUserId
    );

    if (session.status !== SessionStatus.IN_PROGRESS) {
      throw new SessionServiceError(
        400,
        `Cannot update session with terminal status ${session.status}`
      );
    }

    const dateToStore = parseStrictCalendarDate(sessionDate);

    const result = await prisma.gameSession.updateMany({
      where: {
        id: sessionId,
        status: SessionStatus.IN_PROGRESS,
      },
      data: {
        sessionDate: dateToStore,
      },
    });

    if (result.count === 0) {
      throw new SessionServiceError(
        409,
        "Session is no longer in progress or was concurrently updated"
      );
    }

    const updated = await prisma.gameSession.findUnique({
      where: { id: sessionId },
      include: {
        participants: {
          select: participantSelect,
          orderBy: { joinedAt: "asc" },
        },
      },
    });

    if (!updated) {
      throw new SessionServiceError(404, "Game session not found");
    }

    return updated;
  },

  /**
   * Adds participants atomically.
   * Uses a session-row lock to coordinate with completion and cancellation.
   */
  async addParticipants(input: AddParticipantsInput) {
    const { sessionId, playerIds, actorUserId } = input;

    const { session } = await this.getSessionWithActiveMembership(
      sessionId,
      actorUserId
    );

    if (session.status !== SessionStatus.IN_PROGRESS) {
      throw new SessionServiceError(
        400,
        `Cannot add participants to session with terminal status ${session.status}`
      );
    }

    if (new Set(playerIds).size !== playerIds.length) {
      throw new SessionServiceError(
        409,
        "Duplicate player IDs supplied in request"
      );
    }

    return prisma.$transaction(async (tx) => {
      await lockSessionRow(tx, sessionId);

      // Recheck status after acquiring the lock.
      const currentSession = await tx.gameSession.findUnique({
        where: { id: sessionId },
        select: {
          familyId: true,
          status: true,
        },
      });

      if (!currentSession) {
        throw new SessionServiceError(404, "Game session not found");
      }

      if (currentSession.status !== SessionStatus.IN_PROGRESS) {
        throw new SessionServiceError(
          409,
          `Cannot add participants to session with status ${currentSession.status}`
        );
      }

      const existingParticipants = await tx.sessionParticipant.findMany({
        where: {
          sessionId,
          playerId: { in: playerIds },
        },
      });

      if (existingParticipants.length > 0) {
        throw new SessionServiceError(
          409,
          "One or more players are already participants in this session"
        );
      }

      const players = await tx.player.findMany({
        where: {
          id: { in: playerIds },
          familyId: currentSession.familyId,
        },
      });

      if (players.length !== playerIds.length) {
        throw new SessionServiceError(
          404,
          "One or more players not found in this family"
        );
      }

      const inactivePlayer = players.find(
        (player: { isActive: boolean }) => !player.isActive
      );

      if (inactivePlayer) {
        throw new SessionServiceError(
          400,
          `Cannot add inactive player '${inactivePlayer.displayName}' to session`
        );
      }

      const newParticipants = [];

      try {
        for (const player of players) {
          const participant = await tx.sessionParticipant.create({
            data: {
              sessionId,
              familyId: currentSession.familyId,
              playerId: player.id,
              displayName: player.displayName,
            },
            select: participantSelect,
          });

          newParticipants.push(participant);
        }
      } catch (err) {
        if (isPrismaErrorCode(err, "P2002")) {
          throw new SessionServiceError(
            409,
            "One or more players were concurrently added as participants; please retry"
          );
        }

        throw err;
      }

      return newParticipants;
    });
  },

  /**
   * Completes a session when it has at least two participants.
   */
  async completeSession(input: TransitionSessionInput) {
    const { sessionId, actorUserId } = input;

    const { session } = await this.getSessionWithActiveMembership(
      sessionId,
      actorUserId
    );

    if (session.status !== SessionStatus.IN_PROGRESS) {
      throw new SessionServiceError(
        400,
        `Cannot complete session with status ${session.status}`
      );
    }

    return prisma.$transaction(async (tx) => {
      await lockSessionRow(tx, sessionId);

      const currentSession = await tx.gameSession.findUnique({
        where: { id: sessionId },
        select: { status: true },
      });

      if (!currentSession) {
        throw new SessionServiceError(404, "Game session not found");
      }

      if (currentSession.status !== SessionStatus.IN_PROGRESS) {
        throw new SessionServiceError(
          409,
          "Session is no longer in progress or was concurrently updated"
        );
      }

      const participantCount = await tx.sessionParticipant.count({
        where: { sessionId },
      });

      if (participantCount < 2) {
        throw new SessionServiceError(
          400,
          "Cannot complete session: at least 2 participants are required"
        );
      }

      const result = await tx.gameSession.updateMany({
        where: {
          id: sessionId,
          status: SessionStatus.IN_PROGRESS,
        },
        data: {
          status: SessionStatus.COMPLETED,
          version: { increment: 1 },
        },
      });

      if (result.count === 0) {
        throw new SessionServiceError(
          409,
          "Session is no longer in progress or was concurrently updated"
        );
      }

      const updated = await tx.gameSession.findUnique({
        where: { id: sessionId },
        include: {
          participants: {
            select: participantSelect,
            orderBy: { joinedAt: "asc" },
          },
        },
      });

      if (!updated) {
        throw new SessionServiceError(404, "Game session not found");
      }

      return updated;
    });
  },

  /**
   * Cancels a session that is still in progress.
   */
  async cancelSession(input: TransitionSessionInput) {
    const { sessionId, actorUserId } = input;

    const { session } = await this.getSessionWithActiveMembership(
      sessionId,
      actorUserId
    );

    if (session.status !== SessionStatus.IN_PROGRESS) {
      throw new SessionServiceError(
        400,
        `Cannot cancel session with status ${session.status}`
      );
    }

    return prisma.$transaction(async (tx) => {
      await lockSessionRow(tx, sessionId);

      const currentSession = await tx.gameSession.findUnique({
        where: { id: sessionId },
        select: { status: true },
      });

      if (!currentSession) {
        throw new SessionServiceError(404, "Game session not found");
      }

      if (currentSession.status !== SessionStatus.IN_PROGRESS) {
        throw new SessionServiceError(
          409,
          "Session is no longer in progress or was concurrently updated"
        );
      }

      const result = await tx.gameSession.updateMany({
        where: {
          id: sessionId,
          status: SessionStatus.IN_PROGRESS,
        },
        data: {
          status: SessionStatus.CANCELLED,
          version: { increment: 1 },
        },
      });

      if (result.count === 0) {
        throw new SessionServiceError(
          409,
          "Session is no longer in progress or was concurrently updated"
        );
      }

      const updated = await tx.gameSession.findUnique({
        where: { id: sessionId },
        include: {
          participants: {
            select: participantSelect,
            orderBy: { joinedAt: "asc" },
          },
        },
      });

      if (!updated) {
        throw new SessionServiceError(404, "Game session not found");
      }

      return updated;
    });
  },
};