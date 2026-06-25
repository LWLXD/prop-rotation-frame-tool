param(
  [int]$FrontendPort = 5183,
  [int]$BackendPort = 4100,
  [int]$RembgPort = 8001,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $Root ".runtime-logs"
$PidFile = Join-Path $LogDir "tool-pids.json"
$WatcherScript = Join-Path $PSScriptRoot "watch-tool-parent.ps1"
$RembgPython = Join-Path $Root ".venv-rembg\Scripts\python.exe"
$RembgRequirements = Join-Path $Root "apps\rembg-service\requirements.txt"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Stop-ProcessTree {
  param([int]$ProcessId)

  $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction SilentlyContinue
  foreach ($child in $children) {
    Stop-ProcessTree -ProcessId ([int]$child.ProcessId)
  }

  $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if ($process) {
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
  }
}

function Stop-RootProcesses {
  $currentPid = $PID
  $processes = Get-CimInstance Win32_Process | Where-Object {
    $_.ProcessId -ne $currentPid -and
    $_.CommandLine -like "*$Root*" -and
    ($_.Name -like "node*" -or $_.Name -like "cmd*" -or $_.Name -like "python*")
  }

  foreach ($process in $processes) {
    Stop-ProcessTree -ProcessId ([int]$process.ProcessId)
  }
}

function Stop-PreviousInstance {
  if (!(Test-Path $PidFile)) {
    return
  }

  try {
    $oldPids = Get-Content -Raw $PidFile | ConvertFrom-Json
    foreach ($oldPid in $oldPids) {
      $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $oldPid" -ErrorAction SilentlyContinue
      if ($processInfo -and $processInfo.CommandLine -like "*$Root*") {
        Stop-ProcessTree -ProcessId ([int]$oldPid)
      }
    }
  } catch {
    Write-Warning "Could not clean previous pid file: $($_.Exception.Message)"
  }

  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

function Test-PortInUse {
  param([int]$Port)

  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    if (!$async.AsyncWaitHandle.WaitOne(300, $false)) {
      return $false
    }
    $client.EndConnect($async)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Enable-KillOnCloseJob {
  if ("ToolJobNative" -as [type]) {
    return
  }

  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class ToolJobNative {
  public const int JobObjectExtendedLimitInformation = 9;
  public const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
  public static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool SetInformationJobObject(IntPtr hJob, int infoType, IntPtr lpJobObjectInfo, uint cbJobObjectInfoLength);

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool CloseHandle(IntPtr hObject);
}

[StructLayout(LayoutKind.Sequential)]
public struct IO_COUNTERS {
  public ulong ReadOperationCount;
  public ulong WriteOperationCount;
  public ulong OtherOperationCount;
  public ulong ReadTransferCount;
  public ulong WriteTransferCount;
  public ulong OtherTransferCount;
}

[StructLayout(LayoutKind.Sequential)]
public struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
  public long PerProcessUserTimeLimit;
  public long PerJobUserTimeLimit;
  public uint LimitFlags;
  public UIntPtr MinimumWorkingSetSize;
  public UIntPtr MaximumWorkingSetSize;
  public uint ActiveProcessLimit;
  public IntPtr Affinity;
  public uint PriorityClass;
  public uint SchedulingClass;
}

[StructLayout(LayoutKind.Sequential)]
public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
  public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
  public IO_COUNTERS IoInfo;
  public UIntPtr ProcessMemoryLimit;
  public UIntPtr JobMemoryLimit;
  public UIntPtr PeakProcessMemoryUsed;
  public UIntPtr PeakJobMemoryUsed;
}
"@
}

function New-KillOnCloseJob {
  Enable-KillOnCloseJob

  $job = [ToolJobNative]::CreateJobObject([IntPtr]::Zero, $null)
  if ($job -eq [IntPtr]::Zero) {
    throw "CreateJobObject failed"
  }

  $info = New-Object JOBOBJECT_EXTENDED_LIMIT_INFORMATION
  $info.BasicLimitInformation.LimitFlags = [ToolJobNative]::JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
  $length = [Runtime.InteropServices.Marshal]::SizeOf($info)
  $pointer = [Runtime.InteropServices.Marshal]::AllocHGlobal($length)
  try {
    [Runtime.InteropServices.Marshal]::StructureToPtr($info, $pointer, $false)
    $ok = [ToolJobNative]::SetInformationJobObject(
      $job,
      [ToolJobNative]::JobObjectExtendedLimitInformation,
      $pointer,
      [uint32]$length
    )
    if (!$ok) {
      throw "SetInformationJobObject failed"
    }
  } finally {
    [Runtime.InteropServices.Marshal]::FreeHGlobal($pointer)
  }

  return $job
}

function Start-ToolProcess {
  param(
    [string]$Name,
    [string]$Command,
    [IntPtr]$JobHandle
  )

  $logPath = Join-Path $LogDir "$Name.log"
  $quotedLogPath = $logPath.Replace('"', '""')
  $arguments = "/d /s /c `"ping 127.0.0.1 -n 2 > nul & $Command > `"$quotedLogPath`" 2>&1`""
  $process = Start-Process -FilePath "cmd.exe" -ArgumentList $arguments -WorkingDirectory $Root -PassThru -WindowStyle Hidden
  $assigned = [ToolJobNative]::AssignProcessToJobObject($JobHandle, $process.Handle)
  if (!$assigned) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    throw "Could not attach $Name to cleanup job"
  }

  [pscustomobject]@{
    Name = $Name
    Process = $process
    LogPath = $logPath
  }
}

function Ensure-RembgEnvironment {
  if (!(Test-Path $RembgPython)) {
    Write-Host "Preparing rembg Python environment. First run may take a while..."
    python -m venv (Join-Path $Root ".venv-rembg")
    if ($LASTEXITCODE -ne 0) {
      throw "Could not create .venv-rembg. Please make sure Python 3.11 is available."
    }

    & $RembgPython -m pip install --upgrade pip
    if ($LASTEXITCODE -ne 0) {
      throw "Could not upgrade pip in .venv-rembg"
    }
  }

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & $RembgPython -c "from rembg import remove; print('rembg ok')" > $null 2>&1
  $rembgCheckExitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorActionPreference
  if ($rembgCheckExitCode -ne 0) {
    Write-Host "Installing or repairing rembg dependencies..."
    & $RembgPython -m pip install -r $RembgRequirements
    if ($LASTEXITCODE -ne 0) {
      throw "Could not install rembg-service requirements"
    }
  }
}

function Quote-CommandArgument {
  param([string]$Value)

  '"' + $Value.Replace('"', '\"') + '"'
}

function Start-DetachedWatcher {
  $watcherLog = Join-Path $LogDir "watcher.log"
  $watcherCommand = @(
    "powershell.exe",
    "-NoProfile",
    "-ExecutionPolicy Bypass",
    "-File $(Quote-CommandArgument $WatcherScript)",
    "-ParentPid $PID",
    "-PidFile $(Quote-CommandArgument $PidFile)",
    "-Root $(Quote-CommandArgument $Root)",
    "> $(Quote-CommandArgument $watcherLog) 2>&1"
  ) -join " "
  $commandLine = "cmd.exe /d /s /c `"$watcherCommand`""

  $result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = $commandLine
    CurrentDirectory = $Root
  }
  if ($result.ReturnValue -ne 0) {
    throw "Could not start cleanup watcher. Win32_Process.Create returned $($result.ReturnValue)"
  }

  [int]$result.ProcessId
}

Stop-PreviousInstance

if (Test-PortInUse -Port $FrontendPort) {
  throw "Frontend port $FrontendPort is already in use. Run with another port, for example: .\start-tool.bat -FrontendPort 5184"
}
if (Test-PortInUse -Port $BackendPort) {
  throw "Backend port $BackendPort is already in use. Run with another port, for example: .\start-tool.bat -BackendPort 4101"
}
if (Test-PortInUse -Port $RembgPort) {
  throw "rembg port $RembgPort is already in use. Run with another port, for example: .\start-tool.bat -RembgPort 8002"
}

$env:PORT = "$BackendPort"
$env:VITE_API_BASE_URL = "http://localhost:$BackendPort"
$env:REMBG_SERVICE_URL = "http://localhost:$RembgPort"
$env:FORCE_COLOR = "1"
Ensure-RembgEnvironment
$jobHandle = New-KillOnCloseJob
$started = @()
$watcherProcessId = $null

try {
  $started += Start-ToolProcess -Name "rembg" -Command "`"$RembgPython`" -m uvicorn main:app --app-dir apps\rembg-service --host 127.0.0.1 --port $RembgPort" -JobHandle $jobHandle
  $started += Start-ToolProcess -Name "backend" -Command "npm run dev -w apps/backend" -JobHandle $jobHandle
  $started += Start-ToolProcess -Name "worker" -Command "npm run dev -w apps/worker" -JobHandle $jobHandle
  $started += Start-ToolProcess -Name "frontend" -Command "npm run dev -w apps/frontend -- --host 0.0.0.0 --port $FrontendPort --strictPort" -JobHandle $jobHandle

  $started.Process.Id | ConvertTo-Json | Set-Content -Path $PidFile -Encoding UTF8
  $watcherProcessId = Start-DetachedWatcher

  Write-Host ""
  Write-Host "Prop rotation tool is starting..."
  Write-Host "Frontend: http://localhost:$FrontendPort/"
  Write-Host "Backend:  http://localhost:$BackendPort/"
  Write-Host "rembg:    http://localhost:$RembgPort/"
  Write-Host "Logs:     $LogDir"
  Write-Host ""
  Write-Host "Keep this window open while using the tool."
  Write-Host "Press Ctrl+C or close this window to stop rembg, backend, worker, and frontend."
  Write-Host ""

  Start-Sleep -Seconds 3
  if (!$NoBrowser) {
    Start-Process "http://localhost:$FrontendPort/"
  }

  while ($true) {
    foreach ($item in $started) {
      if ($item.Process.HasExited) {
        throw "$($item.Name) exited. See log: $($item.LogPath)"
      }
    }
    Start-Sleep -Seconds 1
  }
} finally {
  Write-Host ""
  Write-Host "Stopping prop rotation tool..."
  foreach ($item in $started) {
    Stop-ProcessTree -ProcessId $item.Process.Id
  }
  Stop-RootProcesses
  if ($watcherProcessId) {
    Stop-Process -Id $watcherProcessId -Force -ErrorAction SilentlyContinue
  }
  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
  if ($jobHandle -and $jobHandle -ne [IntPtr]::Zero) {
    [ToolJobNative]::CloseHandle($jobHandle) | Out-Null
  }
  Write-Host "Stopped."
}
