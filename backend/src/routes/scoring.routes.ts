
import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/authenticate";
import { validateRequest } from "../middleware/validate-request";
import { scoringService } from "../services/scoring.service";

const router = Router();

const sessionParams = z.object({
  sessionId: z.string().uuid("Invalid session ID format"),
});

const setParams = sessionParams.extend({
  setId: z.string().uuid("Invalid set ID format"),
});

const roundParams = sessionParams.extend({
  roundId: z.string().uuid("Invalid round ID format"),
});

const scoreParams = sessionParams.extend({
  scoreId: z.string().uuid("Invalid score ID format"),
});

const createScoresBody = z.object({
  scores: z
    .array(
      z.object({
        participantId: z.string().uuid("Invalid participant ID format"),
        points: z.number().int().min(0, "Points cannot be negative"),
      })
    )
    .min(1, "At least one score is required"),
});

const correctScoreBody = z.object({
  points: z.number().int().min(0, "Points cannot be negative"),
  reason: z
    .string()
    .trim()
    .max(500, "Reason cannot exceed 500 characters")
    .optional(),
});

function handleError(
  error: unknown,
  next: NextFunction
): void {
  next(error);
}

// POST /api/sessions/:sessionId/sets
router.post(
  "/sessions/:sessionId/sets",
  authenticate,
  validateRequest({ params: sessionParams }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await scoringService.createSet({
        sessionId: String(req.params.sessionId),
        actorUserId: req.user!.id,
      });

      res.status(201).json({ status: "ok", data });
    } catch (error) {
      handleError(error, next);
    }
  }
);

// GET /api/sessions/:sessionId/sets
router.get(
  "/sessions/:sessionId/sets",
  authenticate,
  validateRequest({ params: sessionParams }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await scoringService.listSets({
        sessionId: String(req.params.sessionId),
        actorUserId: req.user!.id,
      });

      res.status(200).json({ status: "ok", data });
    } catch (error) {
      handleError(error, next);
    }
  }
);

// POST /api/sessions/:sessionId/sets/:setId/rounds
router.post(
  "/sessions/:sessionId/sets/:setId/rounds",
  authenticate,
  validateRequest({ params: setParams }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await scoringService.createRound({
        sessionId: String(req.params.sessionId),
        setId: String(req.params.setId),
        actorUserId: req.user!.id,
      });

      res.status(201).json({ status: "ok", data });
    } catch (error) {
      handleError(error, next);
    }
  }
);

// POST /api/sessions/:sessionId/rounds/:roundId/scores
router.post(
  "/sessions/:sessionId/rounds/:roundId/scores",
  authenticate,
  validateRequest({
    params: roundParams,
    body: createScoresBody,
  }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await scoringService.createScores({
        sessionId: String(req.params.sessionId),
        roundId: String(req.params.roundId),
        scores: req.body.scores,
        actorUserId: req.user!.id,
      });

      res.status(201).json({ status: "ok", data });
    } catch (error) {
      handleError(error, next);
    }
  }
);

// POST /api/sessions/:sessionId/rounds/:roundId/complete
router.post(
  "/sessions/:sessionId/rounds/:roundId/complete",
  authenticate,
  validateRequest({ params: roundParams }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await scoringService.completeRound({
        sessionId: String(req.params.sessionId),
        roundId: String(req.params.roundId),
        actorUserId: req.user!.id,
      });

      res.status(200).json({ status: "ok", data });
    } catch (error) {
      handleError(error, next);
    }
  }
);

// POST /api/sessions/:sessionId/sets/:setId/complete
router.post(
  "/sessions/:sessionId/sets/:setId/complete",
  authenticate,
  validateRequest({ params: setParams }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await scoringService.completeSet({
        sessionId: String(req.params.sessionId),
        setId: String(req.params.setId),
        actorUserId: req.user!.id,
      });

      res.status(200).json({ status: "ok", data });
    } catch (error) {
      handleError(error, next);
    }
  }
);

// PATCH /api/sessions/:sessionId/scores/:scoreId
router.patch(
  "/sessions/:sessionId/scores/:scoreId",
  authenticate,
  validateRequest({
    params: scoreParams,
    body: correctScoreBody,
  }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await scoringService.correctScore({
        sessionId: String(req.params.sessionId),
        scoreId: String(req.params.scoreId),
        points: req.body.points,
        reason: req.body.reason,
        actorUserId: req.user!.id,
      });

      res.status(200).json({ status: "ok", data });
    } catch (error) {
      handleError(error, next);
    }
  }
);

// GET /api/sessions/:sessionId/leaderboard
router.get(
  "/sessions/:sessionId/leaderboard",
  authenticate,
  validateRequest({ params: sessionParams }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await scoringService.getLeaderboard({
        sessionId: String(req.params.sessionId),
        actorUserId: req.user!.id,
      });

      res.status(200).json({ status: "ok", data });
    } catch (error) {
      handleError(error, next);
    }
  }
);

export default router;
