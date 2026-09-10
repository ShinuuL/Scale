/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  env: {
    NEXT_PUBLIC_BACKEND_URL: process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:4000',
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:4000',
    // Host Tailscale (ex.: desktop-xxxx.tail-xxxx.ts.net) usado para gerar o
    // link HTTPS do banner de conexão insegura. Vazio = banner mostra guia.
    NEXT_PUBLIC_TAILSCALE_HOST: process.env.NEXT_PUBLIC_TAILSCALE_HOST || process.env.TAILSCALE_HOST || '',
    NEXT_PUBLIC_HTTPS_PORT: process.env.NEXT_PUBLIC_HTTPS_PORT || process.env.HTTPS_PORT || '3443',
  },
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://backend:4000';
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
