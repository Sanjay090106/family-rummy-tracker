import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/authenticate";
import { validateRequest } from "../middleware/validate-request";
import { authorizeFamily } from "../middleware/authorize-family";
import { playerService } from "../services/player.service";

const router = Router();

const familyIdParamSchema = {
  params: z.object({
    familyId: z.string().uuid("Invalid family ID format"),
  }),
};

const createPlayerSchema = {
  params: z.object({
    familyId: z.string().uuid("Invalid family ID format"),
  }),
  body: z.object({
    membershipId: z.string().uuid("Invalid membership ID format"),
    displayName: z
      .string()
      .trim()
      .min(1, "Display name cannot be empty")
      .max(100, "Display name must be 100 characters or less"),
  }),
};

const updatePlayerSchema = {
  params: z.object({
    familyId: z.string().uuid("Invalid family ID format"),
    playerId: z.string().uuid("Invalid player ID format"),
  }),
  body: z
    .object({
      displayName: z
        .string()
        .trim()
        .min(1, "Display name cannot be empty")
        .max(100, "Display name must be 100 characters or less")
        .optional(),
      isActive: z.boolean().optional(),
    })
    .refine(
      (data) =>
        data.displayName !== undefined || data.isActive !== undefined,
      {
        message:
          "At least one of displayName or isActive must be provided",
      }
    ),
};

/**
 * GET /api/families/:familyId/players
 * Return players belonging to the requested family.
 */
router.get(
  "/families/:familyId/players",
  authenticate,
  validateRequest(familyIdParamSchema),
  authorizeFamily(),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const familyId = String(req.params.familyId);
      const players = await playerService.listPlayers(familyId, user.id);

      res.status(200).json({
        status: "ok",
        data: players,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/families/:familyId/players
 * Create a player linked to an eligible membership in the same family.
 */
router.post(
  "/families/:familyId/players",
  authenticate,
  validateRequest(createPlayerSchema),
  authorizeFamily(),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const familyId = String(req.params.familyId);
      const { membershipId, displayName } = req.body;

      const player = await playerService.createPlayer({
        familyId,
        membershipId,
        displayName,
        actorUserId: user.id,
      });

      res.status(201).json({
        status: "ok",
        data: player,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/families/:familyId/players/:playerId
 * Update a player belonging to the requested family.
 */
router.patch(
  "/families/:familyId/players/:playerId",
  authenticate,
  validateRequest(updatePlayerSchema),
  authorizeFamily(),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const familyId = String(req.params.familyId);
      const playerId = String(req.params.playerId);
      const { displayName, isActive } = req.body;

      const updatedPlayer = await playerService.updatePlayer({
        familyId,
        playerId,
        displayName,
        isActive,
        actorUserId: user.id,
      });

      res.status(200).json({
        status: "ok",
        data: updatedPlayer,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;