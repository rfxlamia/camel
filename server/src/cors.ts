import type { CorsOptions } from "cors";

export const DEFAULT_DEV_CORS_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://[::1]:5173",
];

type CorsOriginPolicyEnv = {
  corsOrigin?: string;
  nodeEnv?: string;
};

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, "");
}

export function allowedCorsOrigins(env: CorsOriginPolicyEnv = {
  corsOrigin: process.env.CORS_ORIGIN,
  nodeEnv: process.env.NODE_ENV,
}): string[] {
  if (env.corsOrigin) {
    return env.corsOrigin
      .split(",")
      .map(normalizeOrigin)
      .filter(Boolean);
  }

  if (env.nodeEnv === "production") {
    return [];
  }

  return DEFAULT_DEV_CORS_ORIGINS;
}

export function createCorsOriginPolicy(env?: CorsOriginPolicyEnv): (origin: string | undefined) => boolean {
  const origins = new Set(allowedCorsOrigins(env));

  return (origin) => {
    if (!origin) {
      return true;
    }

    return origins.has(normalizeOrigin(origin));
  };
}

export function createCorsOptions(env?: CorsOriginPolicyEnv): CorsOptions {
  const isAllowedOrigin = createCorsOriginPolicy(env);

  return {
    credentials: true,
    origin(origin, callback) {
      callback(null, isAllowedOrigin(origin));
    },
  };
}
