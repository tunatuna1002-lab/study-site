# One-time setup on Windows: install tools, clone, install, GitHub login, link the study-log skill.
# Usage (PowerShell):
#   powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
# or before cloning:
#   irm https://raw.githubusercontent.com/tunatuna1002-lab/study-site/main/scripts/setup-windows.ps1 -OutFile $env:TEMP\setup.ps1
#   powershell -ExecutionPolicy Bypass -File $env:TEMP\setup.ps1
$ErrorActionPreference = 'Stop'

$Repo = if ($env:STUDY_SITE_DIR) { $env:STUDY_SITE_DIR } else { Join-Path $HOME 'DEV\study-site' }
$Url = 'https://github.com/tunatuna1002-lab/study-site.git'

function Refresh-Path {
	$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
function Need($cmd, $wingetId) {
	if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
		Write-Host "설치: $wingetId"
		winget install --id $wingetId -e --accept-source-agreements --accept-package-agreements
		Refresh-Path
		if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "$cmd 설치 후에도 찾을 수 없습니다. 새 PowerShell 창에서 다시 실행하세요." }
	}
}

Need git 'Git.Git'
Need node 'OpenJS.NodeJS.LTS'
Need gh 'GitHub.cli'
if ([int](node -p "process.versions.node.split('.')[0]") -lt 22) { throw 'Node 22 이상이 필요합니다.' }

if ($Repo -like '*OneDrive*') { throw "OneDrive 폴더 밖에 두세요: $Repo" }

if (-not (Test-Path (Join-Path $Repo '.git'))) {
	New-Item -ItemType Directory -Force -Path (Split-Path $Repo) | Out-Null
	git clone $Url $Repo
	if ($LASTEXITCODE -ne 0) { throw 'git clone 실패' }
}
git -C $Repo config core.autocrlf false
Push-Location $Repo
try {
	npm install
	if ($LASTEXITCODE -ne 0) { throw 'npm install 실패' }
} finally { Pop-Location }

gh auth status *> $null
if ($LASTEXITCODE -ne 0) {
	gh auth login --hostname github.com --git-protocol https --web
	if ($LASTEXITCODE -ne 0) { throw 'GitHub 로그인 실패' }
}
gh auth setup-git
if ($LASTEXITCODE -ne 0) { throw 'gh auth setup-git 실패' }

# Public repo: commit with the GitHub noreply address, not a personal email.
$LocalEmail = git -C $Repo config --local user.email
if (-not $LocalEmail) {
	$Login = gh api user --jq .login
	$Id = gh api user --jq .id
	git -C $Repo config user.email "$Id+$Login@users.noreply.github.com"
	git -C $Repo config user.name $Login
}

$Skills = Join-Path $HOME '.claude\skills'
New-Item -ItemType Directory -Force -Path $Skills | Out-Null
$Link = Join-Path $Skills 'study-log'
# Get-Item (not Test-Path) so a broken junction is found too.
$Existing = Get-Item $Link -Force -ErrorAction SilentlyContinue
if ($Existing) {
	if ($Existing.LinkType) { cmd /c rmdir "$Link" | Out-Null }
	else { throw "이미 실제 폴더가 있습니다: $Link (직접 확인 후 지우고 다시 실행)" }
}
New-Item -ItemType Junction -Path $Link -Target (Join-Path $Repo 'skills\study-log') | Out-Null

node (Join-Path $Link 'run.mjs') root | Out-Null
if ($LASTEXITCODE -ne 0) { throw '스킬 연결 확인 실패' }
Write-Host "완료: $Repo"
Write-Host 'Obsidian에서 이 폴더를 볼트로 열고 docs/setup.md 의 Obsidian Git 설정을 하세요.'
