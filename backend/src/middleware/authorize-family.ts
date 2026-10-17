import { Request, Response, NextFunction } from "express";
import { prisma } from "../config/prisma";
import { FamilyRole, MembershipStatus } from "../generated/prisma/enums";

export interface FamilyMembershipContext {
  id: string;
  familyId: string;
  supabaseUserId: string;
  role: FamilyRole;
  status: MembershipStatus;
}

declare global {
  namespace Express {
    interface Request {
      familyMembership?: FamilyMembershipContext;
    }
  }
}

/**
 * Middleware to require an ACTIVE membership in the family specified by req.params.familyId.
 * Optionally checks if the active membership has a required role (e.g. ADMIN).
 */
export function authorizeFamily(requiredRole?: FamilyRole) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user;
      if (!user) {
        res.status(401).json({
          status: "error",
          message: "Authentication required",
        });
        return;
      }

      const param = req.params.familyId;
      const familyId = Array.isArray(param) ? param[0] : param;
      if (!familyId) {
        res.status(400).json({
          status: "error",
          message: "Family ID parameter is required",
        });
        return;
      }

      const membership = await prisma.familyMembership.findUnique({
        where: {
          familyId_supabaseUserId: {
            familyId,
            supabaseUserId: user.id,
          },
        },
      });

      if (!membership || membership.status !== MembershipStatus.ACTIVE) {
        res.status(403).json({
          status: "error",
          message: "Access denied: active family membership required",
        });
        return;
      }

      if (requiredRole && membership.role !== requiredRole) {
        res.status(403).json({
          status: "error",
          message: `Access denied: requires ${requiredRole} role in family`,
        });
        return;
      }

      req.familyMembership = {
        id: membership.id,
        familyId: membership.familyId,
        supabaseUserId: membership.supabaseUserId,
        role: membership.role,
        status: membership.status,
      };

      next();
    } catch (error) {
      next(error);
    }
  };
}
