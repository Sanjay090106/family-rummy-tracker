import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/authenticate";
import { validateRequest } from "../middleware/validate-request";
import { authorizeFamily } from "../middleware/authorize-family";
import { invitationService } from "../services/invitation.service";
import { FamilyRole, InvitationStatus } from "../generated/prisma/enums";

const router = Router();

// Validation Schemas
const createInvitationSchema = {
  params: z.object({
    familyId: z.string().uuid("Invalid family ID format"),
  }),
  body: z.object({
    email: z.string().trim().email("Invalid email address format").max(320),
  }),
};

const listInvitationsSchema = {
  params: z.object({
    familyId: z.string().uuid("Invalid family ID format"),
  }),
  query: z.object({
    status: z.nativeEnum(InvitationStatus).optional(),
  }),
};

const revokeInvitationSchema = {
  params: z.object({
    familyId: z.string().uuid("Invalid family ID format"),
    invitationId: z.string().uuid("Invalid invitation ID format"),
  }),
};

const acceptInvitationSchema = {
  params: z.object({
    token: z.string().min(1, "Invitation token is required"),
  }),
};

/**
 * POST /api/families/:familyId/invitations
 * Create and dispatch a family invitation. Admin only.
 */
router.post(
  "/families/:familyId/invitations",
  authenticate,
  validateRequest(createInvitationSchema),
  authorizeFamily(FamilyRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const familyId = String(req.params.familyId);
      const { email } = req.body;

      const invitation = await invitationService.createInvitation({
        familyId,
        email,
        actorUserId: user.id,
      });

      res.status(201).json({
        status: "ok",
        data: invitation,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/families/:familyId/invitations
 * List invitations for a family. Admin only.
 */
router.get(
  "/families/:familyId/invitations",
  authenticate,
  validateRequest(listInvitationsSchema),
  authorizeFamily(FamilyRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const familyId = String(req.params.familyId);
      const status = req.query.status as InvitationStatus | undefined;

      const invitations = await invitationService.listInvitations({
        familyId,
        status,
        actorUserId: user.id,
      });

      res.status(200).json({
        status: "ok",
        data: invitations,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/families/:familyId/invitations/:invitationId/revoke
 * Revoke an existing invitation. Admin only.
 */
router.post(
  "/families/:familyId/invitations/:invitationId/revoke",
  authenticate,
  validateRequest(revokeInvitationSchema),
  authorizeFamily(FamilyRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const familyId = String(req.params.familyId);
      const invitationId = String(req.params.invitationId);

      const revoked = await invitationService.revokeInvitation({
        familyId,
        invitationId,
        actorUserId: user.id,
      });

      res.status(200).json({
        status: "ok",
        data: revoked,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/invitations/:token/accept
 * Accept a family invitation using the raw token.
 * Authenticated user with verified email.
 */
router.post(
  "/invitations/:token/accept",
  authenticate,
  validateRequest(acceptInvitationSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const rawToken = String(req.params.token);

      const result = await invitationService.acceptInvitation({
        rawToken,
        user: {
          id: user.id,
          email: user.email,
          email_confirmed_at: user.email_confirmed_at,
        },
      });

      res.status(200).json({
        status: "ok",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
