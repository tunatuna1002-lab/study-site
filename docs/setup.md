# 설치와 사용

study-site 폴더 하나가 세 가지 역할을 합니다.

- Obsidian 볼트
- 블로그 원본 (GitHub에 push하면 Cloudflare Pages가 배포)
- study-log 스킬의 원본 (`skills/study-log/`)

컴퓨터마다 한 번 설치합니다. 맥과 Windows 모두 폴더는 `~/DEV/study-site`(Windows: `C:\Users\<이름>\DEV\study-site`)입니다. iCloud·OneDrive 폴더 안에 두지 않습니다. 동기화 프로그램과 git이 같은 파일을 동시에 고치면 저장소가 깨지기 때문입니다.

## 1. 설치

### Windows

PowerShell을 열고 아래를 실행합니다. Git, Node.js, GitHub CLI가 없으면 winget으로 설치합니다.

```powershell
irm https://raw.githubusercontent.com/tunatuna1002-lab/study-site/main/scripts/setup-windows.ps1 -OutFile $env:TEMP\setup.ps1
powershell -ExecutionPolicy Bypass -File $env:TEMP\setup.ps1
```

중간에 GitHub 로그인 창이 열리면 로그인하고 승인합니다. 끝나면 Claude 앱을 완전히 껐다 켭니다. 새로 설치한 Git·Node.js를 Claude가 찾게 하기 위해서입니다.

### 맥

```bash
curl -fsSL https://raw.githubusercontent.com/tunatuna1002-lab/study-site/main/scripts/setup-mac.sh | bash
```

스크립트가 하는 일:

1. 저장소를 `~/DEV/study-site`에 내려받고 `npm install`을 합니다.
2. GitHub에 로그인하고 git이 그 로그인을 쓰게 합니다(`gh auth setup-git`).
3. `~/.claude/skills/study-log`를 저장소의 `skills/study-log`에 연결합니다(맥: symlink, Windows: junction). 그래서 Claude 앱 Code 탭에서 어느 폴더로 작업하든 스킬이 뜹니다. 저장소에서 스킬을 고치면 두 컴퓨터에 같이 반영됩니다.

## 2. Obsidian

1. Obsidian에서 볼트 관리 → "폴더를 볼트로 열기"로 `DEV/study-site`를 엽니다. 설정(제외 폴더, 새 노트 위치, 첨부 위치)은 저장소의 `.obsidian/`에 있어 그대로 적용됩니다.
2. 설정 → 커뮤니티 플러그인 → 제한 모드 끄기 → 탐색에서 **Git**(Vinzent03 제작)을 설치하고 켭니다.
3. Git 플러그인 설정(영어 화면):

| 항목 | 값 | 이유 |
|---|---|---|
| Auto commit-and-sync interval | 0 (끔) | 켜면 공개 전 초안까지 공개 저장소에 올라갈 수 있음 |
| Auto commit-and-sync after stopping file edits | 끔 | 같은 이유 |
| Auto push interval | 0 (끔) | 공개는 Claude가 승인 후에만 함 |
| Auto pull interval | 10 | 다른 컴퓨터에서 올린 노트를 10분마다 받음 |
| Pull on startup | 켬 | Obsidian을 열 때 최신 노트를 받음 |
| Sync method (Merge strategy) | Rebase | 스킬과 같은 방식 |

플러그인 판에 따라 항목 이름이 조금 다를 수 있습니다. 원칙은 **받기만 자동, 올리기는 끔**입니다. 이 설정은 컴퓨터마다 따로 합니다.

## 3. 사용

Claude 앱 Code 탭에서 공부한 뒤 "기록해 줘"라고 합니다.

1. Claude가 공부 시간을 묻습니다.
2. Claude가 노트(와 위젯)를 볼트에 초안으로 씁니다. 초안은 git이 커밋하지 않게 잠깁니다. Obsidian에서 바로 보고 고칠 수 있습니다.
3. Claude가 검사(개인정보·비밀·외부 리소스)와 빌드를 하고 초안을 보고합니다.
4. "올려"라고 하면 Claude가 그 파일만 커밋해 push합니다. 1~2분 뒤 블로그에 뜨면 주소를 알려 줍니다.
5. "취소"라고 하면 초안을 지웁니다.

### claude.ai 채팅에서

채팅에서 공부한 뒤에도 "기록해 줘"라고 하면 됩니다. 계정에 저장한 `study-log-chat` 스킬이 같은 절차를 씁니다.

- 초안은 Obsidian이 아니라 채팅에 파일로 옵니다. 고칠 점은 채팅으로 말합니다.
- "올려"라고 하면 Code 탭과 같은 방식으로 올라갑니다.
- 맥 Obsidian에는 공개 뒤 자동 받기로 들어옵니다(10분 간격).

## 4. 문제가 생기면

- "최신 내용을 받지 못했습니다": 두 컴퓨터에서 같은 파일을 고쳤을 때 납니다. Claude에게 출력을 보여 주고 어떻게 할지 정합니다.
- 스킬이 안 뜸: 설치 스크립트를 다시 실행합니다. 저장소 폴더를 옮겼을 때도 다시 실행합니다.
- 배포가 안 됨: Cloudflare 대시보드 → Workers & Pages → study-site → 배포 기록을 봅니다.
