/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  async rewrites() {
    return [
      { source: "/api/:path*", destination: "http://localhost:31338/api/:path*" },
    ];
  },
};
