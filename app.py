"""개인 단어장 퀴즈 서버 (PC용). Cloudflare 배포판(worker.js)과 같은 역할을 한다.

AI 호출과 PDF 글자 뽑기는 브라우저가 직접 한다. 이 서버는 단어장/오답노트를 파일로 보관만 한다.

실행:  python app.py        →  http://127.0.0.1:8000
자체검사: python app.py --selftest
"""
import json
import pathlib
import re
import sys
import uuid

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

ROOT = pathlib.Path(__file__).parent
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)
WRONG = DATA / "_wrong.json"          # 오답노트 (파일명 _ 로 시작 → 단어장 목록에서 제외)

app = FastAPI(title="단어장")


def clean(units):
    """받은 단어장을 검증·정리한다. 서버는 브라우저가 보낸 값을 그대로 믿지 않는다."""
    if not isinstance(units, dict):
        raise HTTPException(400, "단어장 형식이 올바르지 않습니다")
    out, total = {}, 0
    for unit, words in units.items():
        if not isinstance(words, list):
            continue
        rows = []
        for w in words:
            en = w.get("en", "").strip() if isinstance(w, dict) else ""
            ko = w.get("ko", "").strip() if isinstance(w, dict) else ""
            if not isinstance(en, str) or not isinstance(ko, str):
                continue
            if not en or not ko or total >= 20000:
                continue
            rows.append({"en": en[:80], "ko": ko[:300]})
            total += 1
        if rows:
            out[str(unit).strip()[:80] or "Unit 1"] = rows
    if not total:
        raise HTTPException(400, "단어가 하나도 없습니다")
    return out


def _path(book_id):
    if not re.fullmatch(r"[0-9a-f]{8,32}", book_id):   # 경로 조작 차단
        raise HTTPException(404, "없는 단어장입니다")
    p = DATA / f"{book_id}.json"
    if not p.exists():
        raise HTTPException(404, "없는 단어장입니다")
    return p


# ---------------------------------------------------------------- 단어장

class NewBook(BaseModel):
    name: str = "단어장"
    units: dict


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
    return json.loads(_path(book_id).read_text("utf-8"))


@app.delete("/api/books/{book_id}")
def delete_book(book_id: str):
    _path(book_id).unlink()
    return {"ok": True}


@app.post("/api/books")
def add_book(nb: NewBook):
    """브라우저가 AI로 정리해 보낸 단어장을 그대로 보관한다."""
    book_id = uuid.uuid4().hex[:12]
    name = re.sub(r"\.pdf$", "", nb.name, flags=re.I).strip()[:100] or "단어장"
    book = {"id": book_id, "name": name, "units": clean(nb.units)}
    (DATA / f"{book_id}.json").write_text(
        json.dumps(book, ensure_ascii=False, indent=1), "utf-8")
    return book


# ---------------------------------------------------------------- 오답노트

class WrongWord(BaseModel):
    en: str
    ko: str = ""


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
    key = w.en.strip().lower()
    if not key:
        raise HTTPException(400, "단어가 비었습니다")
    d = _wrong_all()
    d.pop(key, None)                      # 다시 틀리면 맨 위로
    d[key] = {"en": w.en.strip()[:80], "ko": w.ko.strip()[:300]}
    _wrong_save(d)
    return {"ok": True, "count": len(d)}


@app.delete("/api/wrong/{en}")
def wrong_del(en: str):
    d = _wrong_all()
    if en.strip() == "*":
        d = {}
    else:
        d.pop(en.strip().lower(), None)
    _wrong_save(d)
    return {"ok": True, "count": len(d)}


app.mount("/", StaticFiles(directory=ROOT / "static", html=True), name="static")


# ---------------------------------------------------------------- 자체검사

def _selftest():
    assert clean({"U 1": [{"en": " go ", "ko": " 가다 "}, {"en": "", "ko": "x"}, None]}) \
        == {"U 1": [{"en": "go", "ko": "가다"}]}
    assert clean({"": [{"en": "go", "ko": "가다"}]}) == {"Unit 1": [{"en": "go", "ko": "가다"}]}
    assert len(clean({"u": [{"en": "x" * 200, "ko": "가"}]})["u"][0]["en"]) == 80
    for bad in ({"U 1": []}, [1, 2], "hi"):
        try:
            clean(bad)
            raise AssertionError(f"통과하면 안 됨: {bad}")
        except HTTPException:
            pass

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
        uvicorn.run(app, host="127.0.0.1", port=8000)
