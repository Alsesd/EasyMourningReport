param(
    [Parameter(Mandatory = $true)]
    [string] $FilePath
)

$ErrorActionPreference = "Stop"

if (-not $env:WIN_SIGN_PFX -or -not $env:WIN_SIGN_PASS) {
    throw "WIN_SIGN_PFX and WIN_SIGN_PASS are required for signing."
}

$target = (Resolve-Path -LiteralPath $FilePath).Path
$sdkRoot = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
$signtool = Get-ChildItem -Path $sdkRoot -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match "\\x64\\signtool\.exe$" } |
    Sort-Object FullName -Descending |
    Select-Object -First 1 -ExpandProperty FullName

if (-not $signtool) {
    throw "Windows SDK signtool.exe was not found."
}

$pfxPath = Join-Path $env:RUNNER_TEMP "legkyi-codesign.pfx"
try {
    [IO.File]::WriteAllBytes(
        $pfxPath,
        [Convert]::FromBase64String($env:WIN_SIGN_PFX)
    )

    & $signtool sign /fd SHA256 /td SHA256 /tr "http://timestamp.digicert.com" /f $pfxPath /p $env:WIN_SIGN_PASS $target
    if ($LASTEXITCODE -ne 0) {
        throw "signtool sign failed for $target with exit code $LASTEXITCODE"
    }

    & $signtool verify /pa /all $target
    if ($LASTEXITCODE -ne 0) {
        throw "Authenticode verification failed for $target"
    }
}
finally {
    Remove-Item -LiteralPath $pfxPath -Force -ErrorAction SilentlyContinue
    Remove-Item Env:WIN_SIGN_PASS -ErrorAction SilentlyContinue
    Remove-Item Env:WIN_SIGN_PFX -ErrorAction SilentlyContinue
}
