/** @type {import('next').NextConfig} */
const backend = (process.env.BACKEND_INTERNAL_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

const nextConfig = {
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" } : {}),
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backend}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
