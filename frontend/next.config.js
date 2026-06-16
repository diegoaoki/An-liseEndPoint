/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Gera um servidor mínimo (.next/standalone) para a imagem Docker.
  output: "standalone",
};

module.exports = nextConfig;
