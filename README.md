# 내 단어장

개인용 영단어 퀴즈 웹앱. 단어장 PDF를 올리면 AI가 한 번만 분석해서 저장하고,
이후에는 저장된 데이터로 유닛별 20문제 퀴즈를 푼다.

**배포된 주소:** https://word.lhj106147.workers.dev

## 퀴즈 규칙

- 유닛당 20문제. **정답을 맞히기 전에는 다음 문제로 못 넘어간다.**
- 1~10번: 한글 뜻 보고 영단어 4지선다. 오답 3개는 매 문제마다 AI가 새로 만든다.
- 11~20번: 영단어 보고 한글 뜻 직접 입력.
  - 뜻이 여러 개면 그중 하나만 써도, 쉼표로 몇 개를 같이 써도, 전부 써도 정답.
  - 맞히면 전체 뜻을 보여주고, 다음 버튼을 눌러야 넘어간다.
- 20문제 클리어 시 다음 유닛으로 이동.
- 틀린 단어는 오답노트에 자동 저장.

## 구조

| 파일 | 역할 |
|---|---|
| `static/index.html` | 화면 전체 (보관함 / 오답노트 / 유닛 선택 / 퀴즈) |
| `static/lib.mjs` | 순수 계산 함수 (글 나누기, 단어 묶기, 오답 선지, 채점) |
| `worker.js` | Cloudflare 배포판 서버 — 단어장/오답노트 저장 |
| `app.py` | PC용 서버 — worker.js와 같은 역할, 파일로 저장 |
| `wrangler.jsonc` | Cloudflare 설정 (저장소 KV 연결) |

PDF에서 글자를 뽑는 일과 AI 호출은 **브라우저가 직접** 한다.
Google 무료 API가 데이터센터에서 오는 호출을 막기 때문이고,
덕분에 API 키는 서버에 올라가지 않고 각자 브라우저에만 저장된다.

## 실행

**Cloudflare 배포**

```bash
npm install
npx wrangler secret put APP_PASSWORD    # 접속 비밀번호
npx wrangler deploy
```

**PC에서 실행**

```bash
pip install -r requirements.txt
python app.py                            # http://127.0.0.1:8000
```

처음 열면 브라우저가 Google AI Studio API 키를 한 번 물어본다
(https://aistudio.google.com 에서 무료 발급). 이후에는 그 브라우저에 저장된다.

## 자체검사

```bash
node worker.test.mjs     # 채점·묶기·나누기·서버 검증
python app.py --selftest # PC 서버
```
