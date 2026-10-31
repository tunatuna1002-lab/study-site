#!/usr/bin/env bash
# One-time setup on a Mac: clone, install, GitHub login, link the study-log skill.
# Usage: bash scripts/setup-mac.sh   (or curl the file and run it before cloning)
set -euo pipefail

REPO="${STUDY_SITE_DIR:-$HOME/DEV/study-site}"
URL="https://github.com/tunatuna1002-lab/study-site.git"

need() { command -v "$1" >/dev/null || { echo "필요: $1 ($2)"; exit 1; }; }
need git "xcode-select --install"
need node "https://nodejs.org 에서 LTS 설치 (22 이상)"
need gh "brew install gh"
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || { echo "Node 22 이상이 필요합니다."; exit 1; }

case "$REPO" in *"Mobile Documents"*|*iCloud*) echo "iCloud 폴더 밖에 두세요: $REPO"; exit 1;; esac

if [ ! -d "$REPO/.git" ]; then
	mkdir -p "$(dirname "$REPO")"
	git clone "$URL" "$REPO"
fi
(cd "$REPO" && npm install)

gh auth status >/dev/null 2>&1 || gh auth login --hostname github.com --git-protocol https --web
gh auth setup-git

# Public repo: commit with the GitHub noreply address, not a personal email.
if [ -z "$(git -C "$REPO" config --local user.email || true)" ]; then
	git -C "$REPO" config user.email "$(gh api user --jq '"\(.id)+\(.login)@users.noreply.github.com"')"
	git -C "$REPO" config user.name "$(gh api user --jq .login)"
fi
git -C "$REPO" config core.precomposeunicode true

mkdir -p "$HOME/.claude/skills"
LINK="$HOME/.claude/skills/study-log"
if [ -e "$LINK" ] && [ ! -L "$LINK" ]; then
	echo "이미 실제 폴더가 있습니다: $LINK (직접 확인 후 지우고 다시 실행)"
	exit 1
fi
ln -sfn "$REPO/skills/study-log" "$LINK"

node "$LINK/run.mjs" root >/dev/null
echo "완료: $REPO"
echo "Obsidian에서 이 폴더를 볼트로 열고 docs/setup.md 의 Obsidian Git 설정을 하세요."
