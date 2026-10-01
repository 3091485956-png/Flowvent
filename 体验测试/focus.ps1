Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
$targets = Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Where-Object { $_.ProcessName -match 'ZCode|zcode|ZCODE' -or $_.MainWindowTitle -match 'ZCode' }
if (-not $targets) { $targets = Get-Process | Where-Object { $_.MainWindowTitle -ne '' } }
$i = 0
foreach ($t in $targets) { Write-Output ("CAND $i | " + $t.Id + " | " + $t.ProcessName + " | " + $t.MainWindowTitle); $i++ }
if ($targets.Count -gt 0) {
  $h = $targets[0].MainWindowHandle
  [Win]::ShowWindow($h, 9) | Out-Null
  Start-Sleep -Milliseconds 200
  [Win]::SetForegroundWindow($h) | Out-Null
  Write-Output "ACTIVATED handle=$h"
} else {
  Write-Output "NO_WINDOW"
}
