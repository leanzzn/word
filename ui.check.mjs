/* 실제 크롬으로 퀴즈 화면을 끝까지 눌러보는 점검:  npm run check  */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

const ROOT = path.resolve("static");
const TYPE = { ".html": "text/html", ".mjs": "text/javascript" };
const srv = http.createServer((req, res) => {
  const f = path.join(ROOT, req.url === "/" ? "/index.html" : req.url.split("?")[0]);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) return res.writeHead(404).end();
  res.writeHead(200, { "Content-Type": TYPE[path.extname(f)] || "text/plain" });
  res.end(fs.readFileSync(f));
});
await new Promise(r => srv.listen(0, "127.0.0.1", r));
const PORT = srv.address().port;

const WORDS = [
  { en: "apple", ko: "사과" }, { en: "banana", ko: "바나나" }, { en: "cherry", ko: "체리" },
  { en: "durian", ko: "두리안" }, { en: "elder", ko: "어른" }, { en: "fig", ko: "무화과" },
];
const EN = Object.fromEntries(WORDS.map(w => [w.ko, w.en]));
const KO = Object.fromEntries(WORDS.map(w => [w.en, w.ko]));

const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(fs.existsSync);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new" });
const page = await browser.newPage();
page.on("pageerror", e => { console.error("페이지 오류:", e.message); process.exitCode = 1; });

await page.evaluateOnNewDocument(words => {
  localStorage.appkey = "k"; localStorage.gkey = "k";
  window.__wrong = [];
  window.__ai = [];                       // AI를 부른 단어들 (몇 번 부르는지 확인용)
  const slow = ms => new Promise(r => setTimeout(r, ms));
  const json = o => new Response(JSON.stringify(o), { status: 200, headers: { "Content-Type": "application/json" } });
  window.fetch = async (url, opt = {}) => {
    const u = String(url), m = (opt.method || "GET").toUpperCase();
    if (u.includes("generativelanguage")) {
      window.__ai.push(JSON.parse(opt.body).contents[0].parts[0].text.match(/"([a-z]+)"/)[1]);
      await slow(700);                    // AI는 느리다고 치고
      return json({ candidates: [{ content: { parts: [{ text: JSON.stringify(["zzza", "zzzb", "zzzc"]) }] } }] });
    }
    if (u.endsWith("/api/books")) return json([{ id: "b1", name: "테스트", units: 1, words: words.length }]);
    if (u.includes("/api/books/")) return json({ id: "b1", name: "테스트", units: { "Unit 1": words } });
    if (u.includes("/api/wrong")) {
      if (m === "POST") window.__wrong.push(JSON.parse(opt.body));
      return json(m === "POST" ? { ok: true } : window.__wrong);
    }
    return json({});
  };
}, WORDS);

const txt = sel => page.$eval(sel, e => e.textContent.trim());
const info = () => txt("#qinfo");
const total = async () => +(await info()).match(/\/\s*(\d+)/)[1];
const at = async () => +(await info()).match(/^(\d+)/)[1];
const opts = () => page.$$eval("#mc button", bs => bs.map(b => b.textContent.trim()));
const nextOff = () => page.$eval("#next", b => b.disabled);
const ready = () => page.waitForFunction(
  () => (!document.querySelector("#mc").classList.contains("hide") &&
         document.querySelectorAll("#mc button").length === 4) ||
        !document.querySelector("#sa").classList.contains("hide"), { timeout: 15000 });
const isMc = () => page.$eval("#mc", e => !e.classList.contains("hide"));
async function waitOpts() {               // 선지 4개가 뜰 때까지 걸린 시간(ms)
  const t = Date.now();
  await page.waitForFunction(() => document.querySelectorAll("#mc button").length === 4,
    { polling: 10, timeout: 15000 });
  return Date.now() - t;
}

async function answer(correct) {
  if (await isMc()) {
    const want = EN[await txt("#prompt")];
    const list = await opts();
    const i = list.findIndex(o => (o === want) === correct);
    await page.$$eval("#mc button", (bs, k) => bs[k].click(), i);
  } else {
    const ko = KO[await txt("#prompt")];
    await page.$eval("#answer", e => e.value = "");
    await page.type("#answer", correct ? ko : "틀린답");
    await page.click("#submit");
  }
  await page.waitForFunction(() => document.querySelector("#fb").textContent.trim().length > 0);
}

await page.goto(`http://127.0.0.1:${PORT}/index.html`);
await page.waitForSelector("#books .card");
await page.click("#books .card .grow");
await page.waitForSelector("#units .card");
await page.click("#units .card");
const first = await waitOpts();           // 첫 문제는 AI를 기다린다
await ready();

// 0) 다음 문제 선지는 미리 만들어 둬서 기다림이 없다
assert.ok(first > 400, `첫 문제는 AI를 기다린다 (${first}ms)`);

// 1) 시작은 20문제
assert.equal(await total(), 20, "시작 문제 수");
assert.equal(await nextOff(), true, "풀기 전에는 다음 버튼 잠김");

// 2) 틀리면 다음 버튼이 켜지고, 그 문제는 뒤에 다시 들어간다
await answer(false);
assert.equal(await nextOff(), false, "틀렸을 때 다음 버튼");
await page.click("#next");
const second = await waitOpts();
assert.ok(second < 300, `두 번째 문제 선지는 미리 준비돼 있어야 한다 (${second}ms)`);
await ready();
assert.equal(await total(), 21, "틀린 뒤 총 문제 수");
assert.equal(await at(), 2, "두 번째 문제");

// 3) 틀린 다음 포기하면, 뒤에 넣어둔 것까지 빠져서 총 문제 수가 안 늘어난다
await answer(false);
await page.click("#giveup"); await ready();
assert.equal(await total(), 21, "틀리고 포기했을 때 총 문제 수");
assert.equal(await at(), 3, "세 번째 문제");

// 4) 그냥 포기해도 총 문제 수는 그대로
await page.click("#giveup"); await ready();
assert.equal(await total(), 21, "그냥 포기했을 때 총 문제 수");
assert.equal(await at(), 4, "네 번째 문제");

// 5) 맞히면 포기 버튼이 잠기고 정답 문구가 뜬다
await answer(true);
assert.equal(await nextOff(), false, "맞혔을 때 다음 버튼");
assert.equal(await page.$eval("#giveup", b => b.disabled), true, "맞히면 포기 버튼 잠김");
assert.match(await txt("#fb"), /^정답!/, "정답 문구");

// 6) 끝까지 풀면 완료 화면. 아까 틀린 문제는 "다시 도전"으로 다시 나온다
let retries = 0, guard = 0, types = [];
while (await page.$eval("#v-quiz", e => !e.classList.contains("hide"))) {
  if (++guard > 60) throw new Error("문제가 끝나지 않음");
  if ((await info()).includes("다시 도전")) retries++;
  types.push(await isMc() ? "mc" : "sa");
  await answer(true);
  await page.click("#next");
  if (await page.$eval("#v-quiz", e => !e.classList.contains("hide"))) await ready();
}
assert.ok(retries >= 1, "틀린 문제가 다시 나와야 한다");
assert.deepEqual([...new Set(types)], ["mc", "sa"], "객관식을 다 푼 뒤 주관식");
assert.equal(await page.$eval("#v-done", e => !e.classList.contains("hide")), true, "완료 화면");
assert.match(await txt("#doneSub"), /2개는 오답노트에 담았습니다/, "완료 문구");

// 7) 틀린 것·포기한 것이 오답노트에 담겼다
// 8) 같은 단어 선지를 AI에게 두 번 묻지 않는다 (다시 나온 문제도 바로 뜬다)
const ai = await page.evaluate(() => window.__ai);
assert.equal(new Set(ai).size, ai.length, `단어마다 한 번만 물어야 한다: ${ai.join(",")}`);

const wrong = await page.evaluate(() => window.__wrong.map(w => w.en));
assert.equal(wrong.length, 3, "오답노트에 담긴 개수(틀림2 + 포기1)");
assert.equal(new Set(wrong).size, wrong.length, "같은 단어를 두 번 담지 않는다");

console.log(`통과: 첫 선지 ${first}ms / 다음 선지 ${second}ms, AI 호출 ${ai.length}회, 총 ${guard + 4}문제, 다시 나온 문제 ${retries}개, 오답노트 ${wrong.join(", ")}`);
await browser.close();
srv.close();
