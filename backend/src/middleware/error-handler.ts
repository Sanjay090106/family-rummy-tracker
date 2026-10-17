import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";

export interface AppErrorResponse {
  status: "error";
  message: string;
  errors?: Array<{ path: string; message: string; code?: string }>;
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (res.headersSent) {
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      status: "error",
      message: "Request validation failed",
      errors: err.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
        code: issue.code,
      })),
    });
    return;
  }

  // Handle SyntaxError from malformed JSON bodies
  if (
    err instanceof SyntaxError &&
    "status" in err &&
    (err as { status?: number }).status === 400 &&
    "body" in err
  ) {
    res.status(400).json({
      status: "error",
      message: "Malformed JSON payload in request body",
    });
    return;
  }

  // Check custom or standard status property if present
  const maybeStatus = typeof (err as any)?.statusCode === "number"
    ? (err as any).statusCode
    : typeof (err as any)?.status === "number" && (err as any).status >= 400 && (err as any).status < 600
    ? (err as any).status
    : 500;

  // Log error message internally without leaking stack trace or db details to client
  const errorMessage = err instanceof Error ? err.message : "Internal Server Error";
  console.error("Unhandled API error:", errorMessage);

  if (maybeStatus >= 500) {
    res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
    return;
  }

  res.status(maybeStatus).json({
    status: "error",
    message: errorMessage,
  });
}
