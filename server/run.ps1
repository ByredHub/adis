# Adis AI Backend launcher (Windows PowerShell 5.1). ASCII only.
# Usage: powershell -ExecutionPolicy Bypass -File server\run.ps1 [-Port 8000] [-Test]
param([int]$Port = 8000, [switch]$Test)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$venvPy = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path $venvPy)) {
    $py = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'
    if (-not (Test-Path $py)) { $py = 'python' }
    Write-Host "Creating virtual environment with $py"
    & $py -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Python 3.12 is required: winget install -e --id Python.Python.3.12 --scope user' }
}

$stamp = Join-Path $PSScriptRoot '.venv\.req-stamp'
$req = Join-Path $PSScriptRoot 'requirements.txt'
if (-not (Test-Path $stamp) -or (Get-Item $req).LastWriteTime -gt (Get-Item $stamp).LastWriteTime) {
    Write-Host 'Installing dependencies...'
    & $venvPy -m pip install --disable-pip-version-check -q -r $req
    if ($LASTEXITCODE -ne 0) { throw 'pip install failed' }
    Set-Content -Path $stamp -Value (Get-Date -Format o)
}

$env:PYTHONIOENCODING = 'utf-8'
if ($Test) {
    & $venvPy -m pytest -q -p no:cacheprovider tests
    exit $LASTEXITCODE
}

$ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -like '192.168.*' } | Select-Object -First 1).IPAddress
Write-Host ''
Write-Host "Adis AI Backend:  http://localhost:$Port/v1/health   (API docs: /v1/docs)"
Write-Host "App:              http://localhost:$Port/"
if ($ip) { Write-Host "From phone (LAN): http://${ip}:$Port/" }
Write-Host 'In the app: Profile -> Connection -> AI Backend, address http://localhost:'"$Port"'/v1'
Write-Host ''
& $venvPy -m uvicorn adis.main:app --host 0.0.0.0 --port $Port --proxy-headers
