import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/authenticate";
import { validateRequest } from "../middleware/validate-request";
import { authorizeFamily } from "../middleware/authorize-family";
import { sessionService, parseStrictCalendarDate } from "../services/session.service";
import { SessionStatus } from "../generated/prisma/enums";

const router = Router();

// Strict YYYY-MM-DD custom validation
const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "sessionDate must be in strict YYYY-MM-DD format")
  .refine(
    (val) => {
      try {
        parseStrictCalendarDate(val);
        return true;
      } catch {
        return false;
      }
    },
    { message: "sessionDate must be a valid real calendar date" }
  );

// Schemas
const familyIdParamSchema = {
  params: z.object({
    familyId: z.string().uuid("Invalid family ID format"),
  }),
};

const listSessionsSchema = {
  params: z.object({
    familyId: z.string().uuid("Invalid family ID format"),
  }),
  query: z.object({
    status: z.nativeEnum(SessionStatus).optional(),
  }),
};

const createSessionSchema = {
  params: z.object({
    familyId: z.string().uuid("Invalid family ID format"),
  }),
  body: z.object({
    sessionDate: dateStringSchema.optional(),
    playerIds: z
      .array(z.string().uuid("Invalid player ID format"))
      .min(1, "playerIds array must contain at least one player")
      .optional(),
  }),
};

const sessionIdParamSchema = {
  params: z.object({
    sessionId: z.string().uuid("Invalid session ID format"),
  }),
};

const updateSessionSchema = {
  params: z.object({
    sessionId: z.string().uuid("Invalid session ID format"),
  }),
  body: z.object({
    sessionDate: dateStringSchema,
  }),
};

const addParticipantsSchema = {
  params: z.object({
    sessionId: z.string().uuid("Invalid session ID format"),
  }),
  body: z.object({
    playerIds: z
      .array(z.string().uuid("Invalid player ID format"))
      .min(1, "playerIds must contain at least one player ID"),
  }),
};

/**
 * 1. GET /api/families/:familyId/sessions
 * List sessions belonging to the specified family.
 */
router.get(
  "/families/:familyId/sessions",
  authenticate,
  validateRequest(listSessionsSchema),
  authorizeFamily(),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const familyId = String(req.params.familyId);
      const status = req.query.status as SessionStatus | undefined;

      const sessions = await sessionService.listSessions({
        familyId,
        status,
        actorUserId: user.id,
      });

      res.status(200).json({
        status: "ok",
        data: sessions,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * 2. POST /api/families/:familyId/sessions
 * Create a session for the specified family.
 */
router.post(
  "/families/:familyId/sessions",
  authenticate,
  validateRequest(createSessionSchema),
  authorizeFamily(),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const familyId = String(req.params.familyId);
      const { sessionDate, playerIds } = req.body;

      const session = await sessionService.createSession({
        familyId,
        sessionDate,
        playerIds,
        actorUserId: user.id,
      });

      res.status(201).json({
        status: "ok",
        data: session,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * 3. GET /api/sessions/:sessionId
 * Retrieve session details and participants.
 */
router.get(
  "/sessions/:sessionId",
  authenticate,
  validateRequest(sessionIdParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const sessionId = String(req.params.sessionId);

      const session = await sessionService.getSession({
        sessionId,
        actorUserId: user.id,
      });

      res.status(200).json({
        status: "ok",
        data: session,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * 4. PATCH /api/sessions/:sessionId
 * Update mutable session details (sessionDate). Only while IN_PROGRESS.
 */
router.patch(
  "/sessions/:sessionId",
  authenticate,
  validateRequest(updateSessionSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const sessionId = String(req.params.sessionId);
      const { sessionDate } = req.body;

      const updated = await sessionService.updateSession({
        sessionId,
        sessionDate,
        actorUserId: user.id,
      });

      res.status(200).json({
        status: "ok",
        data: updated,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * 5. POST /api/sessions/:sessionId/participants
 * Add one or more participants to an in-progress session.
 */
router.post(
  "/sessions/:sessionId/participants",
  authenticate,
  validateRequest(addParticipantsSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const sessionId = String(req.params.sessionId);
      const { playerIds } = req.body;

      const participants = await sessionService.addParticipants({
        sessionId,
        playerIds,
        actorUserId: user.id,
      });

      res.status(201).json({
        status: "ok",
        data: participants,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * 6. POST /api/sessions/:sessionId/complete
 * Transition session from IN_PROGRESS to COMPLETED.
 */
router.post(
  "/sessions/:sessionId/complete",
  authenticate,
  validateRequest(sessionIdParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const sessionId = String(req.params.sessionId);

      const completed = await sessionService.completeSession({
        sessionId,
        actorUserId: user.id,
      });

      res.status(200).json({
        status: "ok",
        data: completed,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * 7. POST /api/sessions/:sessionId/cancel
 * Transition session from IN_PROGRESS to CANCELLED.
 */
router.post(
  "/sessions/:sessionId/cancel",
  authenticate,
  validateRequest(sessionIdParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const sessionId = String(req.params.sessionId);

      const cancelled = await sessionService.cancelSession({
        sessionId,
        actorUserId: user.id,
      });

      res.status(200).json({
        status: "ok",
        data: cancelled,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
