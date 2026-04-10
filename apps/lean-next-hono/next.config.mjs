/** @type {import('next').NextConfig} */
const isBuild =
  process.argv.includes("build") ||
  process.env.npm_lifecycle_event === "build";

if (isBuild && !process.env.DATABASE_URL?.trim()) {
  process.env.DATABASE_URL =
    "mysql://127.0.0.1:65535/lean_next_hono_build_placeholder";
}
if (isBuild && !process.env.AUTH_SECRET?.trim()) {
  process.env.AUTH_SECRET =
    "build-placeholder-auth-secret-at-least-32-characters-long";
}
if (isBuild && !process.env.NEXTAUTH_SECRET?.trim()) {
  process.env.NEXTAUTH_SECRET = process.env.AUTH_SECRET;
}

const nextConfig = {};

export default nextConfig;
