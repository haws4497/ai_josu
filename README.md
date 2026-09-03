# AI 사장님 비서 V1

리뷰 기능을 제외한 소상공인용 AI 비서 MVP입니다.

## 기능

- 랜딩/대시보드 UI
- 사업장 프로필 저장(localStorage)
- AI 채팅
- 홍보글/상품 설명/고객 안내/마케팅 아이디어 빠른 기능
- OpenAI API 연결
- API 키가 없을 때 DEMO 모드
- 회원가입·로그인·로그아웃 및 영속 세션
- AI 채팅에서 일정 초안을 만들고 개인 일정표에 저장

## 실행

Node.js 18+ 권장.

```bash
npm install
```

`.env.example`을 복사해서 `.env`를 만들고 OpenAI API 키를 입력합니다.

```bash
npm start
```

브라우저에서:

http://localhost:3000

## 인증 및 데이터베이스

- 사용자와 로그인 세션은 프로젝트 폴더의 `data.sqlite`에 저장됩니다. Node.js 22.5 이상이 필요합니다.
- 비밀번호는 Node.js `scrypt`로 해시화되며, 평문 비밀번호는 저장하지 않습니다.
- 세션은 HTTP 전용 쿠키로 30일 유지됩니다. 운영 환경에서는 반드시 HTTPS와 `NODE_ENV=production`을 사용하세요.
- `/login`, `/register`, `/forgot-password`, `/profile` 페이지를 제공합니다. `/profile`은 로그인 후에만 열립니다.
- 현재 비밀번호 찾기는 메일 발송 서비스가 연결되지 않은 상태라 안내 메시지만 반환합니다. 실제 재설정 메일을 보내려면 메일 서비스와 재설정 화면을 연결해야 합니다.
- `OPENAI_API_KEY`를 설정하면 GPT가 복잡한 한국어 일정 문장을 구조화합니다. 키가 없거나 AI 요청에 실패하면 오늘·내일·모레와 날짜·시간 표현을 인식하는 규칙 기반 방식으로 동작합니다.

### 인증 API

| API | 인증 | 성공 응답 | 대표 오류 |
| --- | --- | --- | --- |
| `GET /api/auth/csrf` | 불필요 | CSRF 토큰 (`200`) | - |
| `POST /api/auth/register` | CSRF 토큰 | 사용자 정보 (`201`) | 입력 오류 `400`, 중복 `409` |
| `POST /api/auth/login` | CSRF 토큰 | 사용자 정보·새 CSRF 토큰 (`200`) | 입력 오류 `400`, 인증 실패 `401` |
| `POST /api/auth/logout` | 로그인·CSRF 토큰 | 완료 메시지 (`200`) | CSRF 오류 `403` |
| `GET /api/auth/me` | 로그인 | 사용자 정보 (`200`) | 미인증 `401` |
| `POST /api/auth/forgot-password` | CSRF 토큰 | 일반 안내 메시지 (`200`) | 입력 오류 `400` |

`POST` 요청은 `Content-Type: application/json`과 `X-CSRF-Token` 헤더가 필요합니다. CSRF 토큰은 `GET /api/auth/csrf` 또는 로그인·내 정보 응답에서 받습니다.

## 주의

- `.env` 파일은 GitHub에 올리지 마세요.
- 이 V1의 사업장 정보는 브라우저 localStorage에만 저장됩니다.
- 실제 서비스에서는 Supabase 같은 DB와 로그인 시스템을 추가해야 합니다.
- API 키를 브라우저 JavaScript에 직접 넣지 않고 서버에서 사용하도록 구성했습니다.
