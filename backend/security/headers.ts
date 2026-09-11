/** Security headers, in one place. */

export interface HeaderOptions {
  /** Nonce for inline scripts, where the deployment supplies one. */
  nonce?: string;
  /** HSTS is meaningless over plain HTTP and harmful in local development. */
  https?: boolean;
}

const TILE_HOSTS = [
  "https://server.arcgisonline.com",
  // Both forms are needed.
  "https://tile.openstreetmap.org",
  "https://*.tile.openstreetmap.org",
  "https://bhuvan-vec1.nrsc.gov.in",
  "https://bhuvan-ras2.nrsc.gov.in",
];

export function contentSecurityPolicy({ nonce }: HeaderOptions = {}): string {
  const scriptSrc = ["'self'", nonce ? `'nonce-${nonce}'` : "'unsafe-inline'", "'unsafe-eval'"];
  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${TILE_HOSTS.join(" ")}`,
    `connect-src 'self' ${TILE_HOSTS.join(" ")}`,
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function securityHeaders(options: HeaderOptions = {}): Record<string, string> {
  return {
    "Content-Security-Policy": contentSecurityPolicy(options),
    // Legacy equivalent of frame-ancestors, for older proxies.
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    // The field app needs the camera and GPS; nothing else does.
    "Permissions-Policy": "geolocation=(self), camera=(self), microphone=(), payment=(), interest-cohort=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "X-DNS-Prefetch-Control": "off",
    ...(options.https ? { "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload" } : {}),
  };
}
