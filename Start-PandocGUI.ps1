param([string]$Vault = '')
$ErrorActionPreference = 'Stop'
try {
    $pythonCommand = Get-Command pythonw.exe -ErrorAction SilentlyContinue
    if (-not $pythonCommand) { $pythonCommand = Get-Command python.exe -ErrorAction Stop }
    $launchArgs = '"' + (Join-Path $PSScriptRoot 'app.py') + '"'
    if ($Vault) { $launchArgs += ' --vault "' + $Vault.Replace('"', '') + '"' }
    Start-Process -FilePath $pythonCommand.Source -ArgumentList $launchArgs -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
} catch {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show('Unable to start. Install Python with Tkinter and add it to PATH.' + "`n" + $_.Exception.Message, 'Pandoc GUI') | Out-Null
}
