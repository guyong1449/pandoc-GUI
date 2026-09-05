$ErrorActionPreference = 'Stop'
$stage = Join-Path ([IO.Path]::GetTempPath()) ('pandoc-package-' + [guid]::NewGuid().ToString('N'))
$plugin = Join-Path $stage 'pandoc-studio'
New-Item -ItemType Directory -Path $plugin | Out-Null
foreach ($file in @('main.js', 'manifest.json', 'styles.css')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot "obsidian-plugin\$file") -Destination $plugin
}
$output = Join-Path $PSScriptRoot 'dist'
New-Item -ItemType Directory -Path $output -Force | Out-Null
Compress-Archive -LiteralPath $plugin -DestinationPath (Join-Path $output 'pandoc-studio.zip') -Force
# Only the explicitly created, GUID-named staging directory is removed.
$resolvedStage = [IO.Path]::GetFullPath($stage)
$expected = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\pandoc-package-'
if (-not $resolvedStage.StartsWith($expected, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected staging path.' }
Remove-Item -LiteralPath $resolvedStage -Recurse -Force
Write-Output (Join-Path $output 'pandoc-studio.zip')
