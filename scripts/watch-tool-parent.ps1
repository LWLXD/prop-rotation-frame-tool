param(
  [Parameter(Mandatory = $true)]
  [int]$ParentPid,
  [Parameter(Mandatory = $true)]
  [string]$PidFile,
  [Parameter(Mandatory = $true)]
  [string]$Root
)

$ErrorActionPreference = "SilentlyContinue"

function Stop-ProcessTree {
  param([int]$ProcessId)

  $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId"
  foreach ($child in $children) {
    Stop-ProcessTree -ProcessId ([int]$child.ProcessId)
  }

  $process = Get-Process -Id $ProcessId
  if ($process) {
    Stop-Process -Id $ProcessId -Force
  }
}

function Stop-RootProcesses {
  $currentPid = $PID
  $processes = Get-CimInstance Win32_Process | Where-Object {
    $_.ProcessId -ne $currentPid -and
    $_.CommandLine -like "*$Root*" -and
    ($_.Name -like "node*" -or $_.Name -like "cmd*")
  }

  foreach ($process in $processes) {
    Stop-ProcessTree -ProcessId ([int]$process.ProcessId)
  }
}

while ($true) {
  $parent = Get-Process -Id $ParentPid
  if (!$parent) {
    break
  }

  Start-Sleep -Seconds 1
}

try {
  if (Test-Path $PidFile) {
    $pids = Get-Content -Raw $PidFile | ConvertFrom-Json
    foreach ($pid in $pids) {
      $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $pid"
      if ($processInfo -and $processInfo.CommandLine -like "*$Root*") {
        Stop-ProcessTree -ProcessId ([int]$pid)
      }
    }
  }
  Stop-RootProcesses
} finally {
  Remove-Item $PidFile -Force
}
