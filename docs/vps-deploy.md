# Produção na VPS

Endereço: **scale.nexushosts.tech** (sem porta; `http://` redireciona para
`https://`). O endereço antigo `https://scale.nexushosts.tech:8443` continua
funcionando para links antigos.

| Item | Valor |
|---|---|
| VPS | `187.41.116.22` (Ubuntu 26.04 LTS), compartilhada com o Nexus |
| Usuário | `scale` (grupo `docker`, sem sudo), login por chave SSH |
| Pasta | `/opt/scale` (`.env` com permissão 600, nunca versionado) |
| Commit em produção | `cat /opt/scale/.deployed-commit` |

## Arquitetura

```
cliente --HTTPS:443--> Caddy do Nexus (172.28.0.7) --+
cliente --HTTPS:8443-> edge (172.28.0.6) ------------+--> proxy :8080 (172.28.0.4) --> backend :4000
```

- As portas 80/443 da VPS são do Caddy do **Nexus** (`/opt/manga-engine`,
  usuário `nexus`). Ele atende também `scale.nexushosts.tech` e repassa para o
  proxy do Scale pela rede `scale_scale`, onde entra com o IP fixo
  **172.28.0.7** (confiado no `Caddyfile` e no `TRUST_PROXY`). Ver
  "Endereço sem porta" abaixo.
- O `edge` do Scale continua na **8443** (links antigos).
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

## Endereço sem porta (Caddy do Nexus)

O Scale não pode abrir as portas 80/443 (são do Nexus). Quem atende
`scale.nexushosts.tech` nelas é o Caddy do Nexus, com certificado próprio
(Let's Encrypt automático, já que ele tem a 80/443) e redirecionamento
`http -> https`. Mudanças, feitas como usuário `nexus` em `/opt/manga-engine`
(e no repositório do Nexus, para não se perderem no próximo deploy dele):

1. `deploy/Caddyfile`, novo bloco:
   ```
   scale.nexushosts.tech {
   	encode zstd gzip
   	header Strict-Transport-Security "max-age=31536000"
   	reverse_proxy 172.28.0.4:8080
   }
   ```
   Sem `trusted_proxies`: o Caddy do Nexus descarta qualquer `X-Forwarded-For`
   de fora e grava o IP real do cliente.
2. `docker-compose.caddy.yml`, no serviço `caddy`:
   ```yaml
       networks:
         default: {}
         scale:
           ipv4_address: 172.28.0.7
   ```
   e no fim do arquivo:
   ```yaml
   networks:
     scale:
       name: scale_scale
       external: true
   ```
3. `docker compose -f docker-compose.caddy.yml up -d caddy`.

Cuidados: a rede `scale_scale` precisa existir para o Caddy do Nexus subir
(o `deploy.sh` do Scale só faz `up`, nunca `down`). Se o Scale estiver fora do
ar, só `scale.nexushosts.tech` dá 502; o Nexus segue normal.

No `/opt/scale/.env` do Scale:
```
PUBLIC_URL=https://scale.nexushosts.tech
ALLOWED_ORIGINS=https://scale.nexushosts.tech,https://scale.nexushosts.tech:8443
```
e o callback do OAuth App do GitHub passa a ser
`https://scale.nexushosts.tech/api/auth/github/callback`.

## Login com GitHub

1. Em https://github.com/settings/developers, crie um **OAuth App**:
   - Homepage URL: `https://scale.nexushosts.tech`
   - Authorization callback URL: `https://scale.nexushosts.tech/api/auth/github/callback`
2. Gere um client secret.
3. Na VPS, edite `/opt/scale/.env` (não cole o secret em chat nem no Git):
   ```
   GITHUB_CLIENT_ID=<client id>
   GITHUB_CLIENT_SECRET=<client secret>
   PUBLIC_URL=https://scale.nexushosts.tech
   ```
4. Rode `./deploy/deploy.sh`. O botão "Entrar com GitHub" aparece no login.

## Backup e restauração

O script produz **um arquivo conjunto** `backups/backup-AAAAMMDD-HHMMSS-PID.tar.gz`,
com `db_data/data.db` e `uploads_data/`. Usa a API de backup online SQLite
(Python 3.12 em container auxiliar), inclui WAL confirmado e verifica `quick_check`.
Copia apenas anexos e avatares imutáveis referenciados nesse snapshot; não para
nem reinicia o backend. Exclusão concorrente de anexo/avatares cancela a cópia:
nenhum arquivo parcial é publicado e a retenção só roda após sucesso. Nesse caso,
repita o backup após a exclusão; um arquivo já ausente exige investigar o volume.

Comandos para revisão e uso operacional pelo responsável:

```bash
./deploy/backup.sh
KEEP_DAYS=14 MAX_BACKUPS=30 ./deploy/backup.sh
python3 -B -m unittest discover -s deploy -p test_backup.py -v
```

`KEEP_DAYS` vale 14 e `MAX_BACKUPS` vale 30 por padrão; o máximo precisa ser
pelo menos `KEEP_DAYS + 1`. A retenção protege o snapshot mais recente de cada
dia existente na janela, limita cópias extras pela quantidade e preserva sempre
o último backup. Isso não cria pontos de recuperação nos dias sem execução.
Os pares legados `db_data-*`/`uploads_data-*` continuam válidos no formato antigo:
são preservados durante a janela e só removidos por idade depois de um backup
novo bem-sucedido. O teto de quantidade aplica-se aos arquivos conjuntos novos.
Backups completos continuam consumindo I/O proporcional aos dados; não há
deduplicação/incremental. O helper informa tamanho comprimido e duração no log. A compressão gzip
é sem perdas, nível 1 por padrão para economizar CPU;
`BACKUP_COMPRESSION_LEVEL=1..9` permite calibrar após medição.
O host precisa de `flock` (util-linux) e Docker; volumes de origem são montados
somente para leitura. O lock impede backup simultâneo por cron e deploy.

Cron diário sugerido (`crontab -e` como `scale`; crie `backups/` com modo 700 antes):

```cron
0 3 * * * cd /opt/scale && ./deploy/backup.sh >> backups/backup.log 2>&1
```

Primeiro valide a restauração em **volumes novos de ensaio**, sem substituir os
volumes em uso. O exemplo abaixo cria somente `scale_restore_*` e contém um
nome de arquivo ilustrativo que deve ser substituído pelo snapshot escolhido:

```bash
docker volume create scale_restore_db
docker volume create scale_restore_uploads
docker run --rm -v scale_restore_db:/d -v scale_restore_uploads:/u \
  -v "$PWD/backups:/in:ro" python:3.12-alpine sh -ec '
  mkdir /restore
  tar -xzf /in/backup-AAAAMMDD-HHMMSS-PID.tar.gz -C /restore
  cp /restore/db_data/data.db /d/data.db
  if [ -d /restore/uploads_data ]; then cp -a /restore/uploads_data/. /u/; fi
  python -c "import sqlite3; c=sqlite3.connect(\"/d/data.db\"); assert c.execute(\"PRAGMA integrity_check\").fetchall()==[(\"ok\",)]"
  chown -R 1001:1001 /d /u'
```

Valide também os anexos, avatares, usuários e salas nessa instância de ensaio.
Uma restauração em produção requer janela própria, backend parado e troca dos
volumes aprovada pelo responsável. Nunca misture um banco de um snapshot com
anexos de outro. Os snapshots não contêm `.env`, segredos JWT/cookies ou os
certificados; preserve essas configurações separadamente de forma segura e
copie os backups para fora da VPS (`scp`/`rclone`).

## TURN e observabilidade da VPS

`TURN_URL`, `TURN_USERNAME` e `TURN_CREDENTIAL` continuam suportados para
provedores com credencial estática. `TURN_SECRET` habilita credenciais HMAC
SHA1 temporárias (validade em `TURN_TTL_SECONDS`), no padrão REST do coturn:
o serviço `coturn` do Compose (perfil `turn`) já sobe com `use-auth-secret` e o
mesmo segredo. Um relay externo precisa da mesma configuração.

`GET /api/turn/credentials?roomId=<uuid>` aceita convidados somente com
`X-Room-Ticket` válido de uma sala ativa em que entraram. Login continua
compatível. A resposta privada não admite cache e informa `expiresAt`/`ttlSeconds`
no modo temporário; o cliente renova antes do prazo e atualiza o ICE dos peers.
Ticket de sala tem validade própria de 12 horas, já existente; não é token de
sessão. Custos/banda e testes de relay real continuam dependendo do provedor.

`GET /api/metrics` exige administrador e expõe RSS/heap, CPU acumulada,
latência do event loop (janela de até 60 s), capacidade/livre do filesystem dos
uploads e bytes de anexos **referenciados no banco**, inclusive soft deletes.
Esse último valor não inclui avatares nem órfãos; o contador histórico de upload
continua acumulado desde o boot. As métricas não prometem capacidade da VPS.
Logs Docker têm rotação de 10 MB por arquivo, três arquivos por serviço;
limites de CPU/RAM, imagens pré-compiladas em CI e migração explícita de banco
permanecem pendentes de medição/planejamento operacional. O boot ainda usa o
`prisma db push` existente; esta entrega não o executa em produção.

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
