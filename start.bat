@echo off
rem ================================================================
rem  Scale - start.bat
rem  Entrypoint canonico do projeto Scale (videochamadas P2P mesh).
rem  Executavel de qualquer diretorio; o script sempre roda na raiz
rem  da pasta onde ele esta (mesmo se a pasta for renomeada).
rem ================================================================
rem
rem  USO:
rem    start.bat [ARG]
rem
rem  ARGS:
rem    (sem arg) | up       docker compose up --build -d && docker compose ps
rem    https                docker compose --profile https up --build -d
rem    mcp                  docker compose --profile mcp up --build -d
rem    all | https+mcp      docker compose --profile https --profile mcp up --build -d
rem    dev                  npm install && lint && build && docker compose up -d
rem    down                 docker compose --profile https --profile mcp down
rem    logs                 docker compose logs -f
rem    check | gates        lint + build + docker compose config (mcp e https)
rem    help                 mostra esta ajuda
rem
rem  PROFILES DO DOCKER COMPOSE:
rem    https   -> Caddy com TLS (certificado local em certs/ ou tailnet)
rem    mcp     -> MCP server de consulta de salas (porta 4001)
rem    turn    -> coturn opcional (nao usado por este script)
rem
rem  SELF-UPDATE:
rem    Este .bat e sempre mantido atualizado no repositorio (commits
rem    convencionais). Antes de subir servicos, se existir um remoto
rem    Git, o script tenta `git pull --ff-only`; offline ou com
rem    mudancas locais, ele apenas avisa e segue com o codigo local.
rem    Para atualizar o proprio start.bat: git pull && start.bat up
rem ================================================================

setlocal
pushd "%~dp0"

set "EXIT_CODE=0"
set "ARG=%~1"
if "%ARG%"=="" set "ARG=up"

rem ----- dispatch -----
if /i "%ARG%"=="help"      goto :usage
if /i "%ARG%"=="up"        goto :do_up
if /i "%ARG%"=="https"     goto :do_https
if /i "%ARG%"=="mcp"       goto :do_mcp
if /i "%ARG%"=="all"       goto :do_all
if /i "%ARG%"=="https+mcp" goto :do_all
if /i "%ARG%"=="dev"       goto :do_dev
if /i "%ARG%"=="down"      goto :do_down
if /i "%ARG%"=="logs"      goto :do_logs
if /i "%ARG%"=="check"     goto :do_check
if /i "%ARG%"=="gates"     goto :do_check
echo [Scale] Argumento desconhecido: "%ARG%"
goto :usage

rem ===================== acoes =====================

:do_up
call :prepare
if errorlevel 1 goto :end
echo.
echo [Scale] Subindo servicos (docker compose up --build -d)...
docker compose up --build -d
if errorlevel 1 (
    echo [Scale] ERRO: docker compose up falhou. Veja os logs acima.
    set "EXIT_CODE=1"
    goto :end
)
docker compose ps
goto :end

:do_https
call :prepare
if errorlevel 1 goto :end
echo.
echo [Scale] Subindo com profile https (Caddy/TLS)...
docker compose --profile https up --build -d
if errorlevel 1 (
    echo [Scale] ERRO: docker compose up (https) falhou.
    set "EXIT_CODE=1"
)
goto :end

:do_mcp
call :prepare
if errorlevel 1 goto :end
echo.
echo [Scale] Subindo com profile mcp (MCP server)...
docker compose --profile mcp up --build -d
if errorlevel 1 (
    echo [Scale] ERRO: docker compose up (mcp) falhou.
    set "EXIT_CODE=1"
)
goto :end

:do_all
call :prepare
if errorlevel 1 goto :end
echo.
echo [Scale] Subindo com profiles https + mcp...
docker compose --profile https --profile mcp up --build -d
if errorlevel 1 (
    echo [Scale] ERRO: docker compose up (https+mcp) falhou.
    set "EXIT_CODE=1"
)
goto :end

:do_dev
call :prepare
if errorlevel 1 goto :end
echo.
echo [Scale] Modo desenvolvimento: install + lint + build + up...
call npm install
if errorlevel 1 (
    echo [Scale] ERRO: npm install falhou.
    set "EXIT_CODE=1"
    goto :end
)
call npm run lint
if errorlevel 1 (
    echo [Scale] ERRO: npm run lint falhou.
    set "EXIT_CODE=1"
    goto :end
)
call npm run build
if errorlevel 1 (
    echo [Scale] ERRO: npm run build falhou.
    set "EXIT_CODE=1"
    goto :end
)
docker compose up --build -d
if errorlevel 1 (
    echo [Scale] ERRO: docker compose up falhou.
    set "EXIT_CODE=1"
)
goto :end

:do_down
echo.
echo [Scale] Derrubando servicos (profiles https + mcp)...
docker compose --profile https --profile mcp down
if errorlevel 1 (
    echo [Scale] ERRO: docker compose down falhou.
    set "EXIT_CODE=1"
)
goto :end

:do_logs
echo.
echo [Scale] Acompanhando logs (Ctrl+C para sair)...
docker compose logs -f
if errorlevel 1 (
    echo [Scale] ERRO: docker compose logs falhou.
    set "EXIT_CODE=1"
)
goto :end

:do_check
echo.
echo [Scale] Rodando gates: lint + build + docker compose config...
call npm run lint
if errorlevel 1 set "EXIT_CODE=1"
call npm run build
if errorlevel 1 set "EXIT_CODE=1"
docker compose --profile mcp config
if errorlevel 1 set "EXIT_CODE=1"
docker compose --profile https config
if errorlevel 1 set "EXIT_CODE=1"
if "%EXIT_CODE%"=="0" (
    echo.
    echo [Scale] Gates OK: lint, build e compose config validados.
) else (
    echo.
    echo [Scale] Gates com FALHA. Revise os erros acima.
)
goto :end

:usage
echo.
echo Scale - start.bat
echo.
echo Uso:
echo   start.bat [ARG]
echo.
echo   ^(sem arg^) ^| up        docker compose up --build -d ^&^& docker compose ps
echo   https                  docker compose --profile https up --build -d
echo   mcp                    docker compose --profile mcp up --build -d
echo   all ^| https+mcp         docker compose --profile https --profile mcp up --build -d
echo   dev                    npm install ^&^& lint ^&^& build ^&^& docker compose up --build -d
echo   down                   docker compose --profile https --profile mcp down
echo   logs                   docker compose logs -f
echo   check ^| gates           lint + build + docker compose config ^(mcp e https^)
echo   help                   mostra esta ajuda
echo.
goto :end

rem ===================== helpers =====================

:prepare
call :check_docker
if errorlevel 1 exit /b 1
call :git_pull_if_remote
exit /b 0

:check_docker
where docker >nul 2>nul
if errorlevel 1 (
    echo [Scale] ERRO: Docker nao encontrado no PATH.
    echo [Scale] Instale o Docker Desktop e rode start.bat novamente.
    exit /b 1
)
exit /b 0

:git_pull_if_remote
git remote | findstr . >nul 2>nul
if errorlevel 1 exit /b 0
echo [Scale] Remoto Git detectado. Atualizando (git pull --ff-only)...
git pull --ff-only
if errorlevel 1 (
    echo [Scale] Aviso: git pull falhou (offline, conflito ou trabalho local).
    echo [Scale] Continuando com o codigo local.
)
exit /b 0

:end
echo.
echo [Scale] Concluido.
popd
endlocal
exit /b %EXIT_CODE%