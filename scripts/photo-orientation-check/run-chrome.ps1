param(
  [Parameter(Mandatory = $true)][string]$Url,
  [Parameter(Mandatory = $true)][string]$ChromePath
)

$ErrorActionPreference = 'Stop'
$port = Get-Random -Minimum 41000 -Maximum 61000
$profile = Join-Path ([IO.Path]::GetTempPath()) ("learningcrew-orientation-{0}-{1}" -f $PID, [DateTime]::UtcNow.Ticks)
$stderr = Join-Path ([IO.Path]::GetTempPath()) ("learningcrew-orientation-{0}.log" -f $PID)
$chrome = $null
$socket = $null

function Invoke-Cdp {
  param(
    [Parameter(Mandatory = $true)][System.Net.WebSockets.ClientWebSocket]$Socket,
    [Parameter(Mandatory = $true)][int]$Id,
    [Parameter(Mandatory = $true)][string]$Method,
    [Parameter(Mandatory = $true)][hashtable]$Params
  )

  $json = @{ id = $Id; method = $Method; params = $Params } | ConvertTo-Json -Compress -Depth 12
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $send = New-Object System.ArraySegment[byte] -ArgumentList @(,$bytes)
  $Socket.SendAsync(
    $send,
    [System.Net.WebSockets.WebSocketMessageType]::Text,
    $true,
    [Threading.CancellationToken]::None
  ).GetAwaiter().GetResult()

  while ($true) {
    $memory = New-Object IO.MemoryStream
    do {
      $buffer = New-Object byte[] 65536
      $receive = New-Object System.ArraySegment[byte] -ArgumentList @(,$buffer)
      $part = $Socket.ReceiveAsync($receive, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
      $memory.Write($buffer, 0, $part.Count)
    } while (-not $part.EndOfMessage)
    $message = [Text.Encoding]::UTF8.GetString($memory.ToArray()) | ConvertFrom-Json
    $memory.Dispose()
    if ($message.id -eq $Id) {
      if ($message.error) { throw $message.error.message }
      return $message.result
    }
  }
}

try {
  $arguments = @(
    '--headless=new',
    '--disable-gpu',
    '--disable-extensions',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-allow-origins=*',
    "--remote-debugging-port=$port",
    "--user-data-dir=`"$profile`"",
    $Url
  )
  $chrome = Start-Process -FilePath $ChromePath -ArgumentList $arguments -PassThru -WindowStyle Hidden -RedirectStandardError $stderr

  $page = $null
  for ($attempt = 0; $attempt -lt 200; $attempt += 1) {
    if ($chrome.HasExited) {
      $details = if (Test-Path $stderr) { Get-Content -Raw $stderr } else { '' }
      throw "Chrome exited before CDP was ready: $details"
    }
    try {
      $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/list" -TimeoutSec 1
      $page = $targets | Where-Object { $_.type -eq 'page' -and $_.url -eq $Url } | Select-Object -First 1
      if (-not $page) { $page = $targets | Where-Object { $_.type -eq 'page' } | Select-Object -First 1 }
      if ($page.webSocketDebuggerUrl) { break }
    } catch {
      $page = $null
    }
    Start-Sleep -Milliseconds 50
  }
  if (-not $page.webSocketDebuggerUrl) { throw 'Chrome did not expose the harness page' }

  $socket = New-Object System.Net.WebSockets.ClientWebSocket
  $socket.ConnectAsync([Uri]$page.webSocketDebuggerUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
  $expression = @"
(() => ({
  status: document.documentElement.dataset.orientationCheck || null,
  text: document.querySelector('#result') ? document.querySelector('#result').textContent : null
}))()
"@
  $last = $null
  for ($attempt = 1; $attempt -le 200; $attempt += 1) {
    $evaluated = Invoke-Cdp -Socket $socket -Id $attempt -Method 'Runtime.evaluate' -Params @{
      expression = $expression
      returnByValue = $true
    }
    $last = $evaluated.result.value
    if ($last.status -eq 'pass' -or $last.status -eq 'fail') {
      Write-Output $last.text
      exit 0
    }
    Start-Sleep -Milliseconds 50
  }
  throw ("Harness result timeout: {0}" -f ($last | ConvertTo-Json -Compress))
} finally {
  if ($socket) { $socket.Dispose() }
  if ($chrome -and -not $chrome.HasExited) { Stop-Process -Id $chrome.Id -Force -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $stderr -Force -ErrorAction SilentlyContinue
}
