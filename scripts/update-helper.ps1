# A user-requested update only. This helper never edits or restores app data.
param(
 [Parameter(Mandatory=$true)][string]$Installer,
 [Parameter(Mandatory=$true)][string]$Executable,
 [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedSha256,
 [Parameter(Mandatory=$true)][long]$ExpectedSize,
 [Parameter(Mandatory=$true)][int]$ParentProcessId,
 [Parameter(Mandatory=$true)][string]$StateFile,
 [Parameter(Mandatory=$true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$TargetVersion,
 [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9-]{36}$')][string]$AttemptId
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Ally Finance'
$form.ClientSize = New-Object System.Drawing.Size(430,135)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.ControlBox = $false
$label = New-Object System.Windows.Forms.Label
$label.Location = New-Object System.Drawing.Point(24,22)
$label.Size = New-Object System.Drawing.Size(382,30)
$label.Font = New-Object System.Drawing.Font('Segoe UI',12)
$label.Text = 'Preparing update...'
$bar = New-Object System.Windows.Forms.ProgressBar
$bar.Location = New-Object System.Drawing.Point(24,72)
$bar.Size = New-Object System.Drawing.Size(382,15)
$bar.Style = 'Marquee'
$bar.MarqueeAnimationSpeed = 25
$form.Controls.AddRange(@($label,$bar))
function Save-UpdateState([string]$phase) {
 $record = @{ id=$AttemptId; version=$TargetVersion; phase=$phase; updatedAt=[DateTime]::UtcNow.ToString('o') } | ConvertTo-Json -Compress
 $temporary = $StateFile + '.' + $PID + '.tmp'
 [IO.File]::WriteAllText($temporary,$record)
 Move-Item -LiteralPath $temporary -Destination $StateFile -Force
}
function Pump-UpdateWindow {
 [System.Windows.Forms.Application]::DoEvents()
 Start-Sleep -Milliseconds 100
}
$startedInstaller = $false
$failureStage = 'starting'
try {
 $form.Show()
 [System.Windows.Forms.Application]::DoEvents()
 Save-UpdateState 'helper-ready'
 $failureStage = 'waiting-for-app'
 $parent = Get-Process -Id $ParentProcessId -ErrorAction SilentlyContinue
 $deadline = [DateTime]::UtcNow.AddSeconds(60)
 while ($parent -and -not $parent.HasExited) {
  if ([DateTime]::UtcNow -gt $deadline) { throw 'The current app did not close.' }
  Pump-UpdateWindow
 }
 if ((Get-Item -LiteralPath $Installer).Length -ne $ExpectedSize) { throw 'Installer size mismatch.' }
 if ((Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedSha256) { throw 'Installer checksum mismatch.' }
 $label.Text = 'Installing update...'
 $failureStage = 'installing'
 Save-UpdateState 'installing'
 # Suppress the installer's shortcut-based relaunch. Open the executable directly after it exits.
 $installerProcess = Start-Process -FilePath $Installer -ArgumentList @('/S','--updated') -PassThru
 $startedInstaller = $true
 while (-not $installerProcess.HasExited) { Pump-UpdateWindow }
 $installerProcess.WaitForExit()
 if ($installerProcess.ExitCode -ne 0) { throw 'The installer failed.' }
 if (-not (Test-Path -LiteralPath $Executable)) { throw 'Application executable missing.' }
 $label.Text = 'Opening Ally Finance...'
 $failureStage = 'opening'
 Save-UpdateState 'opening'
 Start-Process -FilePath $Executable -ArgumentList @('--updated',('--update-id=' + $AttemptId))
 $deadline = [DateTime]::UtcNow.AddSeconds(60)
 while ([DateTime]::UtcNow -lt $deadline) {
  try {
   $state = Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json
   if ($state.id -eq $AttemptId -and $state.phase -eq 'complete') { exit 0 }
  } catch { }
  Pump-UpdateWindow
 }
 throw 'The updated app did not confirm startup.'
} catch {
 [Console]::Error.WriteLine('Update helper failed at ' + $failureStage + ': ' + $_.Exception.Message)
 try { Save-UpdateState 'failed' } catch { }
 $form.Hide()
 $message = if ($startedInstaller) { 'The update could not finish reopening Ally Finance. Open Ally Finance from the Start menu.' } else { 'The update could not start. Your current app is still available.' }
 [System.Windows.Forms.MessageBox]::Show($message,'Ally Finance',[System.Windows.Forms.MessageBoxButtons]::OK,[System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
 exit 1
} finally {
 $form.Dispose()
}
