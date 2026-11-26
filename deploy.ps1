# 용원초등학교 교육과정 편성 도우미 - GitHub Pages 배포
#  사용법: 배포하기.cmd 더블클릭  (또는 PowerShell 에서 .\deploy.ps1 -Message "변경 내용")
#  - 웹에 필요한 파일만 골라 GitHub 저장소에 올립니다. 1~2분 뒤 사이트에 반영됩니다.
#  - 작업용 사본은 %LOCALAPPDATA%\curriculum-deploy 에 둡니다(OneDrive 동기화와 분리).
param(
  [string]$Message = "",
  [string]$Trailer = ""
)
$ErrorActionPreference = 'Stop'
$Repo  = 'https://github.com/collinsst10-cmyk/curriculum.git'   # 저장소 소유자 또는 공동작업자 계정으로 올림
$Site  = 'https://collinsst10-cmyk.github.io/curriculum/'
$Src   = $PSScriptRoot
$Work  = Join-Path $env:LOCALAPPDATA 'curriculum-deploy'
$Files = 'index.html', 'style.css', 'data.js', 'app.js', 'features.js', 'cloud.js', 'cloud-config.js', 'activities.js',
         'firestore.rules', 'README.md', 'deploy.ps1', '배포하기.cmd', '클라우드_설정_안내.md'

function Invoke-Git {
  & git @args
  if ($LASTEXITCODE -ne 0) { throw "git $($args -join ' ') 실패 (코드 $LASTEXITCODE)" }
}

if (-not (Test-Path (Join-Path $Work '.git'))) {
  Write-Host '처음 배포: 저장소를 내려받습니다...'
  Invoke-Git clone $Repo $Work
}

Push-Location $Work
try {
  Invoke-Git remote set-url origin $Repo
  Invoke-Git config user.name 'collinsst10-cmyk'
  Invoke-Git config user.email 'collinsst10-cmyk@users.noreply.github.com'
  Invoke-Git config core.quotepath false
  Invoke-Git config core.autocrlf false
  # 작업용 사본은 프로젝트 폴더의 거울일 뿐이므로 항상 GitHub 최신 상태로 맞춘 뒤 파일을 덮어씀
  Invoke-Git fetch origin
  Invoke-Git reset --hard origin/main

  foreach ($f in $Files) { Copy-Item (Join-Path $Src $f) $Work -Force }
  New-Item -ItemType Directory -Force (Join-Path $Work 'assets') | Out-Null
  Copy-Item (Join-Path $Src 'assets\*') (Join-Path $Work 'assets') -Force

  Invoke-Git add -A
  $changes = git status --porcelain
  $ahead = [int](git rev-list --count '@{u}..HEAD')
  if (-not $changes -and $ahead -eq 0) { Write-Host '바뀐 파일이 없어 배포할 것이 없습니다.'; return }
  if ($changes) {
    Write-Host '올릴 변경 사항:'; $changes | ForEach-Object { Write-Host "  $_" }
    if (-not $Message) { $Message = '배포 ' + (Get-Date -Format 'yyyy-MM-dd HH:mm') }
    if ($Trailer) { Invoke-Git commit -m $Message -m $Trailer } else { Invoke-Git commit -m $Message }
  } else { Write-Host '이전에 올리지 못한 변경 사항을 올립니다.' }
  Invoke-Git push
  Write-Host ''
  Write-Host "배포 완료. 1~2분 뒤 $Site 에 반영됩니다."
}
finally { Pop-Location }
