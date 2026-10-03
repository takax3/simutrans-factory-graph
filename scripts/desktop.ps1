param([ValidateSet('dev', 'build')][string]$Mode = 'dev')
$projectRoot = Split-Path $PSScriptRoot -Parent
if (Test-Path (Join-Path $projectRoot '.tools/cargo/bin/cargo.exe')) {
    $env:CARGO_HOME = Join-Path $projectRoot '.tools/cargo'
    $env:RUSTUP_HOME = Join-Path $projectRoot '.tools/rustup'
    $env:PATH = (Join-Path $projectRoot '.tools/cargo/bin') + ';' + $env:PATH
}
Set-Location $projectRoot
& npm.cmd exec tauri -- $Mode
exit $LASTEXITCODE
