"""개인 단어장 퀴즈 서버.

실행:  uvicorn app:app --reload   →  http://127.0.0.1:8000
자체검사: python app.py --selftest
"""
import functools
import json
import os
import pathlib
import random
import re
import sys
import uuid

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

load_dotenv()
ROOT = pathlib.Path(__file__).parent
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)
WRONG = DATA / "_wrong.json"          # 오답노트 (파일명 _ 로 시작 → 단어장 목록에서 제외)
MODEL = "gemini-flash-latest"          # 구글이 최신 flash로 알아서 연결해주는 이름

app = FastAPI(title="단어장")


# ---------------------------------------------------------------- Gemini

class Entry(BaseModel):
    unit: str
    en: str
    ko: str


@functools.lru_cache(maxsize=1)   # 만들자마자 버려지면 연결이 닫힌다 → 하나만 만들어 재사용
def _client():
    from google import genai
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        raise HTTPException(500, ".env 파일에 GEMINI_API_KEY=... 를 넣어주세요")
    return genai.Client(api_key=key)


PARSE_PROMPT = """이 PDF는 영어 단어장입니다. 모든 페이지의 모든 단어를 빠짐없이 추출하세요.

규칙:
- unit: 그 단어가 속한 유닛/챕터/DAY 이름 (예: "Unit 1", "DAY 03"). 표기가 없으면 "Unit 1".
- en: 영단어 하나 (품사표시·번호·발음기호 제외).
- ko: 한글 뜻. 여러 개면 쉼표로 구분.
- 예문, 목차, 페이지 번호는 제외하고 표제어만 추출.
"""


def pdf_text(pdf: bytes) -> str:
    """PDF에서 글자를 직접 뽑는다. 스캔본(이미지)이면 빈 문자열에 가깝다."""
    import pymupdf
    with pymupdf.open(stream=pdf, filetype="pdf") as doc:
        return "\n".join(p.get_text() for p in doc)


def group(entries):
    """[{unit,en,ko}] -> {unit: [{en,ko}]}. 순서 유지, 유닛 내 중복 en 제거, 빈 값 버림."""
    out = {}
    for e in entries:
        unit = (e.get("unit") or "").strip() or "Unit 1"
        en = (e.get("en") or "").strip()
        ko = (e.get("ko") or "").strip()
        if not en or not ko:
            continue
        words = out.setdefault(unit, [])
        if not any(w["en"].lower() == en.lower() for w in words):
            words.append({"en": en, "ko": ko})
    return {u: w for u, w in out.items() if w}


# ---------------------------------------------------------------- 저장소

def _path(book_id):
    if not re.fullmatch(r"[0-9a-f]{8,32}", book_id):   # 경로 조작 차단
        raise HTTPException(404, "없는 단어장입니다")
    p = DATA / f"{book_id}.json"
    if not p.exists():
        raise HTTPException(404, "없는 단어장입니다")
    return p


def _load(book_id):
    return json.loads(_path(book_id).read_text("utf-8"))


# ---------------------------------------------------------------- API

@app.get("/api/books")
def list_books():
    books = []
    for p in DATA.glob("*.json"):
        if p.name.startswith("_"):
            continue
        b = json.loads(p.read_text("utf-8"))
        books.append({
            "id": b["id"],
            "name": b["name"],
            "units": len(b["units"]),
            "words": sum(len(w) for w in b["units"].values()),
        })
    return sorted(books, key=lambda b: b["name"])


@app.get("/api/books/{book_id}")
def get_book(book_id: str):
    return _load(book_id)


@app.delete("/api/books/{book_id}")
def delete_book(book_id: str):
    _path(book_id).unlink()
    return {"ok": True}


@app.post("/api/books")
async def upload_book(file: UploadFile):
    """PDF 1회 파싱 → JSON 영구 저장. 이후 퀴즈는 PDF를 다시 읽지 않는다."""
    from google.genai import types

    pdf = await file.read()
    if not pdf:
        raise HTTPException(400, "빈 파일입니다")
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(400, "PDF 파일만 업로드할 수 있습니다")

    # PDF를 통째로 넘기면 Gemini가 페이지를 이미지로 처리해 느리고 무겁다.
    # 글자가 들어있는 PDF면 먼저 뽑아서 텍스트만 넘긴다. 스캔본이면 원본을 넘긴다.
    text = pdf_text(pdf)
    if len(text.strip()) < 200:
        contents = [types.Part.from_bytes(data=pdf, mime_type="application/pdf"),
                    PARSE_PROMPT]
    else:
        contents = [PARSE_PROMPT + "\n\n--- 단어장 내용 ---\n" + text]

    try:
        r = _client().models.generate_content(
            model=MODEL,
            contents=contents,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=list[Entry],
                max_output_tokens=60000,
                thinking_config=types.ThinkingConfig(thinking_budget=0),
            ),
        )
        units = group(json.loads(r.text or "[]"))
    except HTTPException:
        raise
    except Exception as e:
        # ponytail: 큰 PDF는 출력 토큰 한도에 걸려 뒷부분이 잘릴 수 있음.
        # 그럴 땐 PDF를 나눠 올리면 됨. 페이지 단위 분할 호출은 필요해지면 추가.
        raise HTTPException(502, f"PDF 분석에 실패했습니다: {e}")

    if not units:
        raise HTTPException(422, "단어를 찾지 못했습니다. 다른 PDF로 시도해주세요")

    book_id = uuid.uuid4().hex[:12]
    name = re.sub(r"\.pdf$", "", file.filename or "단어장", flags=re.I)
    book = {"id": book_id, "name": name, "units": units}
    (DATA / f"{book_id}.json").write_text(
        json.dumps(book, ensure_ascii=False, indent=1), "utf-8")
    return book


class DistractorReq(BaseModel):
    answer: str          # 정답 영단어
    meaning: str         # 한글 뜻 (프롬프트 힌트용)
    pool: list[str] = []  # 같은 유닛 단어들 (API 실패 시 대체용)


def _fallback(answer, pool):
    """Gemini 실패 시: 같은 유닛에서 길이·첫글자가 비슷한 단어 우선으로 3개."""
    cands = [w for w in pool if w.lower() != answer.lower()]
    random.shuffle(cands)
    cands.sort(key=lambda w: (w[:1].lower() != answer[:1].lower(),
                              abs(len(w) - len(answer))))
    out = cands[:3]
    while len(out) < 3:                      # 유닛 단어가 모자랄 때
        out.append(answer[:-1] + random.choice("aeioustr") + "e")
    return out[:3]


@app.post("/api/distractors")
def distractors(req: DistractorReq):
    """문제를 낼 때마다 실시간 호출 → 매번 다른 헷갈리는 오답 3개."""
    from google.genai import types

    prompt = (
        f'영단어 "{req.answer}" (뜻: {req.meaning}) 의 객관식 오답 선지 3개를 만들어줘.\n'
        "- 실제 존재하는 영단어일 것\n"
        "- 철자·발음·형태가 비슷해서 헷갈릴 것 (예: adapt/adopt/adept)\n"
        f'- "{req.answer}" 와 뜻이 같거나 비슷하면 안 됨\n'
        "- 매번 다른 조합으로 다채롭게\n"
        "영단어 3개만 JSON 배열로."
    )
    try:
        r = _client().models.generate_content(
            model=MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=list[str],
                temperature=1.4,
                thinking_config=types.ThinkingConfig(thinking_budget=0),
            ),
        )
        words = [w.strip() for w in json.loads(r.text or "[]") if w.strip()]
        words = [w for w in words if w.lower() != req.answer.lower()][:3]
        if len(words) < 3:
            words += _fallback(req.answer, req.pool)
        return {"distractors": words[:3]}
    except Exception:
        return {"distractors": _fallback(req.answer, req.pool)}


# ---------------------------------------------------------------- 오답노트

class WrongWord(BaseModel):
    en: str
    ko: str


def _wrong_all():
    # ponytail: 통째로 읽고 쓰기. 혼자 쓰는 서비스라 동시 쓰기 걱정 없음.
    return json.loads(WRONG.read_text("utf-8")) if WRONG.exists() else {}


def _wrong_save(d):
    WRONG.write_text(json.dumps(d, ensure_ascii=False, indent=1), "utf-8")


@app.get("/api/wrong")
def wrong_list():
    """틀린 순서 최신순."""
    return list(reversed(list(_wrong_all().values())))


@app.post("/api/wrong")
def wrong_add(w: WrongWord):
    d = _wrong_all()
    key = w.en.strip().lower()
    if not key:
        raise HTTPException(400, "단어가 비었습니다")
    d.pop(key, None)                      # 다시 틀리면 맨 위로
    d[key] = {"en": w.en.strip(), "ko": w.ko.strip()}
    _wrong_save(d)
    return {"ok": True, "count": len(d)}


@app.delete("/api/wrong/{en}")
def wrong_del(en: str):
    d = _wrong_all()
    if en.strip().lower() == "*":
        d = {}
    else:
        d.pop(en.strip().lower(), None)
    _wrong_save(d)
    return {"ok": True, "count": len(d)}


app.mount("/", StaticFiles(directory=ROOT / "static", html=True), name="static")


# ---------------------------------------------------------------- 자체검사

def _selftest():
    g = group([
        {"unit": "Unit 1", "en": "adapt", "ko": "적응하다"},
        {"unit": "Unit 1", "en": "Adapt", "ko": "중복"},      # 중복 제거
        {"unit": " Unit 1 ", "en": "adopt", "ko": "채택하다"},  # 공백 정규화
        {"unit": "", "en": "solo", "ko": "혼자의"},            # 기본 유닛
        {"unit": "Unit 2", "en": "", "ko": "빈 값"},           # 버림
    ])
    assert list(g) == ["Unit 1"], g
    assert [w["en"] for w in g["Unit 1"]] == ["adapt", "adopt", "solo"], g

    f = _fallback("adapt", ["adopt", "banana", "adept", "adapt"])
    assert len(f) == 3 and "adapt" not in f
    assert set(f[:2]) == {"adopt", "adept"}, f          # 첫글자·길이 유사 우선
    assert len(_fallback("go", [])) == 3                # 풀이 비어도 3개

    global WRONG
    WRONG = DATA / "_selftest.json"
    wrong_add(WrongWord(en="adapt", ko="적응하다"))
    wrong_add(WrongWord(en="solo", ko="혼자의"))
    wrong_add(WrongWord(en="Adapt", ko="적응하다"))       # 대소문자 무시 중복
    assert [w["en"] for w in wrong_list()] == ["Adapt", "solo"], wrong_list()
    wrong_del("SOLO")
    assert [w["en"] for w in wrong_list()] == ["Adapt"]
    wrong_del("*")
    assert wrong_list() == []
    WRONG.unlink()
    print("ok")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        _selftest()
    else:
        import uvicorn
        uvicorn.run("app:app", reload=True)
