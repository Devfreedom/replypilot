import type { NextConfig } from "next";

const DEFAULT_API_ORIGIN = "http://127.0.0.1:4000";

function resolveApiOrigin(rawOrigin: string | undefined): string {
  const trimmed = rawOrigin?.trim();

  if (!trimmed) {
    return DEFAULT_API_ORIGIN;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(
      `API_ORIGIN must be a valid http:// or https:// origin; received an invalid URL.`,
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `API_ORIGIN must use http:// or https://; received protocol "${parsed.protocol}".`,
    );
  }

  if (
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      "API_ORIGIN must be a bare origin (scheme, host, and optional port) without credentials, path, query, or fragment.",
    );
  }

  return parsed.origin;
}

const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://connect.facebook.net; connect-src 'self' https://graph.facebook.com https://*.resend.com; img-src 'self' data: blob: https://*.facebook.com; style-src 'self' 'unsafe-inline'; frame-src 'self' https://www.facebook.com; base-uri 'self'; object-src 'none';";

const nextConfig: NextConfig = {
  /* config options here */
  poweredByHeader: false,
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    proxyTimeout: 60_000,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value: CONTENT_SECURITY_POLICY,
          },
        ],
      },
    ];
  },
  async rewrites() {
    const apiOrigin = resolveApiOrigin(process.env.API_ORIGIN);

    return [
      {
        source: "/api/:path*",
        destination: `${apiOrigin}/api/:path*`,
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
