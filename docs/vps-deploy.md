# Produção na VPS

Endereço: **https://scale.nexushosts.tech:8443**

| Item | Valor |
|---|---|
| VPS | `187.41.116.22` (Ubuntu 26.04 LTS), compartilhada com o Nexus |
| Usuário | `scale` (grupo `docker`, sem sudo), login por chave SSH |
| Pasta | `/opt/scale` (`.env` com permissão 600, nunca versionado) |
| Commit em produção | `cat /opt/scale/.deployed-commit` |

## Arquitetura

```
cliente --HTTPS:8443--> edge (172.28.0.6) --> proxy :8080 (172.28.0.4) --> backend :4000
```

- As portas 80/443 da VPS são do Caddy do **Nexus**. O Scale tem um Caddy
  próprio (`edge`) só na **8443** e não toca no Nexus.
- O certificado (Let's Encrypt) sai por **DNS-01 delegado ao acme-dns**, sem
  usar as portas 80/443:
  - `A      scale                  -> 187.41.116.22`
  - `CNAME  _acme-challenge.scale  -> <subdominio>.auth.acme-dns.io`
  - As credenciais do acme-dns (`ACMEDNS_*` no `.env`) só gravam esse TXT. A
    renovação (a cada ~60 dias) depende de `auth.acme-dns.io` estar no ar.
- Imagem do `edge`: `deploy/edge.Dockerfile` (Caddy + `caddy-dns/acmedns`).
- Backend e proxy ficam só no loopback da VPS (4100 e 8080).

Arquivos: `docker-compose.prod.yml`, `deploy/Caddyfile.edge`,
`deploy/edge.Dockerfile`, `deploy/.env.production.example`, `deploy/deploy.sh`,
`deploy/backup.sh`, `deploy/enviar.ps1`.

## Atualizar a produção (do seu PC)

Regra: **produção = commit**. O script recusa enviar com alterações não commitadas.

```powershell
git add . ; git commit -m "feat: ..." ; git push
.\deploy\enviar.ps1              # envia o HEAD e roda o deploy (backup automático antes)
.\deploy\enviar.ps1 -SemDeploy   # só envia o código
```

O `enviar.ps1` usa `git archive HEAD`, extrai em `/opt/scale` e chama o
`deploy/deploy.sh`, que valida o `.env`, faz backup, rebuilda e espera tudo
ficar healthy. Arquivos apagados no repositório não são removidos da VPS (não
afetam o build, que só usa os caminhos dos Dockerfiles).

## Comandos na VPS

```bash
ssh scale@187.41.116.22
cd /opt/scale
alias dc='docker compose -f docker-compose.yml -f docker-compose.prod.yml'

./deploy/deploy.sh                    # rebuild + up (após mudar o .env, por exemplo)
dc ps                                 # status dos serviços
dc logs -f backend                    # logs do backend
dc logs edge | grep -i certificate    # emissão/renovação do certificado
dc restart backend                    # reinicia (zera os rate limits, que ficam em memória)
curl -s http://127.0.0.1:4100/health  # backend direto
cat .deployed-commit                  # commit em produção
```

Editar configuração (admins, TURN...): `nano /opt/scale/.env` e depois `./deploy/deploy.sh`.

## Backup e restauração

```bash
./deploy/backup.sh     # backups/db_data-*.tar.gz e backups/uploads_data-*.tar.gz (retém 14 dias)
```

Cron diário sugerido (`crontab -e` como `scale`):

```cron
0 3 * * * cd /opt/scale && ./deploy/backup.sh >> backups/backup.log 2>&1
```

Restaurar (troque o carimbo de data):

```bash
dc stop backend
docker run --rm -v scale_db_data:/d -v scale_uploads_data:/u -v "$PWD/backups:/in" alpine sh -c \
  'rm -rf /d/* /u/* && tar -xzf /in/db_data-AAAAMMDD-HHMMSS.tar.gz -C /d \
   && tar -xzf /in/uploads_data-AAAAMMDD-HHMMSS.tar.gz -C /u && chown -R 1001:1001 /d /u'
dc start backend
```

Copie os backups para fora da VPS (`scp`/`rclone`).

## Instalação do zero (outra VPS)

1. Docker + Compose v2.24+; usuário `scale` no grupo `docker` com chave SSH;
   `install -d -m 750 -o scale -g scale /opt/scale`.
2. DNS: registro `A` do subdomínio para o IP da VPS.
3. acme-dns: na VPS, `curl -s -X POST https://auth.acme-dns.io/register` e crie
   o `CNAME _acme-challenge.<sub>` para o `fulldomain` retornado.
4. `.env`: copie `deploy/.env.production.example`, preencha domínio,
   `ALLOWED_ORIGINS=https://<dominio>:8443`, `ACMEDNS_*` e segredos novos
   (`openssl rand -hex 32`); `chmod 600 .env`.
5. Do PC: `.\deploy\enviar.ps1 -Servidor scale@<ip>`.
6. Firewall (opcional, o Docker publica por fora do UFW):
   `sudo ufw allow 8443/tcp && sudo ufw allow 8443/udp`.

## Problemas conhecidos

- **`$'\r': command not found`**: arquivo com CRLF. O `.gitattributes` força LF
  e o `enviar.ps1` envia pelo Git. Para corrigir na mão: `sed -i 's/\r$//' arquivo`.
- **"Too many login attempts"**: rate limit por IP, em memória. Espere a janela
  ou rode `dc restart backend`.
- **Certificado não sai** ("timed out waiting for record to fully propagate"):
  confira o CNAME com `nslookup -type=TXT _acme-challenge.<dominio> 1.1.1.1`. O
  `Caddyfile.edge` usa espera fixa (`propagation_delay 30s`) porque a checagem
  do Caddy não segue o CNAME.

## Segurança

- `.env` com permissão 600, fora do Git; segredos únicos por instalação.
- Não apague o volume `scale_edge_data` (certificados; rate limit do Let's Encrypt).
- IP real: o `edge` não confia em `X-Forwarded-For` de entrada; o Caddy interno
  confia só em `172.28.0.6`; o backend usa `TRUST_PROXY=172.28.0.4/32,172.28.0.6/32`.
- Teste (2026-11-03, aprovado): 15 logins com `X-Forwarded-For` rotativo, o 11º
  dá 429 e o log mostra o IP público real.
