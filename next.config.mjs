// next.config.mjs
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: { typedRoutes: true },
  // runtimeNode par défaut : pas besoin de config spéciale pour xlsx
};
export default nextConfig;
