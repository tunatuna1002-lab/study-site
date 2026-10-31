# study-site

공부 기록용 공개 사이트. Astro + Obsidian 볼트(`vault/`) + KaTeX + 인터랙티브 위젯.

## 구조

```
vault/            옵시디언에서 쓰는 노트(.md만)
  sessions/       → /sessions/<slug>/
  concepts/       → /concepts/<slug>/
  essays/         → /essays/<slug>/
  attachments/
public/widgets/   위젯 HTML. 노트에서 <iframe src="/widgets/...">로 삽입
src/              Astro 코드
```

## 노트 규칙

- 프론트매터 `publish: true`인 노트만 빌드한다. 나머지는 검증 없이 건너뛴다.
- 필드: `title`, `type`(session|concept|essay), `date`, `minutes`, `topics`(위키링크), `stage`(0~8), `status`, `source`, `original`.
- `[[노트]]`, `[[노트|별칭]]`, `[[노트#제목]]` 위키링크를 지원한다. 공개되지 않은 노트로 가는 링크는 일반 글자로 보인다.
- 수식: `$...$`, `$$...$$`.

## 명령

| 명령 | 하는 일 |
| --- | --- |
| `npm install` | 의존성 설치 |
| `npm run dev` | 로컬 개발 서버 (`localhost:4321`) |
| `npm run build` | `dist/`에 정적 사이트 생성 |
| `npm run preview` | 빌드 결과 미리 보기 |

배포: Cloudflare Pages (빌드 `npm run build`, 출력 `dist`).
