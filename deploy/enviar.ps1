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
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

if (git status --porcelain) {
  throw 'Ha alteracoes nao commitadas. Faca commit antes de enviar (producao = commit).'
}
$commit = (git rev-parse --short HEAD).Trim()
$tmp = Join-Path $env:TEMP "scale-$commit.tar.gz"

try {
  git archive --format=tar.gz -o $tmp HEAD
  if ($LASTEXITCODE -ne 0) { throw 'git archive falhou.' }

  scp -q $tmp "${Servidor}:/tmp/scale-release.tar.gz"
  if ($LASTEXITCODE -ne 0) { throw 'scp falhou.' }

  $remoto = "set -e; tar -xzf /tmp/scale-release.tar.gz -C $Pasta && rm -f /tmp/scale-release.tar.gz && chmod +x $Pasta/deploy/*.sh && echo $commit > $Pasta/.deployed-commit"
  if (-not $SemDeploy) { $remoto += " && cd $Pasta && ./deploy/deploy.sh" }
  ssh $Servidor $remoto
  if ($LASTEXITCODE -ne 0) { throw "Falha na VPS (codigo $LASTEXITCODE)." }

  Write-Host "Commit $commit enviado para $Servidor." -ForegroundColor Green
}
finally {
  Remove-Item $tmp -ErrorAction SilentlyContinue
}
