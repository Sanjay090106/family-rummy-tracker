
import { prisma } from "../config/prisma";
import {
  MembershipStatus,
  SessionStatus,
  SetStatus,
  RoundStatus,
} from "../generated/prisma/enums";

type TransactionClient = any;

export class ScoringServiceError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "ScoringServiceError";
    this.statusCode = statusCode;
  }
}

interface ActorInput {
  sessionId: string;
  actorUserId: string;
}

interface CreateScoresInput extends ActorInput {
  roundId: string;
  scores: Array<{
    participantId: string;
    points: number;
  }>;
}

interface CorrectScoreInput extends ActorInput {
  scoreId: string;
  points: number;
  reason?: string;
}

function isPrismaErrorCode(err: unknown, code: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as Record<string, unknown>).code === code
  );
}

async function lockSessionRow(
  tx: TransactionClient,
  sessionId: string
): Promise<void> {
  const rows = await tx.$queryRaw`
    SELECT "id"
    FROM "GameSession"
    WHERE "id" = ${sessionId}::uuid
    FOR UPDATE
  `;

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new ScoringServiceError(404, "Game session not found");
  }
}

async function getSessionContext(
  sessionId: string,
  actorUserId: string
) {
  const session = await prisma.gameSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      familyId: true,
      status: true,
      version: true,
    },
  });

  if (!session) {
    throw new ScoringServiceError(404, "Game session not found");
  }

  const membership = await prisma.familyMembership.findUnique({
    where: {
      familyId_supabaseUserId: {
        familyId: session.familyId,
        supabaseUserId: actorUserId,
      },
    },
    select: {
      id: true,
      familyId: true,
      status: true,
    },
  });

  if (!membership || membership.status !== MembershipStatus.ACTIVE) {
    throw new ScoringServiceError(
      403,
      "You are not an active member of this family"
    );
  }

  return { session, membership };
}

async function requireInProgressSession(
  tx: TransactionClient,
  sessionId: string
) {
  const session = await tx.gameSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      familyId: true,
      status: true,
    },
  });

  if (!session) {
    throw new ScoringServiceError(404, "Game session not found");
  }

  if (session.status !== SessionStatus.IN_PROGRESS) {
    throw new ScoringServiceError(
      409,
      "Scoring cannot be changed because the session is not in progress"
    );
  }

  return session;
}

async function getSetAndCheck(
  tx: TransactionClient,
  sessionId: string,
  setId: string
) {
  const set = await tx.gameSet.findFirst({
    where: { id: setId, sessionId },
    select: {
      id: true,
      sessionId: true,
      setNumber: true,
      status: true,
    },
  });

  if (!set) {
    throw new ScoringServiceError(
      404,
      "Game set not found in this session"
    );
  }

  return set;
}

async function getRoundAndCheck(
  tx: TransactionClient,
  sessionId: string,
  roundId: string
) {
  const round = await tx.round.findFirst({
    where: { id: roundId, sessionId },
    select: {
      id: true,
      sessionId: true,
      setId: true,
      roundNumber: true,
      status: true,
    },
  });

  if (!round) {
    throw new ScoringServiceError(
      404,
      "Round not found in this session"
    );
  }

  return round;
}

export const scoringService = {
  async createSet({ sessionId, actorUserId }: ActorInput) {
    await getSessionContext(sessionId, actorUserId);

    try {
      return await prisma.$transaction(async (tx) => {
        await lockSessionRow(tx, sessionId);
        await requireInProgressSession(tx, sessionId);

        const unfinishedSet = await tx.gameSet.findFirst({
          where: {
            sessionId,
            status: SetStatus.IN_PROGRESS,
          },
          select: { id: true },
        });

        if (unfinishedSet) {
          throw new ScoringServiceError(
            409,
            "Complete the current set before creating another set"
          );
        }

        const lastSet = await tx.gameSet.findFirst({
          where: { sessionId },
          orderBy: { setNumber: "desc" },
          select: { setNumber: true },
        });

        return tx.gameSet.create({
          data: {
            sessionId,
            setNumber: (lastSet?.setNumber ?? 0) + 1,
            status: SetStatus.IN_PROGRESS,
          },
        });
      });
    } catch (error) {
      if (error instanceof ScoringServiceError) throw error;
      if (isPrismaErrorCode(error, "P2002")) {
        throw new ScoringServiceError(
          409,
          "A set with this number already exists"
        );
      }
      throw error;
    }
  },

  async listSets({ sessionId, actorUserId }: ActorInput) {
    await getSessionContext(sessionId, actorUserId);

    return prisma.gameSet.findMany({
      where: { sessionId },
      orderBy: { setNumber: "asc" },
      include: {
        rounds: {
          orderBy: { roundNumber: "asc" },
          include: {
            scores: {
              select: {
                id: true,
                participantId: true,
                points: true,
              },
            },
          },
        },
      },
    });
  },

  async createRound({
    sessionId,
    setId,
    actorUserId,
  }: ActorInput & { setId: string }) {
    await getSessionContext(sessionId, actorUserId);

    try {
      return await prisma.$transaction(async (tx) => {
        await lockSessionRow(tx, sessionId);
        await requireInProgressSession(tx, sessionId);

        const set = await getSetAndCheck(tx, sessionId, setId);

        if (set.status !== SetStatus.IN_PROGRESS) {
          throw new ScoringServiceError(
            409,
            "Cannot add a round to a completed set"
          );
        }

        const unfinishedRound = await tx.round.findFirst({
          where: {
            sessionId,
            setId,
            status: RoundStatus.IN_PROGRESS,
          },
          select: { id: true },
        });

        if (unfinishedRound) {
          throw new ScoringServiceError(
            409,
            "Complete the current round before creating another round"
          );
        }

        const lastRound = await tx.round.findFirst({
          where: { sessionId, setId },
          orderBy: { roundNumber: "desc" },
          select: { roundNumber: true },
        });

        return tx.round.create({
          data: {
            sessionId,
            setId,
            roundNumber: (lastRound?.roundNumber ?? 0) + 1,
            status: RoundStatus.IN_PROGRESS,
          },
        });
      });
    } catch (error) {
      if (error instanceof ScoringServiceError) throw error;
      if (isPrismaErrorCode(error, "P2002")) {
        throw new ScoringServiceError(
          409,
          "A round with this number already exists"
        );
      }
      throw error;
    }
  },

  async createScores({
    sessionId,
    roundId,
    scores,
    actorUserId,
  }: CreateScoresInput) {
    await getSessionContext(sessionId, actorUserId);

    if (scores.length === 0) {
      throw new ScoringServiceError(
        400,
        "At least one score is required"
      );
    }

    const participantIds = scores.map((score) => score.participantId);

    if (new Set(participantIds).size !== participantIds.length) {
      throw new ScoringServiceError(
        400,
        "Each participant can have only one score per round"
      );
    }

    try {
      return await prisma.$transaction(async (tx) => {
        await lockSessionRow(tx, sessionId);

        const session = await requireInProgressSession(tx, sessionId);
        const round = await getRoundAndCheck(tx, sessionId, roundId);
        const set = await getSetAndCheck(tx, sessionId, round.setId);

        if (set.status !== SetStatus.IN_PROGRESS) {
          throw new ScoringServiceError(
            409,
            "Cannot enter scores for a completed set"
          );
        }

        if (round.status !== RoundStatus.IN_PROGRESS) {
          throw new ScoringServiceError(
            409,
            "Cannot enter scores for a completed round"
          );
        }

        const participants = await tx.sessionParticipant.findMany({
          where: { sessionId },
          select: { id: true },
        });

        if (participants.length < 2) {
          throw new ScoringServiceError(
            409,
            "At least two participants are required for scoring"
          );
        }

        const expectedIds = new Set(
          participants.map((participant: { id: string }) => participant.id)
        );

        if (
          participantIds.length !== participants.length ||
          participantIds.some((id) => !expectedIds.has(id))
        ) {
          throw new ScoringServiceError(
            400,
            "Submit exactly one score for every participant in this session"
          );
        }

        const existingScores = await tx.roundScore.count({
          where: { roundId, sessionId },
        });

        if (existingScores > 0) {
          throw new ScoringServiceError(
            409,
            "Scores have already been entered for this round; use score correction instead"
          );
        }

        const created = await tx.roundScore.createMany({
          data: scores.map((score) => ({
            roundId,
            sessionId,
            participantId: score.participantId,
            familyId: session.familyId,
            points: score.points,
          })),
        });

        return {
          createdCount: created.count,
          roundId,
        };
      });
    } catch (error) {
      if (error instanceof ScoringServiceError) throw error;
      if (isPrismaErrorCode(error, "P2002")) {
        throw new ScoringServiceError(
          409,
          "A score already exists for a participant in this round"
        );
      }
      throw error;
    }
  },

  async completeRound({
    sessionId,
    roundId,
    actorUserId,
  }: ActorInput & { roundId: string }) {
    await getSessionContext(sessionId, actorUserId);

    return prisma.$transaction(async (tx) => {
      await lockSessionRow(tx, sessionId);
      await requireInProgressSession(tx, sessionId);

      const round = await getRoundAndCheck(tx, sessionId, roundId);
      const set = await getSetAndCheck(tx, sessionId, round.setId);

      if (set.status !== SetStatus.IN_PROGRESS) {
        throw new ScoringServiceError(
          409,
          "Cannot complete a round in a completed set"
        );
      }

      if (round.status !== RoundStatus.IN_PROGRESS) {
        throw new ScoringServiceError(
          409,
          "This round is already completed"
        );
      }

      const participantCount = await tx.sessionParticipant.count({
        where: { sessionId },
      });

      const scoreCount = await tx.roundScore.count({
        where: { sessionId, roundId },
      });

      if (participantCount < 2 || scoreCount !== participantCount) {
        throw new ScoringServiceError(
          409,
          "Every participant must have a score before the round can be completed"
        );
      }

      return tx.round.update({
        where: { id: roundId },
        data: { status: RoundStatus.COMPLETED },
      });
    });
  },

  async completeSet({
    sessionId,
    setId,
    actorUserId,
  }: ActorInput & { setId: string }) {
    await getSessionContext(sessionId, actorUserId);

    return prisma.$transaction(async (tx) => {
      await lockSessionRow(tx, sessionId);
      await requireInProgressSession(tx, sessionId);

      const set = await getSetAndCheck(tx, sessionId, setId);

      if (set.status !== SetStatus.IN_PROGRESS) {
        throw new ScoringServiceError(
          409,
          "This set is already completed"
        );
      }

      const rounds = await tx.round.findMany({
        where: { sessionId, setId },
        select: { id: true, status: true },
      });

      if (
        rounds.length === 0 ||
        rounds.some(
          (round: { status: RoundStatus }) =>
            round.status !== RoundStatus.COMPLETED
        )
      ) {
        throw new ScoringServiceError(
          409,
          "A set must contain at least one round, and all rounds must be completed"
        );
      }

      return tx.gameSet.update({
        where: { id: setId },
        data: { status: SetStatus.COMPLETED },
      });
    });
  },

  async correctScore({
    sessionId,
    scoreId,
    points,
    reason,
    actorUserId,
  }: CorrectScoreInput) {
    const { membership } = await getSessionContext(
      sessionId,
      actorUserId
    );

    return prisma.$transaction(async (tx) => {
      await lockSessionRow(tx, sessionId);

      const session = await requireInProgressSession(tx, sessionId);

      const score = await tx.roundScore.findFirst({
        where: { id: scoreId, sessionId },
        select: {
          id: true,
          roundId: true,
          participantId: true,
          points: true,
        },
      });

      if (!score) {
        throw new ScoringServiceError(
          404,
          "Score not found in this session"
        );
      }

      const round = await getRoundAndCheck(
        tx,
        sessionId,
        score.roundId
      );
      const set = await getSetAndCheck(tx, sessionId, round.setId);

      if (
        round.status !== RoundStatus.IN_PROGRESS ||
        set.status !== SetStatus.IN_PROGRESS
      ) {
        throw new ScoringServiceError(
          409,
          "Scores can only be corrected in an in-progress round and set"
        );
      }

      const updated = await tx.roundScore.update({
        where: { id: scoreId },
        data: { points },
      });

      await tx.scoreAudit.create({
        data: {
          scoreId,
          sessionId,
          familyId: session.familyId,
          actorMembershipId: membership.id,
          oldPoints: score.points,
          newPoints: points,
          reason: reason?.trim() || null,
        },
      });

      return updated;
    });
  },

  async getLeaderboard({ sessionId, actorUserId }: ActorInput) {
    await getSessionContext(sessionId, actorUserId);

    const participants = await prisma.sessionParticipant.findMany({
      where: { sessionId },
      select: {
        id: true,
        playerId: true,
        displayName: true,
        joinedAt: true,
      },
      orderBy: { joinedAt: "asc" },
    });

    const totals = await prisma.roundScore.groupBy({
      by: ["participantId"],
      where: { sessionId },
      _sum: { points: true },
    });

    const totalByParticipant = new Map<string, number>(
      totals.map(
        (entry: {
          participantId: string;
          _sum: { points: number | null };
        }) => [entry.participantId, entry._sum.points ?? 0]
      )
    );

    const ranked = participants
      .map((participant: {
        id: string;
        playerId: string;
        displayName: string;
        joinedAt: Date;
      }) => ({
        participantId: participant.id,
        playerId: participant.playerId,
        displayName: participant.displayName,
        totalPoints: totalByParticipant.get(participant.id) ?? 0,
      }))
      .sort(
        (a: { totalPoints: number }, b: { totalPoints: number }) =>
          a.totalPoints - b.totalPoints
      );

    let previousTotal: number | undefined;
    let currentRank = 0;

    const leaderboard = ranked.map(
      (participant: {
        participantId: string;
        playerId: string;
        displayName: string;
        totalPoints: number;
      }, index: number) => {
        if (participant.totalPoints !== previousTotal) {
          currentRank = index + 1;
          previousTotal = participant.totalPoints;
        }

        return {
          rank: currentRank,
          ...participant,
        };
      }
    );

    return {
      sessionId,
      rankingRule: "Lowest cumulative score wins; equal totals share a rank",
      leaderboard,
    };
  },
};
