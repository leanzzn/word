/* 순수 계산 함수 모음. 브라우저(index.html)와 자체검사(lib.test.mjs)가 같이 쓴다. */

export const PARSE_PROMPT = `아래는 영어 단어장 내용입니다. 모든 단어를 빠짐없이 추출하세요.

규칙:
- unit: 그 단어가 속한 유닛/챕터/DAY 이름 (예: "Unit 1", "DAY 03"). 표기가 없으면 "Unit 1".
- en: 영단어 하나 (품사표시·번호·발음기호 제외).
- ko: 한글 뜻. 여러 개면 쉼표로 구분.
- 예문, 목차, 페이지 번호는 제외하고 표제어만 추출.`;

export const ENTRY_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: { unit: { type: "STRING" }, en: { type: "STRING" }, ko: { type: "STRING" } },
    required: ["unit", "en", "ko"],
  },
};

/** 긴 글을 줄 단위로 끊어 size 이하 덩어리로 나눈다 (단어 한 줄이 잘리지 않게). */
export function chunk(text, size = 15000) {
  const out = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if (cur.length + line.length + 1 > size && cur) { out.push(cur); cur = ""; }
    cur += line + "\n";
  }
  if (cur.trim()) out.push(cur);
  return out.length ? out : [text];
}

/** [{unit,en,ko}] -> {unit: [{en,ko}]}. 순서 유지, 유닛 내 중복 en 제거, 빈 값 버림. */
export function group(entries) {
  const out = {};
  for (const e of entries) {
    const unit = (e?.unit || "").trim() || "Unit 1";
    const en = (e?.en || "").trim();
    const ko = (e?.ko || "").trim();
    if (!en || !ko) continue;
    const words = (out[unit] ||= []);
    if (!words.some(w => w.en.toLowerCase() === en.toLowerCase())) words.push({ en, ko });
  }
  return out;
}

/** Gemini 실패 시 쓸 객관식 오답: 같은 유닛에서 첫글자·길이가 비슷한 단어 우선으로 3개. */
export function fallback(answer, pool) {
  const score = w => (w[0]?.toLowerCase() !== answer[0]?.toLowerCase() ? 100 : 0)
    + Math.abs(w.length - answer.length);
  const out = pool.filter(w => w.toLowerCase() !== answer.toLowerCase())
    .sort(() => Math.random() - 0.5)
    .sort((a, b) => score(a) - score(b))
    .slice(0, 3);
  while (out.length < 3) out.push(answer.slice(0, -1) + "aeioustr"[out.length] + "e");
  return out.slice(0, 3);
}

/** 주관식 채점.
 *  뜻이 여러 개일 때 그중 하나만 써도 정답, 쉼표로 몇 개를 같이 써도 정답,
 *  뜻 전체를 그대로 써도 정답으로 본다. (맞히면 화면에는 항상 전체 뜻을 보여준다) */
const norm = s => s.toLowerCase().replace(/[\s.,~()·\-'"/;:!?]/g, "");
const segs = s => s.split(/[,;/·]/).map(norm).filter(Boolean);
export function checkKo(input, meaning) {
  const mine = segs(input);
  if (!mine.length) return false;
  if (norm(input) === norm(meaning)) return true;          // 뜻 전체를 그대로 입력
  const theirs = segs(meaning);
  return mine.some(a => theirs.some(b => b === a || (a.length >= 2 && b.includes(a))));
}

/** 유닛 단어로 20문제를 만든다. 1~10번 객관식, 11~20번 주관식. */
export function buildQuestions(words, shuffle = a => a) {
  const pool = shuffle(words.slice());
  return Array.from({ length: 20 }, (_, k) => ({
    w: pool[k % pool.length],
    type: k < 10 ? "mc" : "sa",
  }));
}
