$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8

function Parse-Lnk($path) {
  $b=[System.IO.File]::ReadAllBytes($path)
  $flags=[BitConverter]::ToUInt32($b,0x14)
  $r=[ordered]@{}
  $r.file=$path
  $r.size=$b.Length
  $r.flags=('0x{0:X8}' -f $flags)
  $r.hasIDList=[bool]($flags -band 0x1)
  $r.hasLinkInfo=[bool]($flags -band 0x2)
  $r.hasName=[bool]($flags -band 0x4)
  $r.hasRelative=[bool]($flags -band 0x8)
  $r.hasWorkDir=[bool]($flags -band 0x10)
  $r.hasArgs=[bool]($flags -band 0x20)
  $r.hasIcon=[bool]($flags -band 0x40)

  $pos=0x4C
  if($r.hasIDList){
    $idLen=[BitConverter]::ToUInt16($b,$pos)
    $r.idListLen=$idLen
    $pos += 2 + $idLen
  }
  if($r.hasLinkInfo){
    $liSize=[BitConverter]::ToUInt32($b,$pos)
    $r.linkInfoSize=$liSize
    $pos += [int]$liSize
  }
  $names=@{0x4='NAME';0x8='RELATIVE';0x10='WORKDIR';0x20='ARGS';0x40='ICON'}
  $fields=@()
  foreach($k in @(0x4,0x8,0x10,0x20,0x40)){
    if(($flags -band $k) -ne 0){
      $len=[BitConverter]::ToUInt16($b,$pos)
      $str=[System.Text.Encoding]::Unicode.GetString($b,$pos+2,$len*2)
      $fields += [pscustomobject]@{ key=$names[$k]; bit=$k; offset=$pos; charLen=$len; text=$str }
      $pos += 2 + $len*2
    }
  }
  $r.stringDataEnd=$pos
  $r.extraDataSize=$b.Length-$pos
  $r.fields=$fields
  return $r
}

$dirs=@('C:\Users\Administrator\Desktop','C:\Users\Administrator\AppData\Roaming\Microsoft\Windows\Start Menu\Programs')
foreach($d in $dirs){
  Get-ChildItem -LiteralPath $d -Filter '*.lnk' -File -ErrorAction SilentlyContinue | ForEach-Object{
    $bb=[System.IO.File]::ReadAllBytes($_.FullName)
    if([System.Text.Encoding]::Unicode.GetString($bb) -match 'assistant_dd'){
      $r=Parse-Lnk $_.FullName
      "===== $($_.Name) ====="
      "  size=$($r.size) flags=$($r.flags) IDList=$($r.hasIDList) LinkInfo=$($r.hasLinkInfo)"
      "  NAME=$($r.hasName) REL=$($r.hasRelative) WORKDIR=$($r.hasWorkDir) ARGS=$($r.hasArgs) ICON=$($r.hasIcon)"
      foreach($f in $r.fields){
        $txt=$f.text
        if($txt.Length -gt 100){$txt=$txt.Substring(0,100)+'...'}
        "    [$($f.key)] @$($f.offset) len=$($f.charLen) => $txt"
      }
      "  StringData结束 @$($r.stringDataEnd)  ExtraData=$($r.extraDataSize)B"
    }
  }
}
