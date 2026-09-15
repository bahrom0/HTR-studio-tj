import type { NextConfig } from 'next';
import path from 'node:path';
import { withWorkflow } from 'workflow/next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keep a running dev server isolated from production builds. Otherwise a
  // concurrent `next build` can replace .next while dev still serves old
  // manifests, which leads to missing chunk and text/plain 404 errors.
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  outputFileTracingRoot: path.resolve(__dirname),
  serverExternalPackages: ['sharp'],
  experimental: {
    // Keep prerender workers bounded in low-memory local and preview builds.
    cpus: 1,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default withWorkflow(nextConfig);
