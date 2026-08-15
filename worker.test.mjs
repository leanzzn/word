/* 자체검사:  node worker.test.mjs  */
import assert from "node:assert/strict";
import { chunk, group, fallback, checkKo, buildQuestions } from "./static/lib.mjs";
import { clean } from "./worker.js";

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

// ── 긴 글 나누기 ──
const lines = Array.from({ length: 1000 }, (_, i) => `line${i}`).join("\n");
const c = chunk(lines, 100);
assert.ok(c.length > 1 && c.every(x => x.length <= 108));
assert.equal(c.join("").split("line").length - 1, 1000);  // 한 줄도 잃지 않는다

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

// ── 서버 검증 (브라우저가 보낸 값을 그대로 믿지 않는다) ──
assert.deepEqual(clean({ "U 1": [{ en: " go ", ko: " 가다 " }, { en: "", ko: "x" }, null] }),
  { "U 1": [{ en: "go", ko: "가다" }] });
assert.throws(() => clean({ "U 1": [] }), /단어가 하나도 없습니다/);
assert.throws(() => clean([1, 2]), /형식이 올바르지 않습니다/);
assert.throws(() => clean("hi"), /형식이 올바르지 않습니다/);
assert.equal(clean({ u: [{ en: "x".repeat(200), ko: "가" }] }).u[0].en.length, 80);  // 길이 제한

console.log("ok");
