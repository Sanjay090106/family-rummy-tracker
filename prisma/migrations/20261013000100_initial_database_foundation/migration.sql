-- Initial Family Rummy Tracker database foundation.
-- UUID values and @updatedAt values are supplied by Prisma Client.

CREATE TYPE "FamilyRole" AS ENUM ('ADMIN', 'MEMBER');
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'LEFT');
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');
CREATE TYPE "SessionStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'CANCELLED');
CREATE TYPE "SetStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');
CREATE TYPE "RoundStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

CREATE TABLE "Family" (
  "id" UUID NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Family_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FamilyMembership" (
  "id" UUID NOT NULL,
  "familyId" UUID NOT NULL,
  "supabaseUserId" VARCHAR(255) NOT NULL,
  "email" VARCHAR(320) NOT NULL,
  "role" "FamilyRole" NOT NULL DEFAULT 'MEMBER',
  "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leftAt" TIMESTAMP(3),
  CONSTRAINT "FamilyMembership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Player" (
  "id" UUID NOT NULL,
  "familyId" UUID NOT NULL,
  "membershipId" UUID NOT NULL,
  "displayName" VARCHAR(100) NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FamilyInvitation" (
  "id" UUID NOT NULL,
  "familyId" UUID NOT NULL,
  "email" VARCHAR(320) NOT NULL,
  "tokenHash" VARCHAR(255) NOT NULL,
  "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "invitedByMembershipId" UUID NOT NULL,
  "acceptedByMembershipId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FamilyInvitation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GameSession" (
  "id" UUID NOT NULL,
  "familyId" UUID NOT NULL,
  "sessionDate" DATE NOT NULL,
  "status" "SessionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByMembershipId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GameSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GameSession_version_check" CHECK ("version" >= 1)
);

CREATE TABLE "SessionParticipant" (
  "id" UUID NOT NULL,
  "sessionId" UUID NOT NULL,
  "familyId" UUID NOT NULL,
  "playerId" UUID NOT NULL,
  "displayName" VARCHAR(100) NOT NULL,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SessionParticipant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GameSet" (
  "id" UUID NOT NULL,
  "sessionId" UUID NOT NULL,
  "setNumber" INTEGER NOT NULL,
  "status" "SetStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GameSet_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GameSet_setNumber_check" CHECK ("setNumber" >= 1)
);

CREATE TABLE "Round" (
  "id" UUID NOT NULL,
  "setId" UUID NOT NULL,
  "sessionId" UUID NOT NULL,
  "roundNumber" INTEGER NOT NULL,
  "status" "RoundStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Round_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Round_roundNumber_check" CHECK ("roundNumber" BETWEEN 1 AND 7)
);

CREATE TABLE "RoundScore" (
  "id" UUID NOT NULL,
  "roundId" UUID NOT NULL,
  "sessionId" UUID NOT NULL,
  "participantId" UUID NOT NULL,
  "familyId" UUID NOT NULL,
  "points" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RoundScore_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RoundScore_points_check" CHECK ("points" >= 0)
);

CREATE TABLE "ScoreAudit" (
  "id" UUID NOT NULL,
  "scoreId" UUID NOT NULL,
  "sessionId" UUID NOT NULL,
  "familyId" UUID NOT NULL,
  "actorMembershipId" UUID NOT NULL,
  "oldPoints" INTEGER NOT NULL,
  "newPoints" INTEGER NOT NULL,
  "reason" VARCHAR(500),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ScoreAudit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ScoreAudit_oldPoints_check" CHECK ("oldPoints" >= 0),
  CONSTRAINT "ScoreAudit_newPoints_check" CHECK ("newPoints" >= 0)
);

CREATE UNIQUE INDEX "FamilyMembership_familyId_supabaseUserId_key" ON "FamilyMembership"("familyId", "supabaseUserId");
CREATE UNIQUE INDEX "FamilyMembership_id_familyId_key" ON "FamilyMembership"("id", "familyId");
CREATE INDEX "FamilyMembership_supabaseUserId_status_idx" ON "FamilyMembership"("supabaseUserId", "status");
CREATE INDEX "FamilyMembership_familyId_status_idx" ON "FamilyMembership"("familyId", "status");
CREATE UNIQUE INDEX "Player_membershipId_familyId_key" ON "Player"("membershipId", "familyId");
CREATE UNIQUE INDEX "Player_id_familyId_key" ON "Player"("id", "familyId");
CREATE INDEX "Player_familyId_isActive_idx" ON "Player"("familyId", "isActive");
CREATE UNIQUE INDEX "FamilyInvitation_tokenHash_key" ON "FamilyInvitation"("tokenHash");
CREATE INDEX "FamilyInvitation_familyId_status_expiresAt_idx" ON "FamilyInvitation"("familyId", "status", "expiresAt");
CREATE INDEX "FamilyInvitation_email_status_idx" ON "FamilyInvitation"("email", "status");
CREATE UNIQUE INDEX "GameSession_id_familyId_key" ON "GameSession"("id", "familyId");
CREATE INDEX "GameSession_familyId_sessionDate_idx" ON "GameSession"("familyId", "sessionDate");
CREATE INDEX "GameSession_familyId_status_sessionDate_idx" ON "GameSession"("familyId", "status", "sessionDate");
CREATE UNIQUE INDEX "SessionParticipant_sessionId_playerId_key" ON "SessionParticipant"("sessionId", "playerId");
CREATE UNIQUE INDEX "SessionParticipant_id_sessionId_key" ON "SessionParticipant"("id", "sessionId");
CREATE INDEX "SessionParticipant_familyId_sessionId_idx" ON "SessionParticipant"("familyId", "sessionId");
CREATE UNIQUE INDEX "GameSet_sessionId_setNumber_key" ON "GameSet"("sessionId", "setNumber");
CREATE UNIQUE INDEX "GameSet_id_sessionId_key" ON "GameSet"("id", "sessionId");
CREATE INDEX "GameSet_sessionId_status_idx" ON "GameSet"("sessionId", "status");
CREATE UNIQUE INDEX "Round_setId_roundNumber_key" ON "Round"("setId", "roundNumber");
CREATE UNIQUE INDEX "Round_id_sessionId_key" ON "Round"("id", "sessionId");
CREATE INDEX "Round_sessionId_status_idx" ON "Round"("sessionId", "status");
CREATE UNIQUE INDEX "RoundScore_roundId_participantId_key" ON "RoundScore"("roundId", "participantId");
CREATE UNIQUE INDEX "RoundScore_id_sessionId_key" ON "RoundScore"("id", "sessionId");
CREATE INDEX "RoundScore_participantId_roundId_idx" ON "RoundScore"("participantId", "roundId");
CREATE INDEX "ScoreAudit_scoreId_createdAt_idx" ON "ScoreAudit"("scoreId", "createdAt");
CREATE INDEX "ScoreAudit_actorMembershipId_createdAt_idx" ON "ScoreAudit"("actorMembershipId", "createdAt");

ALTER TABLE "FamilyMembership" ADD CONSTRAINT "FamilyMembership_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Player" ADD CONSTRAINT "Player_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Player" ADD CONSTRAINT "Player_membershipId_familyId_fkey" FOREIGN KEY ("membershipId", "familyId") REFERENCES "FamilyMembership"("id", "familyId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FamilyInvitation" ADD CONSTRAINT "FamilyInvitation_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FamilyInvitation" ADD CONSTRAINT "FamilyInvitation_invitedByMembershipId_familyId_fkey" FOREIGN KEY ("invitedByMembershipId", "familyId") REFERENCES "FamilyMembership"("id", "familyId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FamilyInvitation" ADD CONSTRAINT "FamilyInvitation_acceptedByMembershipId_familyId_fkey" FOREIGN KEY ("acceptedByMembershipId", "familyId") REFERENCES "FamilyMembership"("id", "familyId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_createdByMembershipId_familyId_fkey" FOREIGN KEY ("createdByMembershipId", "familyId") REFERENCES "FamilyMembership"("id", "familyId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SessionParticipant" ADD CONSTRAINT "SessionParticipant_sessionId_familyId_fkey" FOREIGN KEY ("sessionId", "familyId") REFERENCES "GameSession"("id", "familyId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SessionParticipant" ADD CONSTRAINT "SessionParticipant_playerId_familyId_fkey" FOREIGN KEY ("playerId", "familyId") REFERENCES "Player"("id", "familyId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GameSet" ADD CONSTRAINT "GameSet_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Round" ADD CONSTRAINT "Round_setId_sessionId_fkey" FOREIGN KEY ("setId", "sessionId") REFERENCES "GameSet"("id", "sessionId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RoundScore" ADD CONSTRAINT "RoundScore_roundId_sessionId_fkey" FOREIGN KEY ("roundId", "sessionId") REFERENCES "Round"("id", "sessionId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RoundScore" ADD CONSTRAINT "RoundScore_participantId_sessionId_fkey" FOREIGN KEY ("participantId", "sessionId") REFERENCES "SessionParticipant"("id", "sessionId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RoundScore" ADD CONSTRAINT "RoundScore_sessionId_familyId_fkey" FOREIGN KEY ("sessionId", "familyId") REFERENCES "GameSession"("id", "familyId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ScoreAudit" ADD CONSTRAINT "ScoreAudit_scoreId_sessionId_fkey" FOREIGN KEY ("scoreId", "sessionId") REFERENCES "RoundScore"("id", "sessionId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ScoreAudit" ADD CONSTRAINT "ScoreAudit_actorMembershipId_familyId_fkey" FOREIGN KEY ("actorMembershipId", "familyId") REFERENCES "FamilyMembership"("id", "familyId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ScoreAudit" ADD CONSTRAINT "ScoreAudit_sessionId_familyId_fkey" FOREIGN KEY ("sessionId", "familyId") REFERENCES "GameSession"("id", "familyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Keep score correction history append-only, including against direct SQL updates/deletes.
CREATE FUNCTION prevent_score_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ScoreAudit records are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ScoreAudit_immutable_trigger"
BEFORE UPDATE OR DELETE ON "ScoreAudit"
FOR EACH ROW EXECUTE FUNCTION prevent_score_audit_mutation();
