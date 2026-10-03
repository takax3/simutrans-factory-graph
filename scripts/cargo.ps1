$CargoArgs = $args
$projectRoot = Split-Path $PSScriptRoot -Parent
$localCargo = Join-Path $projectRoot '.tools/cargo/bin/cargo.exe'
if (Test-Path $localCargo) {
    $env:CARGO_HOME = Join-Path $projectRoot '.tools/cargo'
    $env:RUSTUP_HOME = Join-Path $projectRoot '.tools/rustup'
    $env:PATH = (Join-Path $projectRoot '.tools/cargo/bin') + ';' + $env:PATH
    & $localCargo @CargoArgs
} else {
    & cargo @CargoArgs
}
exit $LASTEXITCODE

