import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/authenticate";
import { validateRequest } from "../middleware/validate-request";
import { authorizeFamily } from "../middleware/authorize-family";
import { familyService } from "../services/family.service";

const router = Router();

// Zod schemas
const createFamilySchema = {
  body: z.object({
    name: z
      .string()
      .trim()
      .min(1, "Family name cannot be empty")
      .max(100, "Family name must be 100 characters or less"),
  }),
};

const familyIdParamSchema = {
  params: z.object({
    familyId: z.string().uuid("Invalid family ID format"),
  }),
};

/**
 * GET /api/families
 * List families where authenticated user has an ACTIVE membership.
 */
router.get(
  "/",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const families = await familyService.listUserFamilies(user.id);

      res.status(200).json({
        status: "ok",
        data: families,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/families
 * Create family and creator's initial ADMIN membership atomically.
 */
router.post(
  "/",
  authenticate,
  validateRequest(createFamilySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const email = user.email || "";

      if (!email) {
        res.status(400).json({
          status: "error",
          message: "User must have a verified email to create a family",
        });
        return;
      }

      const family = await familyService.createFamily({
        name: req.body.name,
        supabaseUserId: user.id,
        email,
      });

      res.status(201).json({
        status: "ok",
        data: family,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/families/:familyId
 * Return family details only to an active member.
 */
router.get(
  "/:familyId",
  authenticate,
  validateRequest(familyIdParamSchema),
  authorizeFamily(),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const familyId = String(req.params.familyId);
      const family = await familyService.getFamilyById(familyId, user.id);

      res.status(200).json({
        status: "ok",
        data: family,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/families/:familyId/members
 * List active family members only to active members.
 */
router.get(
  "/:familyId/members",
  authenticate,
  validateRequest(familyIdParamSchema),
  authorizeFamily(),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const familyId = String(req.params.familyId);
      const members = await familyService.listActiveMembers(familyId, user.id);

      res.status(200).json({
        status: "ok",
        data: members,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
