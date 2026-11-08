# Disposable Windows CI only. All executables and data are synthetic.
$ErrorActionPreference = 'Stop'
if ($env:CI -ne 'true') { throw 'Disposable Windows CI only.' }
$folder = Join-Path $env:RUNNER_TEMP ('ally-restart-test-' + [Guid]::NewGuid())
New-Item -ItemType Directory -Path $folder | Out-Null
$source = @'
using System;
using System.IO;
using System.Linq;
using System.Threading;
using System.Windows.Forms;
class Fixture {
 [STAThread] static int Main(string[] args) {
  string folder=Environment.GetEnvironmentVariable("ALLY_HELPER_TEST_FOLDER");
  if(args.Contains("--parent")) { Thread.Sleep(1800); File.WriteAllText(Path.Combine(folder,"parent-closed"),"yes"); return 0; }
  if(args.Contains("/S")) {
   if(!File.Exists(Path.Combine(folder,"parent-closed")) || !args.Contains("--updated") || args.Contains("--force-run")) return 7;
   Thread.Sleep(300);File.WriteAllText(Path.Combine(folder,"installed"),"yes");return 0;
  }
  if(!File.Exists(Path.Combine(folder,"installed"))) return 8;
  string id=args.First(a=>a.StartsWith("--update-id=")).Substring(12);
  var form=new Form();form.Text="Synthetic reopened app";
  form.Shown+=(s,e)=>{File.WriteAllText(Path.Combine(folder,"reopened"),"yes");File.WriteAllText(Path.Combine(folder,"state.json"),"{\"id\":\""+id+"\",\"version\":\"99.0.0\",\"phase\":\"complete\"}");};
  var timer=new System.Windows.Forms.Timer();timer.Interval=1200;timer.Tick+=(s,e)=>form.Close();timer.Start();Application.Run(form);return 0;
 }
}
'@
$sourceFile = Join-Path $folder 'fixture.cs'
$executable = Join-Path $folder 'fixture.exe'
[IO.File]::WriteAllText($sourceFile,$source)
$compiler = Join-Path $env:SystemRoot 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
& $compiler /nologo /target:winexe /r:System.Windows.Forms.dll /r:System.Drawing.dll ('/out:' + $executable) $sourceFile
if ($LASTEXITCODE -ne 0) { throw 'Could not compile synthetic app.' }
$parseErrors = $null
$tokens = $null
$helper = Join-Path $PSScriptRoot 'update-helper.ps1'
[System.Management.Automation.Language.Parser]::ParseFile($helper,[ref]$tokens,[ref]$parseErrors) | Out-Null
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
$env:ALLY_HELPER_TEST_FOLDER = $folder
$state = Join-Path $folder 'state.json'
$attempt = [Guid]::NewGuid().ToString()
@{id=$attempt;version='99.0.0';phase='starting'} | ConvertTo-Json -Compress | Set-Content -LiteralPath $state
$saved = Join-Path $folder 'saved-plans-and-budgets.json'
[IO.File]::WriteAllText($saved,'{"plans":[{"name":"User plan","revision":9}],"budgets":[{"limit":12345}]}')
$before = (Get-FileHash -LiteralPath $saved).Hash
$parent = Start-Process -FilePath $executable -ArgumentList '--parent' -PassThru
$powershell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$hash = (Get-FileHash -LiteralPath $executable).Hash.ToLowerInvariant()
$size = (Get-Item -LiteralPath $executable).Length
$quoted = { param($s) '"' + $s + '"' }
$arguments = @('-NoLogo','-NoProfile','-NonInteractive','-STA','-ExecutionPolicy','Bypass','-File',(& $quoted $helper),'-Installer',(& $quoted $executable),'-Executable',(& $quoted $executable),'-ExpectedSha256',$hash,'-ExpectedSize',$size,'-ParentProcessId',$parent.Id,'-StateFile',(& $quoted $state),'-TargetVersion','99.0.0','-AttemptId',$attempt)
$stderr = Join-Path $folder 'helper-errors.txt'
$process = Start-Process -FilePath $powershell -ArgumentList $arguments -PassThru -RedirectStandardError $stderr
try {
 if (-not $process.WaitForExit(45000)) { if (Test-Path $stderr) { Write-Host (Get-Content $stderr -Raw) };if (Test-Path $state) { Write-Host (Get-Content $state -Raw) };Write-Host ('Markers: ' + ((Get-ChildItem $folder).Name -join ', '));Stop-Process -Id $process.Id -Force;throw 'Restart helper timed out.' }
 if ($process.ExitCode -ne 0) { throw 'Restart helper failed.' }
 $result = Get-Content -LiteralPath $state -Raw | ConvertFrom-Json
 if ($result.phase -ne 'complete' -or -not (Test-Path (Join-Path $folder 'reopened'))) { throw 'App did not reopen.' }
 if ((Get-FileHash -LiteralPath $saved).Hash -ne $before) { throw 'Saved records changed.' }
 Write-Host 'WINDOWS_REOPEN_OK: waited for parent exit, verified installer, installed, reopened visible app, confirmed startup, preserved saved files.'
} finally {
 Get-Process -Name fixture -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $executable } | Stop-Process -Force
 Remove-Item -LiteralPath $folder -Recurse -Force
}
