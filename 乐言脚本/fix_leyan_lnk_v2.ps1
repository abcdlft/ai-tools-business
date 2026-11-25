$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8

$ARG='--remote-debugging-port=9223'
$bkDir='E:\减负\_tools\backup'
if(!(Test-Path -LiteralPath $bkDir)){ New-Item -ItemType Directory -Path $bkDir -Force | Out-Null }

$dirs=@(
  'C:\Users\Administrator\Desktop',
  'C:\Users\Administrator\AppData\Roaming\Microsoft\Windows\Start Menu\Programs'
)

$targets=@()
foreach($d in $dirs){
  Get-ChildItem -LiteralPath $d -Filter '*.lnk' -File -ErrorAction SilentlyContinue | ForEach-Object{
    $bb=[System.IO.File]::ReadAllBytes($_.FullName)
    if([System.Text.Encoding]::Unicode.GetString($bb) -match 'assistant_dd'){
      $targets += $_.FullName
    }
  }
}

foreach($path in $targets){
  $b=[System.IO.File]::ReadAllBytes($path)
  $flags=[BitConverter]::ToUInt32($b,0x14)

  if(($flags -band 0x20) -ne 0){
    "SKIP 已有ARGS: $path"
    continue
  }
  if([System.Text.Encoding]::Unicode.GetString($b).Contains($ARG)){
    "SKIP 已含参数: $path"
    continue
  }

  # 定位字段（结构：IDList -> LinkInfo -> WORKDIR -> ICON）
  $pos=0x4C
  if(($flags -band 0x1) -ne 0){ $idLen=[BitConverter]::ToUInt16($b,$pos); $pos += 2 + $idLen }
  if(($flags -band 0x2) -ne 0){ $liSize=[BitConverter]::ToUInt32($b,$pos); $pos += [int]$liSize }

  $workdirOffset=-1; $workdirEnd=-1; $iconOffset=-1
  foreach($k in @(0x4,0x8,0x10,0x20,0x40)){
    if(($flags -band $k) -ne 0){
      $len=[BitConverter]::ToUInt16($b,$pos)
      if($k -eq 0x10){ $workdirOffset=$pos; $workdirEnd=$pos+2+$len*2 }
      if($k -eq 0x40){ $iconOffset=$pos }
      $pos += 2 + $len*2
    }
  }
  if($workdirEnd -lt 0 -or $iconOffset -lt 0){ "ERROR 结构异常: $path"; continue }
  if($workdirEnd -ne $iconOffset){ "ERROR WORKDIR 未紧邻 ICON: $path"; continue }

  # 备份
  $name=Split-Path $path -Leaf
  $bk=Join-Path $bkDir ((Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+$name+'.bak')
  Copy-Item -LiteralPath $path -Destination $bk -Force

  # 构造 ARGS 字段：2字节长度 + UTF-16LE 字符串
  $chars=$ARG.ToCharArray()
  $argsBytes=New-Object byte[] (2 + $chars.Count*2)
  $lenBytes=[BitConverter]::GetBytes([UInt16]$chars.Count)
  $argsBytes[0]=$lenBytes[0]; $argsBytes[1]=$lenBytes[1]
  for($i=0;$i -lt $chars.Count;$i++){
    $u=[BitConverter]::GetBytes([UInt16][char]$chars[$i])
    $argsBytes[2+$i*2]=$u[0]; $argsBytes[3+$i*2]=$u[1]
  }

  # 拼装：头部(到WORKDIR结束) + ARGS + ICON及之后(含ExtraData)
  $out=New-Object byte[] ($b.Length + $argsBytes.Length)
  [Array]::Copy($b,0,$out,0,$workdirEnd)
  [Array]::Copy($argsBytes,0,$out,$workdirEnd,$argsBytes.Length)
  [Array]::Copy($b,$iconOffset,$out,$workdirEnd+$argsBytes.Length,$b.Length-$iconOffset)

  # 设置 HasArgs 位 0x20
  $nf=[BitConverter]::ToUInt32($out,0x14) -bor 0x20
  $nfb=[BitConverter]::GetBytes($nf)
  $out[0x14]=$nfb[0]; $out[0x15]=$nfb[1]; $out[0x16]=$nfb[2]; $out[0x17]=$nfb[3]

  [System.IO.File]::WriteAllBytes($path,$out)
  "PATCHED $name : $($b.Length) -> $($out.Length)B  备份=$bk"
}
