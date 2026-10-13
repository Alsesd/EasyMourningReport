$ErrorActionPreference = "Stop"

$profilePath = $PROFILE.CurrentUserAllHosts
if ([string]::IsNullOrWhiteSpace($profilePath)) {
    $profilePath = $PROFILE
}
$profileDirectory = Split-Path -Parent $profilePath
if (!(Test-Path -LiteralPath $profileDirectory)) {
    New-Item -ItemType Directory -Path $profileDirectory -Force | Out-Null
}

$startMarker = "# >>> EasyMourningReport uvicorn helper >>>"
$endMarker = "# <<< EasyMourningReport uvicorn helper <<<"
$helper = @'
# >>> EasyMourningReport uvicorn helper >>>
function uvicorn {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

    if (Test-Path -LiteralPath (Join-Path (Get-Location) "pyproject.toml")) {
        python -m poetry run uvicorn @Arguments
        return
    }

    $application = Get-Command -Name uvicorn -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($null -eq $application) {
        Write-Error "Uvicorn was not found. Run this command inside the EasyMourningReport project or install Uvicorn globally."
        return
    }
    & $application.Source @Arguments
}
# <<< EasyMourningReport uvicorn helper <<<
'@

$existing = if (Test-Path -LiteralPath $profilePath) {
    Get-Content -LiteralPath $profilePath -Raw
} else {
    ""
}

$escapedStart = [regex]::Escape($startMarker)
$escapedEnd = [regex]::Escape($endMarker)
$pattern = "(?s)$escapedStart.*?$escapedEnd"
if ([regex]::IsMatch($existing, $pattern)) {
    $updated = [regex]::Replace($existing, $pattern, [System.Text.RegularExpressions.MatchEvaluator]{ param($match) $helper.TrimEnd() })
} else {
    $updated = $existing.TrimEnd() + [Environment]::NewLine + [Environment]::NewLine + $helper + [Environment]::NewLine
}

Set-Content -LiteralPath $profilePath -Value $updated -Encoding UTF8
Write-Host "Installed the uvicorn helper in: $profilePath"
Write-Host "Close and reopen PowerShell. In the project folder, run: uvicorn --app-dir . app.main:app --reload"
