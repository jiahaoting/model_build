$found = @()
# 1. Registry uninstall entries
$regPaths = @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*')
foreach ($rp in $regPaths) {
    Get-ItemProperty $rp -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like '*Blender*' } | ForEach-Object {
        Write-Output ("REG: " + $_.DisplayName + " -> " + $_.InstallLocation)
        if ($_.InstallLocation) { $found += Get-ChildItem $_.InstallLocation -Recurse -Filter 'blender.exe' -ErrorAction SilentlyContinue }
    }
}
# 2. Start menu shortcuts
$lnk = Get-ChildItem "$env:ProgramData\Microsoft\Windows\Start Menu", "$env:APPDATA\Microsoft\Windows\Start Menu" -Recurse -Filter '*lender*' -ErrorAction SilentlyContinue
foreach ($l in $lnk) { Write-Output ("LNK: " + $l.FullName) }
# 3. Common drive roots, depth 3
foreach ($root in @('C:\', 'D:\', 'E:\')) {
    if (Test-Path $root) {
        $found += Get-ChildItem $root -Recurse -Filter 'blender.exe' -Depth 3 -ErrorAction SilentlyContinue
    }
}
# 4. Steam libraries
foreach ($sp in @('C:\Program Files (x86)\Steam\steamapps\common\Blender', 'D:\SteamLibrary\steamapps\common\Blender', 'E:\SteamLibrary\steamapps\common\Blender')) {
    if (Test-Path $sp) { $found += Get-ChildItem $sp -Filter 'blender.exe' -ErrorAction SilentlyContinue }
}
if ($found) { $found | ForEach-Object { Write-Output ("EXE: " + $_.FullName) } } else { Write-Output "EXE NOT FOUND ANYWHERE" }
