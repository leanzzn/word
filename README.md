# 내 단어장

개인용 영단어 퀴즈 웹앱. PDF 단어장을 올리면 Gemini가 한 번만 분석해서 저장하고,
이후에는 저장된 데이터로 유닛별 20문제 퀴즈를 푼다.

## 실행

```bash
pip install -r requirements.txt
cp .env.example .env        # GEMINI_API_KEY 입력 (https://aistudio.google.com)
python app.py               # http://127.0.0.1:8000
```

## 퀴즈 규칙

- 유닛당 20문제. **정답을 맞히기 전에는 다음 문제로 못 넘어간다.**
- 1~10번: 한글 뜻 보고 영단어 4지선다. 오답 3개는 매번 Gemini가 실시간으로 만든다.
- 11~20번: 영단어 보고 한글 뜻 직접 입력.
- 20문제 클리어 시 다음 유닛으로 이동.
- 틀린 단어는 오답노트에 자동 저장.

## 구조

| 파일 | 역할 |
|---|---|
| `app.py` | 서버 전체 (PDF 파싱, 단어장 저장소, 오답 생성, 오답노트) |
| `static/index.html` | 화면 전체 (보관함 / 오답노트 / 유닛 선택 / 퀴즈) |
| `data/` | 단어장 JSON + 오답노트 (gitignore) |

PDF는 먼저 PyMuPDF로 글자만 뽑아서 Gemini에 넘긴다 (빠르고 토큰 절약).
글자가 없는 스캔본이면 PDF 원본을 그대로 넘긴다.

자체검사: `python app.py --selftest`
