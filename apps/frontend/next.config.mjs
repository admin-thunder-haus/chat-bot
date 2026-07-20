/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Enables `next dev` hot reload to work reliably inside a Docker bind mount.
  webpack: (config) => {
    config.watchOptions = {
      poll: 1000,
      aggregateTimeout: 300,
    };
    return config;
  },
};

export default nextConfig;
