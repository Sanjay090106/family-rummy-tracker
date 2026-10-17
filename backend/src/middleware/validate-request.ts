import { Request, Response, NextFunction } from "express";
import { ZodError, ZodType } from "zod";

export interface RequestValidationSchemas {
  params?: ZodType;
  query?: ZodType;
  body?: ZodType;
}

export function validateRequest(schemas: RequestValidationSchemas) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (schemas.params) {
        const parsedParams = await schemas.params.parseAsync(req.params);
        try {
          req.params = parsedParams as any;
        } catch {
          Object.assign(req.params, parsedParams);
        }
      }

      if (schemas.query) {
        const parsedQuery = await schemas.query.parseAsync(req.query);
        try {
          req.query = parsedQuery as any;
        } catch {
          // In Express 5, req.query may be a getter on IncomingMessage
          // Modifying the query object in place or defining a property safely updates req.query
          try {
            Object.defineProperty(req, "query", {
              value: parsedQuery,
              writable: true,
              enumerable: true,
              configurable: true,
            });
          } catch {
            for (const key of Object.keys(req.query)) {
              delete (req.query as Record<string, unknown>)[key];
            }
            Object.assign(req.query, parsedQuery);
          }
        }
      }

      if (schemas.body) {
        const parsedBody = await schemas.body.parseAsync(req.body);
        req.body = parsedBody;
      }

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          status: "error",
          message: "Request validation failed",
          errors: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
            code: issue.code,
          })),
        });
        return;
      }

      next(error);
    }
  };
}
