# Local portable PostgreSQL 16 for development (no admin rights, no service).
# Binaries and data: %LOCALAPPDATA%\adis-pg  (port 5433, user adis, password adis-local-dev, databases adis + adis_test)
# Usage: powershell -ExecutionPolicy Bypass -File tools\pg.ps1 start|stop|status
# The server uses it when ADIS_DATABASE_URL=postgresql://adis:adis-local-dev@127.0.0.1:5433/adis
# ASCII only (Windows PowerShell 5.1). PostgreSQL tools break on non-ASCII paths, so the 8.3 short path is used.
param([ValidateSet('start', 'stop', 'status')][string]$Action = 'status')
$ErrorActionPreference = 'Stop'
$full = Join-Path $env:LOCALAPPDATA 'adis-pg'
if (-not (Test-Path (Join-Path $full 'pgsql\bin\pg_ctl.exe'))) {
    Write-Host "PostgreSQL binaries not found in $full."
    Write-Host 'Download postgresql-16.x-windows-x64-binaries.zip from get.enterprisedb.com, extract to that folder,'
    Write-Host 'then: pgsql\bin\initdb -D data -U adis -W -E UTF8 --locale=C -A scram-sha-256'
    exit 1
}
$base = (New-Object -ComObject Scripting.FileSystemObject).GetFolder($full).ShortPath
$pgctl = "$base\pgsql\bin\pg_ctl.exe"
$data = "$base\data"
switch ($Action) {
    'start' {
        # pg_ctl keeps console handles of its child open, so don't wait for it; poll the status instead
        Start-Process -FilePath $pgctl -ArgumentList @('-D', $data, '-o', '"-p 5433 -c listen_addresses=127.0.0.1"', '-l', "$base\pg.log", 'start') -WindowStyle Hidden
        for ($i = 0; $i -lt 30; $i++) { Start-Sleep -Milliseconds 500; & $pgctl -D $data status *> $null; if ($LASTEXITCODE -eq 0) { break } }
        & $pgctl -D $data status
    }
    'stop' { & $pgctl -D $data stop -m fast }
    'status' { & $pgctl -D $data status }
}
