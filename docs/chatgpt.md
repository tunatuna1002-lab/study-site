# ChatGPT에서 논문 공부 기록하기

일반 ChatGPT 채팅 또는 프로젝트에서 논문을 공부한다. `study-site` 플러그인을 선택한 대화에서 다음 두 명령을 사용한다.

- **기록해 줘:** 내용을 한국어 학습 노트로 정리하고 비공개 저장한다.
- **올려:** 방금 확인한 초안 버전만 기존 GitHub 저장소와 사이트에 공개한다.

## 저장 위치

- Obsidian 초안: `vault/drafts/<초안 ID>/note.md`. `.gitignore`로 제외하며 사이트 컬렉션에도 포함하지 않는다.
- 초안 버전·공개 상태: Git 내부의 `study-log/chat-drafts/`. 공개 저장소에 들어가지 않는다.
- 공개 승인 후: `vault/sessions/YYYY-MM-DD-<slug>-<ID>.md` 및 해당 위젯.

현재 연결은 Mac에서 실행된다. 저장·공개할 때 Mac과 터널이 온라인이어야 한다. 이미 배포된 사이트는 Mac이 꺼져도 동작한다. 공개 전 초안은 다른 컴퓨터로 자동 전송하지 않는다. 공개한 기록은 기존 Obsidian Git 자동 받기로 동기화한다. 초안은 로컬 저장이며 별도 클라우드 백업이 아니다.

## 연결 준비

1. 저장소에서 `npm ci`와 `npm test`, `npm run build`를 실행한다.
2. OpenAI 공식 [Secure MCP Tunnel 안내](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)에 따라 [Platform Tunnels](https://platform.openai.com/settings/organization/tunnels)에서 개인 터널을 만든다. 사용할 ChatGPT 워크스페이스와 연결한다.
3. 런타임 키에는 Tunnels **Read + Use** 권한이 필요하다. 관리용 키를 상시 실행에 사용하지 않는다. 키는 채팅·저장소·명령 인수에 넣지 않는다.
4. [OpenAI tunnel-client 공식 릴리스](https://github.com/openai/tunnel-client/releases/latest)에서 운영체제용 바이너리를 내려받아 릴리스의 SHA-256과 대조하고 `.local-tools/tunnel-client`에 둔다. 이 디렉터리는 Git에서 제외된다.
5. 사용자 터미널에서 아래 명령을 실행한다. 처음에는 키를 화면에 표시하지 않는 입력란으로 받는다. 키 파일은 Git 내부에 권한 `600`으로 저장하고, 프로필에는 파일 참조만 넣는다.

   ```bash
   cd ~/DEV/study-site
   bash scripts/connect-chatgpt.sh tunnel_<발급받은 ID>
   ```

6. 반환 상태의 `process_running`, `healthy`, `ready`를 확인한다. 준비되지 않았으면 연결 완료로 판단하지 않는다.
7. [ChatGPT Plugins](https://chatgpt.com/plugins) → `+` → Add custom MCP server → Connection: **Tunnel**에서 같은 터널을 선택한다. 개인용 `study-site`라는 이름으로 등록한다. 이 서버는 터널의 워크스페이스 접근 제어를 사용하고 공개 HTTP 포트를 열지 않는다.
8. 플러그인을 설치한 후 새 일반 채팅에서 `@study-site`를 선택하고 저장된 초안 목록 조회부터 시험한다. 프로젝트에서도 실제 사용하려는 대화에서 도구가 제공되는지 확인한다.

등록 화면·권한은 계정에 따라 다를 수 있다. 실제 ChatGPT에서 도구 호출이 성공한 뒤에만 연결 완료다. 로컬 MCP 테스트 통과만으로 계정 연결이 끝난 것은 아니다.

## 기록 규칙

기록 도구 자체에 저장·공개 분리 지침이 포함되어 있다. 더 상세한 재사용 지침은 `skills/study-log-chatgpt/SKILL.md`에 있다. 계정의 Plugin Creator가 제공되면 이 스킬을 연결된 `study-site` 플러그인과 함께 등록할 수 있다. 로컬 스킬 폴더만 만들었다고 ChatGPT 웹에 자동 설치되지는 않는다.

- 공부 시간은 이미 말했으면 재사용한다. 모르면 한 번 묻고, 사용자가 모른다고 하면 비워 둔다.
- 대화 원문을 공개하지 않는다. 논문 출처, 이해한 내용, 바로잡은 점과 남은 질문을 정리한다.
- 수정한 초안에는 새 revision이 생긴다. 이전 버전 승인으로 새 버전을 공개할 수 없다.
- Obsidian에서 초안을 수정하면 공개를 중단하고 해당 변경을 새 초안으로 반영하도록 안내한다.
- `취소`는 미공개 초안을 취소 상태로 남긴다. 비공개 사본은 복구를 위해 보존한다.
- 공개 검사 오류를 피해 GitHub에 직접 파일을 쓰지 않는다.

## 공개 도구의 실패 처리

- 로컬 main에 미전송 커밋이 있으면 자동 공개하지 않는다. 기존 커밋을 별도로 검토해야 한다.
- 이번 공개의 push가 실패하고 원격에서 미반영임을 확인하면 이번 커밋만 초안으로 되돌린다.
- 네트워크 장애로 원격 반영 여부를 확인하지 못하면 대기 상태를 남긴다. 다음 동기화·공개·취소에서 원격 상태를 먼저 확인한다.
- 배포는 `study-log-manifest.json`의 파일 해시로 확인한다. 제목이 같은 이전 페이지는 성공으로 간주하지 않는다.
- 강제 종료 뒤 잠금이 남으면 실제 실행 중인 기록 프로세스가 없는지 확인한 후 Git 내부 `study-log/operation.lock` 또는 `study-log/chat-drafts/operation.lock`을 복구한다. 실행 중인 프로세스의 잠금을 지우지 않는다.

위젯 검사는 정규식 검사도 포함하므로 임의의 악성 JavaScript를 완전히 판별하는 보안 경계는 아니다. 공개 전 초안·위젯 확인 절차를 유지한다.
