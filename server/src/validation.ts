import { z } from "zod";

const requiredTitle = z.string().trim().min(1, "title is required");
const optionalTitle = z.string().trim().min(1, "title cannot be empty").optional();
const description = z.string();
const integerId = z.number().int();
const nonNegativeIndex = z.number().int().nonnegative();
const version = z.number().int().optional();

export const cardCreateBodySchema = z.object({
  columnId: integerId,
  title: requiredTitle,
  description: description.optional().default(""),
});

export const cardUpdateBodySchema = z.object({
  title: optionalTitle,
  description: description.optional(),
  version,
});

export const cardMoveBodySchema = z.object({
  toColumnId: integerId,
  index: nonNegativeIndex,
  version,
});

export type CardCreateBody = z.infer<typeof cardCreateBodySchema>;
export type CardUpdateBody = z.infer<typeof cardUpdateBodySchema>;
export type CardMoveBody = z.infer<typeof cardMoveBodySchema>;

type ValidationIssue = {
  path: string;
  message: string;
  code: string;
};

type ValidationErrorBody = {
  error: "Invalid request";
  issues: ValidationIssue[];
};

export type RequestValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: 400; body: ValidationErrorBody };

function formatPath(path: PropertyKey[]): string {
  return path.length > 0 ? path.map(String).join(".") : "body";
}

export function validateRequestBody<T>(
  schema: z.ZodType<T>,
  body: unknown,
): RequestValidationResult<T> {
  const result = schema.safeParse(body ?? {});
  if (result.success) {
    return { ok: true, data: result.data };
  }

  return {
    ok: false,
    status: 400,
    body: {
      error: "Invalid request",
      issues: result.error.issues.map((issue) => ({
        path: formatPath(issue.path),
        message: issue.message,
        code: issue.code,
      })),
    },
  };
}
