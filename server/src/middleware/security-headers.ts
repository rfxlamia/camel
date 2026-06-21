import type { Request, Response, NextFunction } from "express";

export interface SecurityHeadersOptions {
	enableHSTS?: boolean;
	enableCSP?: boolean;
	enableXSSProtection?: boolean;
	enableFrameOptions?: boolean;
	enableContentTypeOptions?: boolean;
	enableReferrerPolicy?: boolean;
	enablePermissionsPolicy?: boolean;
}

export function securityHeaders(options: SecurityHeadersOptions = {}) {
	const {
		enableHSTS = true,
		enableCSP = true,
		enableXSSProtection = true,
		enableFrameOptions = true,
		enableContentTypeOptions = true,
		enableReferrerPolicy = true,
		enablePermissionsPolicy = true,
	} = options;

	return (req: Request, res: Response, next: NextFunction): void => {
		if (enableContentTypeOptions) {
			res.setHeader("X-Content-Type-Options", "nosniff");
		}

		if (enableFrameOptions) {
			res.setHeader("X-Frame-Options", "DENY");
		}

		if (enableHSTS && process.env.NODE_ENV === "production") {
			res.setHeader(
				"Strict-Transport-Security",
				"max-age=31536000; includeSubDomains; preload",
			);
		}

		if (enableCSP) {
			const csp = [
				"default-src 'self'",
				"script-src 'self' 'unsafe-inline' 'unsafe-eval'",
				"style-src 'self' 'unsafe-inline'",
				"img-src 'self' data: blob:",
				"font-src 'self'",
				"connect-src 'self'",
				"frame-ancestors 'none'",
				"base-uri 'self'",
				"form-action 'self'",
			].join("; ");

			res.setHeader("Content-Security-Policy", csp);
		}

		if (enableXSSProtection) {
			res.setHeader("X-XSS-Protection", "0");
		}

		if (enableReferrerPolicy) {
			res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
		}

		if (enablePermissionsPolicy) {
			res.setHeader(
				"Permissions-Policy",
				"camera=(), microphone=(), geolocation=(), interest-cohort=()",
			);
		}

		next();
	};
}
