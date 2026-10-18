import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/authenticate";
import { validateRequest } from "../middleware/validate-request";
import { familyService } from "../services/family.service";
import { FamilyRole } from "../generated/prisma/enums";

const router = Router();

const memberParamsSchema = {
  params: z.object({
    familyId: z.string().uuid("Invalid family ID format"),
    membershipId: z.string().uuid("Invalid membership ID format"),
  }),
};

const updateRoleSchema = {
  params: z.object({
    familyId: z.string().uuid("Invalid family ID format"),
    membershipId: z.string().uuid("Invalid membership ID format"),
  }),
  body: z.object({
    role: z.nativeEnum(FamilyRole),
  }),
};

/**
 * PATCH /api/families/:familyId/members/:membershipId
 * Update a member's role, subject to ADMIN authorization.
 */
router.patch(
  "/families/:familyId/members/:membershipId",
  authenticate,
  validateRequest(updateRoleSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const familyId = String(req.params.familyId);
      const membershipId = String(req.params.membershipId);
      const role = req.body.role as FamilyRole;

      const updated = await familyService.updateMemberRole({
        familyId,
        targetMembershipId: membershipId,
        newRole: role,
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
 * POST /api/families/:familyId/members/:membershipId/leave
 * Allow authenticated member to leave their own membership.
 */
router.post(
  "/families/:familyId/members/:membershipId/leave",
  authenticate,
  validateRequest(memberParamsSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const familyId = String(req.params.familyId);
      const membershipId = String(req.params.membershipId);

      const updated = await familyService.leaveFamily({
        familyId,
        membershipId,
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

export default router;