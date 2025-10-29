/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      {
        source: '/book',
        destination: '/consult',
        permanent: true,
      },
    ];
  },
};

module.exports = nextConfig;
