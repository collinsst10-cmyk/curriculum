# 용원초등학교 교육과정 편성 도우미 - GitHub 양방향 동기화(배포)
#
#  이 폴더가 곧 GitHub 저장소(collinsst10-cmyk/curriculum, main 브랜치)입니다.
#   배포하기.cmd  : ① 이 PC의 변경 사항 커밋 → ② GitHub의 새 변경(예: ChatGPT 작업) 가져와 합치기 → ③ GitHub에 올리기(= 사이트 배포)
#   가져오기.cmd  : GitHub의 새 변경만 이 PC로 가져오기 (올리지 않음)
#
#  같은 파일의 같은 부분을 양쪽에서 고쳐 자동으로 합칠 수 없으면, 아무것도 바꾸지 않고 멈춘 뒤 알려 줍니다.
#  PowerShell 에서 직접:  .\deploy.ps1 -Message "변경 내용"   /   .\deploy.ps1 -PullOnly
param(
  [string]$Message = "",
  [string]$Trailer = "",
  [switch]$PullOnly
)
$ErrorActionPreference = 'Stop'
$Site = 'https://collinsst10-cmyk.github.io/curriculum/'
Set-Location $PSScriptRoot

function Invoke-Git {
  & git @args
  if ($LASTEXITCODE -ne 0) { throw "git $($args -join ' ') 실패 (코드 $LASTEXITCODE)" }
}
function Get-Count([string]$range) { [int](git rev-list --count $range) }

if (-not (Test-Path (Join-Path $PSScriptRoot '.git'))) { throw '이 폴더가 GitHub 저장소와 연결되어 있지 않습니다.' }

# ① 이 PC의 변경 사항 커밋 (가져오기만 할 때는 커밋하지 않고 잠시 보관했다가 되돌림)
if (-not $PullOnly) {
  Invoke-Git add -A
  $changes = git status --porcelain
  if ($changes) {
    Write-Host '이 PC에서 바뀐 파일:'; $changes | ForEach-Object { Write-Host "  $_" }
    if (-not $Message) { $Message = '수정 ' + (Get-Date -Format 'yyyy-MM-dd HH:mm') }
    if ($Trailer) { Invoke-Git commit -q -m $Message -m $Trailer } else { Invoke-Git commit -q -m $Message }
  }
}

# ② GitHub의 새 변경 가져오기
Invoke-Git fetch -q origin
$behind = Get-Count 'HEAD..origin/main'
if ($behind -gt 0) {
  Write-Host ''
  Write-Host "GitHub에 새 변경 $behind 건이 있어 가져옵니다:"
  git log --oneline 'HEAD..origin/main' | ForEach-Object { Write-Host "  $_" }
  & git pull -q --rebase --autostash origin main
  if ($LASTEXITCODE -ne 0) {
    & git rebase --abort 2>$null
    Write-Host ''
    Write-Host '⛔ 같은 파일의 같은 부분을 이 PC와 GitHub 양쪽에서 고쳐서 자동으로 합칠 수 없습니다.'
    Write-Host '   이 PC의 파일은 원래 상태 그대로 두었습니다. Claude에게 "충돌 해결해 줘"라고 요청하세요.'
    exit 1
  }
  Write-Host '가져오기 완료.'
} else { Write-Host 'GitHub에 새 변경 없음.' }

if ($PullOnly) { Write-Host ''; Write-Host '가져오기만 했습니다. (올리지 않음)'; return }

# ③ GitHub에 올리기
$ahead = Get-Count 'origin/main..HEAD'
if ($ahead -eq 0) { Write-Host ''; Write-Host '올릴 변경이 없습니다. 이 PC와 GitHub가 같은 상태입니다.'; return }
Invoke-Git push -q origin main
Write-Host ''
Write-Host "올리기 완료 ($ahead 건). 1~2분 뒤 $Site 에 반영됩니다."
