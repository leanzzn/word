/* Cloudflare Worker — 단어장/오답노트 저장소.
   AI 호출은 브라우저가 직접 한다 (Google이 데이터센터에서 오는 무료 API 호출을 막기 때문).
   그래서 API 키는 서버에 없고, 각자 브라우저에만 저장된다. */

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

class Fail extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

/** 받은 단어장을 검증·정리한다. 서버는 브라우저가 보낸 값을 그대로 믿지 않는다. */
function clean(units) {
  if (!units || typeof units !== "object" || Array.isArray(units)) {
    throw new Fail(400, "단어장 형식이 올바르지 않습니다");
  }
  const out = {};
  let total = 0;
  for (const [unit, words] of Object.entries(units)) {
    if (!Array.isArray(words)) continue;
    const list = [];
    for (const w of words) {
      const en = typeof w?.en === "string" ? w.en.trim() : "";
      const ko = typeof w?.ko === "string" ? w.ko.trim() : "";
      if (!en || !ko || total >= 20000) continue;
      list.push({ en: en.slice(0, 80), ko: ko.slice(0, 300) });
      total++;
    }
    if (list.length) out[String(unit).trim().slice(0, 80) || "Unit 1"] = list;
  }
  if (!total) throw new Fail(400, "단어가 하나도 없습니다");
  return out;
}

const wrongAll = env => env.WORDS.get("wrong", "json").then(d => d || {});

async function route(req, env, url) {
  const p = url.pathname;
  const m = req.method;

  // ── 단어장 ──
  if (p === "/api/books" && m === "GET") {
    const { keys } = await env.WORDS.list({ prefix: "book:" });
    return json(keys.map(k => ({ id: k.name.slice(5), ...k.metadata }))
      .sort((a, b) => (a.name || "").localeCompare(b.name || "")));
  }

  if (p === "/api/books" && m === "POST") {
    const { name, units } = await req.json();
    const cleaned = clean(units);
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    const book = {
      id,
      name: String(name || "단어장").replace(/\.pdf$/i, "").trim().slice(0, 100) || "단어장",
      units: cleaned,
    };
    await env.WORDS.put(`book:${id}`, JSON.stringify(book), {
      metadata: {
        name: book.name,
        units: Object.keys(cleaned).length,
        words: Object.values(cleaned).reduce((n, w) => n + w.length, 0),
      },
    });
    return json(book);
  }

  const book = p.match(/^\/api\/books\/([0-9a-f]{8,32})$/);
  if (book && m === "GET") {
    const b = await env.WORDS.get(`book:${book[1]}`, "json");
    if (!b) throw new Fail(404, "없는 단어장입니다");
    return json(b);
  }
  if (book && m === "DELETE") {
    await env.WORDS.delete(`book:${book[1]}`);
    return json({ ok: true });
  }

  // ── 오답노트 ──
  if (p === "/api/wrong" && m === "GET") {
    return json(Object.values(await wrongAll(env)).reverse());
  }
  if (p === "/api/wrong" && m === "POST") {
    const { en, ko } = await req.json();
    const key = String(en || "").trim().toLowerCase();
    if (!key) throw new Fail(400, "단어가 비었습니다");
    const d = await wrongAll(env);
    delete d[key];                                   // 다시 틀리면 맨 위로
    d[key] = { en: String(en).trim().slice(0, 80), ko: String(ko || "").trim().slice(0, 300) };
    await env.WORDS.put("wrong", JSON.stringify(d));
    return json({ ok: true, count: Object.keys(d).length });
  }
  const wrong = p.match(/^\/api\/wrong\/(.+)$/);
  if (wrong && m === "DELETE") {
    const target = decodeURIComponent(wrong[1]).trim().toLowerCase();
    let d = await wrongAll(env);
    if (target === "*") d = {}; else delete d[target];
    await env.WORDS.put("wrong", JSON.stringify(d));
    return json({ ok: true, count: Object.keys(d).length });
  }

  throw new Fail(404, "없는 주소입니다");
}

export { clean };   // 자체검사용 (Worker 동작에는 영향 없음)

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);

    // 공개 주소이므로 비밀번호로 막는다 (안 그러면 아무나 내 단어장을 보고 지운다)
    const pw = (env.APP_PASSWORD || "").trim();
    if (pw && (req.headers.get("x-app-key") || "").trim() !== pw) {
      return json({ detail: "비밀번호가 필요합니다" }, 401);
    }
    try {
      return await route(req, env, url);
    } catch (e) {
      return json({ detail: e.message || "서버 오류" }, e.status || 500);
    }
  },
};
