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

	return (_req: Request, res: Response, next: NextFunction): void => {
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
			const isProduction = process.env.NODE_ENV === "production";

			// In production, remove unsafe-inline from script-src for better XSS protection
			// Keep unsafe-inline for style-src (CSS-in-JS compatibility)
			const scriptSrc = isProduction
				? "script-src 'self'"
				: "script-src 'self' 'unsafe-inline'";

			const csp = [
				"default-src 'self'",
				scriptSrc,
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
