$ErrorActionPreference='SilentlyContinue'
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8

'=== 乐言调试口验证（重启后运行） ==='
''
$procs=@(Get-CimInstance Win32_Process -Filter "Name='assistant_dd.exe'" | Where-Object{$_.CommandLine -notmatch '--type='})
if($procs.Count -eq 0){
  '[待处理] 乐言未运行 —— 先从桌面「智能助理 Nova」启动'
}else{
  foreach($p in $procs){
    "主进程 PID=$($p.ProcessId)  启动=$($p.CreationDate)"
    "CMD=$($p.CommandLine)"
    if($p.CommandLine -match 'remote-debugging-port=(\d+)'){
      "  [OK] 调试参数已生效，端口=$($Matches[1])"
    }else{
      "  [失败] 未含调试参数 —— 可能没从改过的快捷方式启动，或没完全退出旧进程"
    }
  }
}
''
$listen=@(Get-NetTCPConnection -LocalPort 9223 -State Listen -ErrorAction SilentlyContinue)
if($listen.Count -gt 0){
  "[OK] 9223 已监听 PID=$($listen[0].OwningProcess)"
}else{
  '[失败] 9223 未监听'
}
''
try{
  $v=Invoke-RestMethod -Uri 'http://127.0.0.1:9223/json/version' -TimeoutSec 5
  "内核: $($v.Browser)"
  $list=Invoke-RestMethod -Uri 'http://127.0.0.1:9223/json/list' -TimeoutSec 5
  $pages=@($list | Where-Object{$_.type -eq 'page'})
  "页面数=$($pages.Count)"
  foreach($pg in $pages){
    $flag=if($pg.url -match 'leyan|nova|chat|pdd|jushuitan'){'  >>'}else{'    '}
    "$flag $($pg.title)"
    "       $($pg.url.Substring(0,[Math]::Min(100,$pg.url.Length)))"
  }
}catch{
  "[失败] CDP 接口不可用: $($_.Exception.Message)"
}
''
'=== 快捷方式参数（应有 9223） ==='
foreach($p in @(
 'C:\Users\Administrator\Desktop\智能助理 Nova.lnk',
 'C:\Users\Administrator\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\智能助理 Nova.lnk'
)){
  if(!(Test-Path -LiteralPath $p)){ "缺失 $p"; continue }
  $b=[System.IO.File]::ReadAllBytes($p)
  $f=[BitConverter]::ToUInt32($b,0x14)
  $pos=0x4C
  if(($f -band 0x1) -ne 0){ $id=[BitConverter]::ToUInt16($b,$pos); $pos+=2+$id }
  if(($f -band 0x2) -ne 0){ $li=[BitConverter]::ToUInt32($b,$pos); $pos+=[int]$li }
  $args=''
  foreach($k in @(0x4,0x8,0x10,0x20,0x40)){
    if(($f -band $k) -ne 0){
      $len=[BitConverter]::ToUInt16($b,$pos)
      if($k -eq 0x20){ $args=[System.Text.Encoding]::Unicode.GetString($b,$pos+2,$len*2) }
      $pos+=2+$len*2
    }
  }
  "$(Split-Path $p -Leaf) @ $(Split-Path $p -Parent) : [$args]  $([System.IO.Path]::GetFileName((Split-Path $p -Parent)))"
}
