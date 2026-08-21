/* 순수 계산 함수 모음. 브라우저(index.html)와 자체검사(lib.test.mjs)가 같이 쓴다. */

/* ── AI 없이 글자만 보고 단어 뽑기 ──
   대부분의 단어장은 한 줄에 "영단어 + 한글뜻"이 나란히 있다. 그런 줄만 골라낸다.
   2단 편집(한 줄에 단어 두 개)도 한 줄에서 여러 쌍을 찾아 처리한다. */
const UNIT_RE = /\b(unit|day|chapter|lesson|week)\s*\.?\s*(\d+)/i;
const KO_UNIT_RE = /^(\d+)\s*(과|일차|주차)(?![가-힣])/;
// 숙어는 한 덩어리로 본다. "capitalize (on)" 처럼 괄호가 붙은 토막도 단어로 친다.
const PAIR_RE = /(\(?[A-Za-z][A-Za-z'-]*\)?(?:\s+\(?[A-Za-z][A-Za-z'-]*\)?){0,3})[^A-Za-z가-힣]*([가-힣][^A-Za-z]*)/g;
const POS_RE = /^(?:[명동형부전접대감통자타][\s.,·)\]]+)+/;   // 품사 표시(명· 동· 형…)
// 부록("Appendix 101")부터는 단어장이 아니므로 거기서 멈춘다.
// 숫자를 꼭 요구하는 이유: 표제어 "appendix 맹장, 부록"에 걸려 통째로 잘리면 안 되니까.
const STOP_RE = /^.*\bappendix\s*\.?\s*\d/im;

/** 부록 제목이 나오는 줄부터 끝까지 잘라낸다. AI로 보낼 때도 이 자른 글을 쓴다. */
export function cut(text) {
  const m = text.match(STOP_RE);
  return m ? text.slice(0, m.index) : text;
}

/** 한글 뜻 다듬기: 한자와 괄호를 지운다. ("정상(頂上), 꼭대기" -> "정상, 꼭대기") */
export function cleanKo(s) {
  return String(s)
    .replace(/[⺀-⿟㐀-䶿一-鿿豈-﫿]/g, " ")  // 한자
    .replace(/[()（）\[\]]/g, " ")                                             // 괄호
    .replace(/\s+/g, " ")
    .replace(/\s+([,;·])/g, "$1")        // "씨앗 , 근원" -> "씨앗, 근원"
    .replace(/^[\s,;·]+|[\s,;·]+$/g, "");
}

export function parseLocal(text) {
  const out = [];
  let unit = "Unit 1";
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\[[^\]]*\]/g, " ")        // 발음기호 [əbǽndən] 버리기
      .replace(/[^\x20-\x7E가-힣]/g, " ").trim();       // 그 외 특수문자도 공백으로
    if (!line) continue;

    if (line.length < 40) {                           // 짧은 줄은 유닛 제목일 수 있다
      const u = line.match(UNIT_RE), k = line.match(KO_UNIT_RE);
      if (u) { unit = u[1][0].toUpperCase() + u[1].slice(1).toLowerCase() + " " + u[2]; continue; }
      if (k) { unit = k[1] + k[2]; continue; }
    }
    for (const [, en, ko] of line.matchAll(PAIR_RE)) {
      const e = en.trim();
      // "He abandoned the car. 그는 차를 버렸다." 같은 예문은 표제어가 아니다.
      // ponytail: 대문자로 시작하는 여러 단어면 문장으로 본다. 소문자로 시작하는 예문은 못 거른다.
      if (/^[A-Z]/.test(e) && /\s/.test(e)) continue;
      // 뒤에 붙은 다음 단어의 번호("적응하다   4")까지 같이 잡히므로 꼬리를 떼어낸다
      const m = cleanKo(ko.replace(POS_RE, "").replace(/[\s\d,.·)\]]+$/, ""));
      if (e.length >= 2 && m) out.push({ unit, en: e, ko: m });
    }
  }
  return out;
}

/** [{unit,en,ko}] -> {unit: [{en,ko}]}. 순서 유지, 유닛 내 중복 en 제거, 빈 값 버림. */
export function group(entries) {
  const out = {};
  for (const e of entries) {
    const unit = (e?.unit || "").trim() || "Unit 1";
    const en = (e?.en || "").replace(/\s+/g, " ").trim();   // 숙어는 띄어쓰기 살려 한 덩어리로
    const ko = cleanKo(e?.ko || "");                        // 한자·괄호 제거
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

/** 포기한 문제는 뒤에 다시 넣어둔 것까지 빼낸다. (총 문제 수가 늘어나지 않게) */
export function dropRetry(qs, qi) {
  const q = qs[qi];
  return qs.filter((x, k) => k <= qi || !(x.retry && x.w === q.w && x.type === q.type));
}

/** 틀린 문제를 같은 유형의 맨 뒤로 다시 넣는다.
 *  객관식은 마지막 객관식 뒤(= 주관식 시작 전), 주관식은 전체 맨 뒤.
 *  그래서 객관식을 다 맞히기 전에는 주관식으로 넘어가지 않는다. */
export function requeue(qs, qi, max = 50) {
  if (qs.length >= max) return qs;          // 끝없이 늘어나지 않게 50문제까지만
  const { requeued, ...q } = qs[qi];        // 다시 낸 문제도 또 틀리면 또 다시 낸다
  let at = qs.length;
  if (q.type === "mc") {
    const i = qs.findIndex((x, k) => k > qi && x.type !== "mc");
    if (i >= 0) at = i;
  }
  const out = qs.slice();
  out.splice(at, 0, { ...q, retry: true });
  return out;
}
