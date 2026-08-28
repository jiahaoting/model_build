Write-Output "=== Blender search ==="
$candidates = @()
if (Test-Path 'C:\Program Files\Blender Foundation') {
    $candidates += Get-ChildItem 'C:\Program Files\Blender Foundation' -Recurse -Filter 'blender.exe' -ErrorAction SilentlyContinue
}
$candidates += Get-ChildItem "$env:LOCALAPPDATA\Programs" -Recurse -Filter 'blender.exe' -Depth 2 -ErrorAction SilentlyContinue
$candidates += Get-ChildItem "$env:USERPROFILE\Downloads" -Filter 'blender.exe' -ErrorAction SilentlyContinue
if ($candidates) { $candidates | ForEach-Object { Write-Output $_.FullName } } else { Write-Output "NOT FOUND" }

Write-Output "=== Piano-like files in Downloads ==="
Get-ChildItem 'C:\Users\jiaha\Downloads' -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match 'piano|steinway' -or $_.Extension -match '\.(blend|fbx|obj|glb|gltf)$' } |
    Select-Object FullName, @{N='MB';E={[math]::Round($_.Length/1MB,2)}} |
    Format-Table -AutoSize
