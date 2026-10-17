import { Request, Response, NextFunction } from "express";
import { User } from "@supabase/supabase-js";
import { getSupabaseClient } from "../config/supabase";

export interface AuthenticatedUser {
  id: string;
  email?: string;
  email_confirmed_at?: string | null;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
  aud?: string;
  role?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({
      status: "error",
      message: "Authorization header is missing",
    });
    return;
  }

  const trimmedHeader = authHeader.trim();

  // If header is exactly "Bearer" without token (or trimmed by HTTP parser)
  if (trimmedHeader.toLowerCase() === "bearer") {
    res.status(401).json({
      status: "error",
      message: "Bearer token is missing",
    });
    return;
  }

  const spaceIndex = trimmedHeader.indexOf(" ");
  if (spaceIndex === -1) {
    res.status(401).json({
      status: "error",
      message: "Authorization header must use Bearer scheme",
    });
    return;
  }

  const scheme = trimmedHeader.slice(0, spaceIndex).trim();
  const token = trimmedHeader.slice(spaceIndex + 1).trim();

  if (scheme.toLowerCase() !== "bearer") {
    res.status(401).json({
      status: "error",
      message: "Authorization header must use Bearer scheme",
    });
    return;
  }

  if (!token) {
    res.status(401).json({
      status: "error",
      message: "Bearer token is missing",
    });
    return;
  }

  try {
    const supabaseClient = getSupabaseClient();
    const { data, error } = await supabaseClient.auth.getUser(token);

    if (error || !data.user) {
      res.status(401).json({
        status: "error",
        message: "Invalid or expired authentication token",
      });
      return;
    }

    const user: User = data.user;
    req.user = {
      id: user.id,
      email: user.email,
      email_confirmed_at: user.email_confirmed_at,
      app_metadata: user.app_metadata,
      user_metadata: user.user_metadata,
      aud: user.aud,
      role: user.role,
    };

    next();
  } catch (error) {
    next(error);
  }
}
