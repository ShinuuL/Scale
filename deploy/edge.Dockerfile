# Caddy de borda com o modulo DNS-01 via acme-dns (caddy-dns/acmedns).
# Necessario porque na VPS as portas 80/443 pertencem a outro projeto: o
# certificado e emitido pelo desafio DNS, sem HTTP-01 nem TLS-ALPN.
FROM caddy:2.10.2-builder-alpine AS builder
RUN xcaddy build --with github.com/caddy-dns/acmedns

FROM caddy:2.10.2-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
