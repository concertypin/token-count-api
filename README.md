# token-count-api

Markdown 문서를 넣었을 때 각 LLM 공급자가 **실제로 추가로 과금할 토큰 수**를 세어주는 API 서버.

- 로컬 토크나이저(DeepSeek / GLM / Kimi)는 공식 토크나이저 파일을 그대로 실행 → `approximate`로 표시
- 리모트 카운터(OpenAI / Gemini)는 공식 API를 호출하고, 리모트가 몰래 붙이는 고정 오버헤드를 오프셋으로 빼서 **문서가 추가하는 순수 토큰 수**를 반환

## 지원 모델

| key | 방식 | 비고 |
|---|---|---|
| `deepseek-v4` | 로컬 | 공식 DeepSeek-V4-Pro tokenizer.json |
| `glm-5.2` | 로컬 | 공식 zai-org/GLM-5.2 tokenizer.json |
| `kimi-k3` | 로컬 | 공식 moonshotai/Kimi-K3 tiktoken.model + pat_str |
| `gemini-3.6-flash` | 리모트 | Google countTokens (GEMINI_API_KEY 필요) |
| `gpt` | 리모트 | OpenAI input_tokens (OPENAI_API_KEY 필요) · o200k_base |

Claude는 공개 토크나이저가 없어 미지원입니다.

## API

### GET /count

쿼리 파라미터로 텍스트 전달.

```
GET /count?models=deepseek-v4,gpt&text=hello%20world
```

### POST /count

본문으로 마크다운 전달. `Content-Type: text/markdown` 필수.

```sh
curl -X POST 'https://<host>/count?models=gpt' \
  -H 'Content-Type: text/markdown' \
  -d '# 제목

본문 내용'
```

### 응답

```json
{
  "input": { "chars": 11, "bytes": 11 },
  "counts": { "gpt": 2 },
  "offset": { "gpt": 6 },
  "approximate": []
}
```

- `counts` — 각 모델에서 **문서가 추가하는 토큰 수** (리모트 오버헤드 제거됨)
- `offset` — 리모트 카운터에서 감지된 고정 오버헤드 (시스템 프롬프트 래핑 등)
- `approximate` — 로컬 토크나이저로 추정한 모델 키 목록

### GET /models

지원 모델과 카운팅 방식을 반환.

### GET /docs

Scalar 기반 OpenAPI 문서.

## 로컬 실행

```sh
# Node 26+ / pnpm 10.17.1
pnpm install
pnpm run dev          # http://localhost:8080

# Python worker 의존성 (uv 사용 시)
cd python && uv sync && cd ..
```

리모트 카운터를 쓰려면 `.env`에 키를 넣으세요 (`.env.example` 참고):

```sh
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AIza...
```

## 테스트 / 린트

```sh
pnpm run lint:check
pnpm run test
pnpm run build
```

## 배포 (Heroku)

빌드팩 순서가 중요합니다: `heroku/nodejs` → `heroku/python`

```sh
heroku create token-count-api
heroku buildpacks:add heroku/nodejs
heroku buildpacks:add heroku/python
heroku config:set OPENAI_API_KEY=... GEMINI_API_KEY=...
git push heroku main
```

`Procfile`이 `node dist/server.js`로 실행하고, Python 빌드팩이 worker 의존성(tiktoken, tokenizers)을 설치합니다.

## 구조

```text
src/
  index.ts      Hono 앱 + OpenAPI
  route.ts      /count, /models 라우트
  counters.ts   모델 레지스트리 + 오프셋 계산
  python.ts     Python worker stdio 브리지
  server.ts     Node 진입점 (Heroku)
python/
  worker.py     tiktoken / tokenizers 기반 로컬 카운터
tokenizers/     공식 토크나이저 파일 (deepseek, glm, kimi)
```

## 라이선스

MIT
