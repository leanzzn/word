/* 자체검사:  node worker.test.mjs  */
import assert from "node:assert/strict";
import { group, fallback, checkKo, buildQuestions, requeue, dropRetry, parseLocal, cut, cleanKo } from "./static/lib.mjs";
import { clean } from "./worker.js";

// ── 부록 잘라내기 ──
assert.equal(cut("Chapter 1\nseed 씨앗\nAppendix 101\njunk 쓰레기\n"), "Chapter 1\nseed 씨앗\n");
assert.equal(cut("seed 씨앗\nAPPENDIX101\nx 엑스"), "seed 씨앗\n");        // 대문자·붙여쓰기
assert.equal(cut("seed 씨앗\n  Appendix. 101 불규칙동사\nx 엑스"), "seed 씨앗\n");
assert.equal(cut("seed 씨앗\nappendix 맹장, 부록"), "seed 씨앗\nappendix 맹장, 부록");  // 표제어는 안 자름
assert.equal(cut("seed 씨앗"), "seed 씨앗");                               // 부록 없으면 그대로
assert.deepEqual(parseLocal(cut("Day 1\nseed 씨앗\nAppendix 101\njunk 쓰레기")),
  [{ unit: "Day 1", en: "seed", ko: "씨앗" }]);

// ── AI 없이 글자에서 단어 뽑기 ──
const p = parseLocal([
  "영어 단어장 목차",                    // 잡소리 (한글만) → 버림
  "DAY 01",
  "1. abandon [əbǽndən] 통 버리다, 포기하다",
  "2 ability 능력",
  "give up 포기하다",                     // 두 단어짜리 표제어
  "He abandoned the car.",                // 예문 (한글 없음) → 버림
  "Unit 2",
  "3 adapt 적응하다   4 adopt 채택하다",  // 2단 편집: 한 줄에 두 개
  "5 summit 정상",
].join("\n"));
assert.deepEqual(p, [
  { unit: "Day 01", en: "abandon", ko: "버리다, 포기하다" },
  { unit: "Day 01", en: "ability", ko: "능력" },
  { unit: "Day 01", en: "give up", ko: "포기하다" },
  { unit: "Unit 2", en: "adapt", ko: "적응하다" },
  { unit: "Unit 2", en: "adopt", ko: "채택하다" },
  { unit: "Unit 2", en: "summit", ko: "정상" },
]);
assert.deepEqual(parseLocal("아무 단어도 없는 글\n그냥 문장입니다"), []);
// 예문(영어 문장 + 한글 해석)과 페이지 번호·목차는 표제어가 아니다
assert.deepEqual(parseLocal("He abandoned the car. 그는 차를 버렸다."), []);
assert.deepEqual(parseLocal("- 12 -\np. 34\n영어 단어장 목차"), []);
assert.equal(parseLocal("1과\nseed 씨앗")[0].unit, "1과");
// 뜻이 품사 표시로 시작해도 뜻 자체는 안 잘린다
assert.equal(parseLocal("stand 명 대신하다")[0].ko, "대신하다");
assert.equal(parseLocal("replace 대신하다")[0].ko, "대신하다");

// ── 숙어(괄호 포함)와 한자 뜻풀이 ──
assert.equal(cleanKo("정상(頂上)"), "정상");
assert.equal(cleanKo("정상(頂上), 꼭대기"), "정상, 꼭대기");
assert.equal(cleanKo("(~을) 이용하다"), "~을 이용하다");     // 한글 내용은 안 버린다
assert.equal(cleanKo("적응하다"), "적응하다");
const ph = parseLocal([
  "Unit 3",
  "1 capitalize (on) 이용하다(利用)",
  "2 put (off) 미루다",
  "3 look forward to 기대하다",
].join("\n"));
assert.deepEqual(ph, [
  { unit: "Unit 3", en: "capitalize (on)", ko: "이용하다" },
  { unit: "Unit 3", en: "put (off)", ko: "미루다" },
  { unit: "Unit 3", en: "look forward to", ko: "기대하다" },
]);
// AI가 준 값도 같은 규칙으로 다듬는다
assert.deepEqual(group([{ unit: "U", en: "capitalize  (on)", ko: "이용하다(利用), 활용하다" }]),
  { U: [{ en: "capitalize (on)", ko: "이용하다, 활용하다" }] });

// ── 단어 묶기 ──
const g = group([
  { unit: "Unit 1", en: "adapt", ko: "적응하다" },
  { unit: "Unit 1", en: "Adapt", ko: "중복" },        // 중복 제거
  { unit: " Unit 1 ", en: "adopt", ko: "채택하다" },   // 공백 정규화
  { unit: "", en: "solo", ko: "혼자의" },              // 기본 유닛
  { unit: "Unit 2", en: "", ko: "빈 값" },             // 버림
]);
assert.deepEqual(Object.keys(g), ["Unit 1"]);
assert.deepEqual(g["Unit 1"].map(w => w.en), ["adapt", "adopt", "solo"]);

// ── 오답 선지 ──
const f = fallback("adapt", ["adopt", "banana", "adept", "adapt"]);
assert.equal(f.length, 3);
assert.ok(!f.includes("adapt"));
assert.deepEqual(new Set(f.slice(0, 2)), new Set(["adopt", "adept"]));
assert.equal(fallback("go", []).length, 3);              // 풀이 비어도 3개

// ── 주관식 채점 ──
assert.ok(checkKo("적응하다", "적응하다, 맞추다"));        // 뜻 하나만
assert.ok(checkKo(" 맞추다 ", "적응하다, 맞추다"));        // 앞뒤 공백 무시
assert.ok(checkKo("적응하다, 맞추다", "적응하다, 맞추다")); // 통째로 그대로
assert.ok(checkKo("적응하다,맞추다", "적응하다, 맞추다"));  // 띄어쓰기 없이 통째로
assert.ok(checkKo("맞추다, 적응하다", "적응하다, 맞추다")); // 순서 바꿔서
assert.ok(checkKo("적응", "적응하다, 맞추다"));            // 일부만 써도 인정
assert.ok(checkKo("정상", "정상, 정상회담"));
// 뜻이 3개일 때: 하나만, 두 개만, 전부 다 — 모두 정답
const three = "정상, 꼭대기, 정상회담";
assert.ok(checkKo("꼭대기", three));
assert.ok(checkKo("정상, 정상회담", three));
assert.ok(checkKo("꼭대기, 정상", three));
assert.ok(checkKo(three, three));
assert.ok(!checkKo("바닥, 밑", three));                   // 하나도 안 맞으면 오답
assert.ok(!checkKo("", "적응하다"));                       // 빈 답은 오답
assert.ok(!checkKo("   ", "적응하다"));
assert.ok(!checkKo("채택하다", "적응하다, 맞추다"));
assert.ok(!checkKo("다", "적응하다"));                     // 한 글자로는 못 맞힌다

// ── 20문제 구성 ──
const q = buildQuestions([{ en: "a", ko: "가" }, { en: "b", ko: "나" }]);
assert.equal(q.length, 20);
assert.equal(q.filter(x => x.type === "mc").length, 10);
assert.equal(q.filter(x => x.type === "sa").length, 10);
assert.ok(q.every(x => x.w));                             // 단어가 2개뿐이어도 20문제

// ── 틀린 문제 다시 내기 ──
const types = a => a.map(x => x.type).join("");
// 객관식을 틀리면 주관식 앞(= 객관식 맨 뒤)에 다시 들어간다
const r1 = requeue(q, 2);
assert.equal(types(r1), "mc".repeat(11) + "sa".repeat(10));
assert.equal(r1[10].w, q[2].w);
assert.ok(r1[10].retry && !q[2].retry);          // 원본은 안 건드린다
// 다시 낸 것도 또 틀리면 또 객관식 맨 뒤로
assert.equal(types(requeue(r1, 10)), "mc".repeat(12) + "sa".repeat(10));
// 주관식은 전체 맨 뒤로
const r2 = requeue(q, 15);
assert.equal(types(r2), "mc".repeat(10) + "sa".repeat(11));
assert.equal(r2[20].w, q[15].w);
// 객관식만 있는 경우에도 맨 뒤로
assert.equal(requeue([{ type: "mc", w: 1 }], 0).length, 2);
// 다시 낸 문제는 "이미 다시 냈음" 표시를 물려받지 않는다 (또 틀리면 또 나와야 하니까)
assert.equal(requeue([{ type: "sa", w: 1, requeued: true }], 0)[1].requeued, undefined);
// 이미 기록한 오답은 다시 기록하지 않게 표시를 물려받는다
assert.equal(requeue([{ type: "sa", w: 1, logged: true }], 0)[1].logged, true);
// 50문제가 넘으면 더 안 늘린다
let big = q;
for (let i = 0; i < 100; i++) big = requeue(big, 0);
assert.equal(big.length, 50);

// ── 포기하면 다시 낼 문제도 빼낸다 (총 문제 수가 늘어나면 안 된다) ──
const w1 = { en: "a", ko: "가" }, w2 = { en: "b", ko: "나" };
const base = [{ type: "mc", w: w1 }, { type: "mc", w: w2 }, { type: "sa", w: w1 }];
// 0번을 틀려서 다시 넣었다가 포기하면 원래 길이로 돌아온다
assert.deepEqual(dropRetry(requeue(base, 0), 0), base);
// 아직 안 푼 다른 문제는 그대로 둔다
const two = requeue(requeue(base, 0), 1);           // 0번, 1번 둘 다 다시 넣음
assert.equal(two.length, 5);
assert.equal(dropRetry(two, 0).length, 4);          // 0번 것만 빠짐
assert.equal(dropRetry(two, 0).filter(x => x.w === w2).length, 2);
// 같은 단어라도 유형이 다르면 안 건드린다 (객관식 포기가 주관식을 지우면 안 됨)
assert.equal(dropRetry(requeue(base, 2), 0).length, 4);
// 틀린 적 없이 포기하면 아무것도 안 빠진다
assert.deepEqual(dropRetry(base, 1), base);
// 이미 지나간 문제는 건드리지 않는다
assert.equal(dropRetry([{ type: "mc", w: w1, retry: true }, { type: "mc", w: w1 }], 1).length, 2);

// ── 서버 검증 (브라우저가 보낸 값을 그대로 믿지 않는다) ──
assert.deepEqual(clean({ "U 1": [{ en: " go ", ko: " 가다 " }, { en: "", ko: "x" }, null] }),
  { "U 1": [{ en: "go", ko: "가다" }] });
assert.throws(() => clean({ "U 1": [] }), /단어가 하나도 없습니다/);
assert.throws(() => clean([1, 2]), /형식이 올바르지 않습니다/);
assert.throws(() => clean("hi"), /형식이 올바르지 않습니다/);
assert.equal(clean({ u: [{ en: "x".repeat(200), ko: "가" }] }).u[0].en.length, 80);  // 길이 제한

console.log("ok");
