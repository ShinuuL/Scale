<#
.SYNOPSIS
  Envia o commit atual (HEAD) para a VPS e roda o deploy.

.DESCRIPTION
  Producao = commit: usa `git archive HEAD` (so arquivos versionados, com as
  quebras de linha do .gitattributes), extrai em /opt/scale e grava o hash em
  /opt/scale/.deployed-commit. Nunca envia o .env (nao e versionado).
  Recusa enviar com alteracoes nao commitadas, para a VPS nao rodar codigo
  que nao esta no repositorio.

.EXAMPLE
  .\deploy\enviar.ps1
  .\deploy\enviar.ps1 -SemDeploy      # so envia o codigo
#>
param(
  [string]$Servidor = 'scale@187.41.116.22',
  [string]$Pasta = '/opt/scale',
  [switch]$SemDeploy
)
# 'Continue' (nao 'Stop'): no PowerShell 5.1 o stderr de comando nativo (o
# Docker escreve o progresso do build la) viraria erro fatal. As falhas sao
# detectadas por $LASTEXITCODE apos cada comando.
$ErrorActionPreference = 'Continue'
Set-Location (Split-Path $PSScriptRoot -Parent)

if (git status --porcelain) {
  throw 'Ha alteracoes nao commitadas. Faca commit antes de enviar (producao = commit).'
}
# Branch atras da origin = PR mergeado no GitHub que nao veio para ca: enviar
# isso tiraria codigo do ar. Exige `git pull` antes.
git fetch --quiet origin
if ($LASTEXITCODE -ne 0) { throw 'git fetch falhou (sem acesso a origin?).' }
$branch = (git rev-parse --abbrev-ref HEAD).Trim()
$upstream = "origin/$branch"
git rev-parse --verify --quiet $upstream | Out-Null
if ($LASTEXITCODE -eq 0) {
  $atras = [int](git rev-list --count "HEAD..$upstream").Trim()
  if ($atras -gt 0) { throw "A branch $branch esta $atras commit(s) atras de $upstream. Rode git pull antes de enviar." }
}
$commit = (git rev-parse --short HEAD).Trim()
$tmp = Join-Path $env:TEMP "scale-$commit.tar.gz"

try {
  git archive --format=tar.gz -o $tmp HEAD
  if ($LASTEXITCODE -ne 0) { throw 'git archive falhou.' }

  scp -q $tmp "${Servidor}:/tmp/scale-release.tar.gz"
  if ($LASTEXITCODE -ne 0) { throw 'scp falhou.' }

  # Remove da VPS o que saiu do repositorio: compara com o manifesto do envio
  # anterior (.deployed-files). Sem manifesto (1o envio com esta regra), compara
  # o codigo-fonte de apps/ packages/ deploy/ docs/ (sem node_modules e builds).
  # Nunca toca em .env, backups/ nem volumes. Sem aspas duplas: o PowerShell 5.1
  # as remove ao chamar o ssh.
  $limpeza = 'cd __P__; tar -tzf /tmp/scale-release.tar.gz | grep -v /$ | sort > .deployed-files.new; ' +
    'if [ -f .deployed-files ]; then sort .deployed-files; else find apps packages deploy docs -type f ' +
    '-not -path ''*/node_modules/*'' -not -path ''*/.next/*'' -not -path ''*/out/*'' -not -path ''*/dist/*'' -not -path ''*/.caddy/*'' 2>/dev/null | sort; fi ' +
    '| comm -23 - .deployed-files.new > .deployed-orfaos; ' +
    'if [ -s .deployed-orfaos ]; then echo Removendo arquivos que sairam do repositorio:; sed s/^/-\ / .deployed-orfaos; xargs -d $''\n'' rm -f -- < .deployed-orfaos; fi; rm -f .deployed-orfaos'
  $remoto = "set -e; " + $limpeza.Replace('__P__', $Pasta) + "; tar -xzf /tmp/scale-release.tar.gz -C $Pasta && mv $Pasta/.deployed-files.new $Pasta/.deployed-files && rm -f /tmp/scale-release.tar.gz && chmod +x $Pasta/deploy/*.sh && echo $commit > $Pasta/.deployed-commit"
  if (-not $SemDeploy) { $remoto += " && cd $Pasta && ./deploy/deploy.sh" }
  ssh $Servidor $remoto
  if ($LASTEXITCODE -ne 0) { throw "Falha na VPS (codigo $LASTEXITCODE)." }

  Write-Host "Commit $commit enviado para $Servidor." -ForegroundColor Green
}
finally {
  Remove-Item $tmp -ErrorAction SilentlyContinue
}
