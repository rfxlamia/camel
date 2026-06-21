import type { Request, Response, NextFunction } from 'express';

const SENSITIVE_PATTERNS = [
  /\b(relation|table|column|constraint|index)\s+"[^"]+"\s+(does not exist|already exists)\b/i,
  /\b(pg_|mysql|sqlite|oracle|sql server)\b/i,
  /\b(sequelize|prisma|typeorm|knex)\b/i,
  /\b(ENOENT|EACCES|EPERM|EBUSY|EEXIST)\b/,
  /\b(open|read|write|unlink|rename|mkdir)\s+.*\/(etc|var|usr|tmp)/i,
  /\b(ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND)\b/,
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?\b/,
  /\bat\s+.*\(.*:\d+:\d+\)/,
  /\bat\s+.*\.js:\d+:\d+/,
  /\b[A-Z_]+=\S+/,
  /\b(secret|password|token|key|api_key)\s*[:=]\s*\S+/i,
];

const SAFE_ERROR_PATTERNS = [
  /^(username|password|email|name)\s+(must|is|cannot|should)\b/i,
  /\b(required|invalid|too (long|short|many|few))\b/i,
  /\b(already (taken|exists|registered))\b/i,
  /\b(not found|forbidden|unauthorized)\b/i,
  /\b(version conflict)\b/i,
];

export interface SanitizedError {
  message: string;
  statusCode: number;
  code?: string;
}

export function sanitizeError(error: Error & { statusCode?: number; code?: string }): SanitizedError {
  const statusCode = error.statusCode ?? 0;
  const originalMessage = error.message || '';

  const looksSensitive = SENSITIVE_PATTERNS.some((p) => p.test(originalMessage));
  const isSafe = !looksSensitive && SAFE_ERROR_PATTERNS.some((p) => p.test(originalMessage));

  if (isSafe) {
    return {
      message: originalMessage,
      statusCode: statusCode >= 400 && statusCode < 500 ? statusCode : 400,
      code: error.code,
    };
  }

  return {
    message: 'internal server error',
    statusCode: 500,
    code: 'INTERNAL_ERROR',
  };
}

export function createErrorHandler() {
  return (
    err: Error & { statusCode?: number; code?: string },
    req: Request,
    res: Response,
    _next: NextFunction
  ): void => {
    console.error('Error:', {
      message: err.message,
      stack: err.stack,
      statusCode: err.statusCode,
      code: err.code,
      path: req.path,
      method: req.method,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    const sanitized = sanitizeError(err);

    res.status(sanitized.statusCode).json({
      error: sanitized.message,
      ...(process.env.NODE_ENV === 'development' && { code: sanitized.code }),
    });
  };
}
