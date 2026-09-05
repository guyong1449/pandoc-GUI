param([string]$Vault = '')
$ErrorActionPreference = 'Stop'
try {
    # Prefer the separately installed official Pandoc over older Conda copies.
    $pandocRoot = Join-Path $env:USERPROFILE 'tools\pandoc'
    if (Test-Path -LiteralPath $pandocRoot) {
        $latest = Get-ChildItem -LiteralPath $pandocRoot -Directory |
            Where-Object { $_.Name -match '^pandoc-\d+(\.\d+)+$' -and (Test-Path -LiteralPath (Join-Path $_.FullName 'pandoc.exe')) } |
            Sort-Object { [version]($_.Name -replace '^pandoc-', '') } -Descending |
            Select-Object -First 1
        if ($latest) { $env:Path = $latest.FullName + ';' + $env:Path }
    }
    $pythonCommand = Get-Command pythonw.exe -ErrorAction SilentlyContinue
    if (-not $pythonCommand) { $pythonCommand = Get-Command python.exe -ErrorAction Stop }
    $launchArgs = '"' + (Join-Path $PSScriptRoot 'app.py') + '"'
    if ($Vault) { $launchArgs += ' --vault "' + $Vault.Replace('"', '') + '"' }
    Start-Process -FilePath $pythonCommand.Source -ArgumentList $launchArgs -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
} catch {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show('Unable to start. Install Python with Tkinter and add it to PATH.' + "`n" + $_.Exception.Message, 'Pandoc GUI') | Out-Null
}
