import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { DatabaseSync } from "node:sqlite";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sessionDays = Number(process.env.SESSION_DAYS || 30);
const isProduction = process.env.NODE_ENV === "production";
const db = new DatabaseSync(path.join(__dirname, "data.sqlite"));

if (isProduction) app.set("trust proxy", 1);

db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    nickname TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id_hash TEXT PRIMARY KEY,
    user_id TEXT,
    csrf_token TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
  INSERT OR IGNORE INTO schema_migrations (version) VALUES (1);
  CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_schedules_user_start ON schedules(user_id, starts_at);
  INSERT OR IGNORE INTO schema_migrations (version) VALUES (2);
  CREATE TABLE IF NOT EXISTS sales (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    sale_date TEXT NOT NULL,
    amount INTEGER NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, sale_date),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_sales_user_date ON sales(user_id, sale_date);
  INSERT OR IGNORE INTO schema_migrations (version) VALUES (3);
`);

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.set({
    "Content-Security-Policy": "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; base-uri 'self'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
  });
  next();
});
app.use(express.json({ limit: "32kb" }));

const authAttempts = new Map();

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").map(part => {
    const index = part.indexOf("=");
    if (index === -1) return [];
    try { return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())]; }
    catch { return []; }
  }).filter(pair => pair.length));
}

function getSession(req) {
  const sid = parseCookies(req).sid;
  if (!sid || !/^[a-f0-9]{64}$/.test(sid)) return null;
  const session = db.prepare("SELECT * FROM sessions WHERE id_hash = ? AND expires_at > ?").get(hash(sid), Date.now());
  if (!session) return null;
  return { ...session, rawId: sid };
}

function setSessionCookie(res, sid) {
  const maxAge = Math.max(1, Math.floor(sessionDays * 24 * 60 * 60));
  res.cookie("sid", sid, { httpOnly: true, sameSite: "strict", secure: isProduction, maxAge: maxAge * 1000, path: "/" });
}

function clearSessionCookie(res) {
  res.clearCookie("sid", { httpOnly: true, sameSite: "strict", secure: isProduction, path: "/" });
}

function createSession(res, userId = null) {
  const sid = crypto.randomBytes(32).toString("hex");
  const csrfToken = crypto.randomBytes(32).toString("hex");
  const now = new Date().toISOString();
  const expiresAt = Date.now() + sessionDays * 24 * 60 * 60 * 1000;
  db.prepare("INSERT INTO sessions (id_hash, user_id, csrf_token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(hash(sid), userId, csrfToken, expiresAt, now);
  setSessionCookie(res, sid);
  return { csrfToken };
}

function destroySession(req, res, clearCookie = true) {
  const session = getSession(req);
  if (session) db.prepare("DELETE FROM sessions WHERE id_hash = ?").run(hash(session.rawId));
  if (clearCookie) clearSessionCookie(res);
}

function userPublic(user) {
  return { id: user.id, email: user.email, nickname: user.nickname, name: user.name, createdAt: user.created_at, updatedAt: user.updated_at };
}

function getCurrentUser(req) {
  const session = getSession(req);
  if (!session?.user_id) return null;
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(session.user_id);
  return user ? { session, user } : null;
}

function requireAuth(req, res, next) {
  const current = getCurrentUser(req);
  if (!current) return res.status(401).json({ error: "로그인이 필요합니다." });
  req.currentUser = current;
  next();
}

function csrfRequired(req, res, next) {
  const session = getSession(req);
  const origin = req.get("origin");
  const expectedOrigin = `${req.protocol}://${req.get("host")}`;
  const providedToken = Buffer.from(req.get("x-csrf-token") || "");
  const expectedToken = session ? Buffer.from(session.csrf_token) : null;
  if (!session || providedToken.length !== expectedToken.length || !crypto.timingSafeEqual(providedToken, expectedToken)) {
    return res.status(403).json({ error: "요청을 확인할 수 없습니다. 페이지를 새로고침 후 다시 시도해주세요." });
  }
  if (origin && origin !== expectedOrigin) return res.status(403).json({ error: "허용되지 않은 요청입니다." });
  req.session = session;
  next();
}

function validateRegistration(body = {}) {
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const passwordConfirm = String(body.passwordConfirm || "");
  const nickname = String(body.nickname || "").trim();
  const name = String(body.name || "").trim();
  if (!email) return { error: "이메일을 입력해주세요." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return { error: "올바른 이메일 형식이 아닙니다." };
  if (!password) return { error: "비밀번호를 입력해주세요." };
  if (password.length < 8) return { error: "비밀번호는 최소 8자 이상이어야 합니다." };
  if (password.length > 128) return { error: "비밀번호는 128자 이하로 입력해주세요." };
  if (password !== passwordConfirm) return { error: "비밀번호가 일치하지 않습니다." };
  if (!nickname) return { error: "닉네임을 입력해주세요." };
  if (nickname.length < 2 || nickname.length > 30) return { error: "닉네임은 2~30자로 입력해주세요." };
  if (!name) return { error: "이름을 입력해주세요." };
  if (name.length > 50) return { error: "이름은 50자 이하로 입력해주세요." };
  return { email, password, nickname, name };
}

function passwordHash(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

function passwordMatches(password, stored) {
  const [, saltHex, hashHex] = String(stored).split("$");
  if (!saltHex || !hashHex) return false;
  const derived = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), 64);
  return crypto.timingSafeEqual(derived, Buffer.from(hashHex, "hex"));
}

function rateLimited(req, res, next) {
  const key = `${req.ip}:${req.path}`;
  const now = Date.now();
  const item = authAttempts.get(key) || { count: 0, resetAt: now + 15 * 60 * 1000 };
  if (item.resetAt < now) { item.count = 0; item.resetAt = now + 15 * 60 * 1000; }
  item.count += 1;
  authAttempts.set(key, item);
  if (item.count > 20) return res.status(429).json({ error: "잠시 후 다시 시도해주세요." });
  next();
}

app.get("/api/auth/csrf", (req, res) => {
  const session = getSession(req);
  if (session) return res.json({ csrfToken: session.csrf_token });
  res.json(createSession(res));
});

app.post("/api/auth/register", rateLimited, csrfRequired, (req, res) => {
  const input = validateRegistration(req.body);
  if (input.error) return res.status(400).json({ error: input.error });
  if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(input.email)) return res.status(409).json({ error: "이미 사용 중인 이메일입니다." });
  if (db.prepare("SELECT 1 FROM users WHERE nickname = ?").get(input.nickname)) return res.status(409).json({ error: "이미 사용 중인 닉네임입니다." });
  const now = new Date().toISOString();
  const user = { id: crypto.randomUUID(), ...input, created_at: now, updated_at: now };
  db.prepare("INSERT INTO users (id, email, password_hash, nickname, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(user.id, user.email, passwordHash(user.password), user.nickname, user.name, now, now);
  res.status(201).json({ message: "회원가입이 완료되었습니다. 로그인해주세요.", user: userPublic(user) });
});

app.post("/api/auth/login", rateLimited, csrfRequired, (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!email || !password) return res.status(400).json({ error: "이메일과 비밀번호를 입력해주세요." });
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user || !passwordMatches(password, user.password_hash)) return res.status(401).json({ error: "이메일 또는 비밀번호가 올바르지 않습니다." });
  destroySession(req, res, false);
  const session = createSession(res, user.id);
  res.json({ message: "로그인되었습니다.", user: userPublic(user), csrfToken: session.csrfToken });
});

app.post("/api/auth/logout", csrfRequired, (req, res) => {
  destroySession(req, res);
  res.json({ message: "로그아웃되었습니다." });
});

app.get("/api/auth/me", (req, res) => {
  const current = getCurrentUser(req);
  if (!current) return res.status(401).json({ error: "로그인이 필요합니다." });
  res.json({ user: userPublic(current.user), csrfToken: current.session.csrf_token });
});

app.post("/api/auth/forgot-password", rateLimited, csrfRequired, (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "올바른 이메일을 입력해주세요." });
  // 메일 서비스가 설정되면 이 위치에서 재설정 토큰을 발급해 이메일로 전송합니다.
  res.json({ message: "가입된 이메일이라면 비밀번호 재설정 안내를 보냈습니다." });
});

app.get("/login", (req, res) => res.redirect(getCurrentUser(req) ? "/" : "/login.html"));
app.get("/register", (req, res) => res.redirect(getCurrentUser(req) ? "/" : "/register.html"));
app.get("/forgot-password", (req, res) => res.redirect(getCurrentUser(req) ? "/" : "/forgot-password.html"));
app.get("/profile", (req, res) => res.redirect(getCurrentUser(req) ? "/profile.html" : "/login"));
app.get("/schedule", (req, res) => res.redirect(getCurrentUser(req) ? "/schedule.html" : "/login"));
app.get("/sales", (req, res) => res.redirect(getCurrentUser(req) ? "/sales.html" : "/login"));
app.get("/login.html", (req, res) => getCurrentUser(req) ? res.redirect("/") : res.sendFile(path.join(__dirname, "public", "login.html")));
app.get("/register.html", (req, res) => getCurrentUser(req) ? res.redirect("/") : res.sendFile(path.join(__dirname, "public", "register.html")));
app.get("/forgot-password.html", (req, res) => getCurrentUser(req) ? res.redirect("/") : res.sendFile(path.join(__dirname, "public", "forgot-password.html")));
app.get("/profile.html", (req, res) => getCurrentUser(req) ? res.sendFile(path.join(__dirname, "public", "profile.html")) : res.redirect("/login"));
app.get("/schedule.html", (req, res) => getCurrentUser(req) ? res.sendFile(path.join(__dirname, "public", "schedule.html")) : res.redirect("/login"));
app.get("/sales.html", (req, res) => getCurrentUser(req) ? res.sendFile(path.join(__dirname, "public", "sales.html")) : res.redirect("/login"));
app.use(express.static(path.join(__dirname, "public")));

function scheduleDraftFromMessage(message) {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0, 0);
  let matchedDate = false;
  const explicit = message.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일|(?<!\d)(\d{1,2})월\s*(\d{1,2})일/);
  if (explicit) {
    date.setFullYear(Number(explicit[1] || now.getFullYear()), Number(explicit[2] || explicit[4]) - 1, Number(explicit[3] || explicit[5]));
    matchedDate = true;
  } else if (/모레/.test(message)) { date.setDate(date.getDate() + 2); matchedDate = true; }
  else if (/내일/.test(message)) { date.setDate(date.getDate() + 1); matchedDate = true; }
  else if (/오늘/.test(message)) matchedDate = true;

  const time = message.match(/(오전|오후)?\s*(\d{1,2})\s*(?:시|:)(?:\s*(\d{1,2})\s*분?)?(\s*반)?/);
  if (time) {
    let hour = Number(time[2]);
    const minute = time[4] ? 30 : Number(time[3] || 0);
    if (time[1] === "오후" && hour < 12) hour += 12;
    if (time[1] === "오전" && hour === 12) hour = 0;
    if (hour <= 23 && minute <= 59) date.setHours(hour, minute, 0, 0);
  }
  if (!matchedDate) return null;

  const title = message
    .replace(/(오늘|내일|모레|\d{4}년\s*\d{1,2}월\s*\d{1,2}일|\d{1,2}월\s*\d{1,2}일)/g, "")
    .replace(/(오전|오후)?\s*\d{1,2}\s*(?:시|:)(?:\s*\d{1,2}\s*분?)?(\s*반)?/g, "")
    .replace(/(일정(?:을|에)?|저장(?:해)?줘|추가(?:해)?줘|등록(?:해)?줘|로|에|을|를|해줘)/g, " ")
    .replace(/\s+/g, " ").trim();
  return { title: title || "새 일정", startsAt: date.toISOString(), notes: "" };
}

async function scheduleDraftFromAI(message) {
  if (!client) return null;
  const response = await client.responses.create({
    model: "gpt-5-mini",
    instructions: `당신은 한국어 일정 추출 도우미입니다. 사용자의 문장을 분석해 일정 저장 의도가 있는지 판단하세요.
현재 기준 시각은 ${new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" })}이며 시간대는 Asia/Seoul입니다.
상대 날짜(오늘, 내일, 다음 주 화요일 등)는 이 기준 시각으로 정확한 ISO 8601 날짜·시간으로 변환하세요.
날짜 또는 시간이 부족해 저장하기 어려우면 isSchedule을 false로 설정하세요.
사용자가 일정 저장을 명확히 요청했거나 약속·예약·마감처럼 일정으로 관리할 내용일 때만 isSchedule을 true로 설정하세요.
추측으로 날짜, 시간, 장소를 만들지 마세요. 시작 시간이 없는 경우에도 저장하지 마세요.
title은 날짜·시간 표현과 "일정 저장" 같은 지시어를 제외한 간결한 일정명으로 작성하세요. notes에는 문장에 명시된 보조 정보만 담으세요.`,
    input: message,
    text: {
      format: {
        type: "json_schema",
        name: "schedule_draft",
        strict: true,
        schema: {
          type: "object",
          properties: {
            isSchedule: { type: "boolean" },
            title: { type: "string" },
            startsAt: { type: "string" },
            notes: { type: "string" }
          },
          required: ["isSchedule", "title", "startsAt", "notes"],
          additionalProperties: false
        }
      }
    }
  });
  const draft = JSON.parse(response.output_text);
  if (!draft.isSchedule) return null;
  const validated = validateSchedule(draft);
  return validated.error ? null : validated;
}

function validateSchedule(body = {}) {
  const title = String(body.title || "").trim();
  const startsAt = new Date(body.startsAt);
  const notes = String(body.notes || "").trim();
  if (!title) return { error: "일정 제목을 입력해주세요." };
  if (title.length > 120) return { error: "일정 제목은 120자 이하로 입력해주세요." };
  if (Number.isNaN(startsAt.getTime())) return { error: "올바른 날짜와 시간을 입력해주세요." };
  if (notes.length > 1000) return { error: "메모는 1,000자 이하로 입력해주세요." };
  return { title, startsAt: startsAt.toISOString(), notes };
}

app.post("/api/schedules/draft", requireAuth, csrfRequired, async (req, res) => {
  const message = String(req.body?.message || "").trim();
  if (!message) return res.status(400).json({ error: "일정 내용을 입력해주세요." });
  let draft = null;
  try {
    draft = await scheduleDraftFromAI(message);
  } catch (error) {
    console.error("일정 추출 모델 요청 실패:", error.message);
  }
  res.json({ draft: draft || scheduleDraftFromMessage(message) });
});

app.get("/api/schedules", requireAuth, (req, res) => {
  const schedules = db.prepare("SELECT id, title, starts_at, notes, created_at, updated_at FROM schedules WHERE user_id = ? ORDER BY starts_at ASC")
    .all(req.currentUser.user.id).map(item => ({ id: item.id, title: item.title, startsAt: item.starts_at, notes: item.notes, createdAt: item.created_at, updatedAt: item.updated_at }));
  res.json({ schedules });
});

app.post("/api/schedules", requireAuth, csrfRequired, (req, res) => {
  const schedule = validateSchedule(req.body);
  if (schedule.error) return res.status(400).json({ error: schedule.error });
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO schedules (id, user_id, title, starts_at, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, req.currentUser.user.id, schedule.title, schedule.startsAt, schedule.notes, now, now);
  res.status(201).json({ schedule: { id, ...schedule, createdAt: now, updatedAt: now } });
});

app.delete("/api/schedules/:id", requireAuth, csrfRequired, (req, res) => {
  const result = db.prepare("DELETE FROM schedules WHERE id = ? AND user_id = ?").run(req.params.id, req.currentUser.user.id);
  if (!result.changes) return res.status(404).json({ error: "일정을 찾을 수 없습니다." });
  res.json({ message: "일정이 삭제되었습니다." });
});

function validateSale(body = {}) {
  const saleDate = String(body.saleDate || "").trim();
  const amount = Number(body.amount);
  const notes = String(body.notes || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(saleDate)) return { error: "올바른 날짜를 입력해주세요." };
  const parsedDate = new Date(`${saleDate}T00:00:00Z`);
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== saleDate) return { error: "올바른 날짜를 입력해주세요." };
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > 100000000000) return { error: "매출은 0원 이상, 1,000억 원 이하의 정수로 입력해주세요." };
  if (notes.length > 500) return { error: "메모는 500자 이하로 입력해주세요." };
  return { saleDate, amount, notes };
}

app.get("/api/sales", requireAuth, (req, res) => {
  const month = String(req.query.month || "");
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: "조회할 월을 YYYY-MM 형식으로 입력해주세요." });
  const sales = db.prepare("SELECT id, sale_date, amount, notes, created_at, updated_at FROM sales WHERE user_id = ? AND sale_date LIKE ? ORDER BY sale_date ASC")
    .all(req.currentUser.user.id, `${month}-%`)
    .map(item => ({ id: item.id, saleDate: item.sale_date, amount: item.amount, notes: item.notes, createdAt: item.created_at, updatedAt: item.updated_at }));
  res.json({ sales });
});

app.post("/api/sales", requireAuth, csrfRequired, (req, res) => {
  const sale = validateSale(req.body);
  if (sale.error) return res.status(400).json({ error: sale.error });
  const now = new Date().toISOString();
  const existing = db.prepare("SELECT id, created_at FROM sales WHERE user_id = ? AND sale_date = ?").get(req.currentUser.user.id, sale.saleDate);
  const id = existing?.id || crypto.randomUUID();
  const createdAt = existing?.created_at || now;
  db.prepare(`INSERT INTO sales (id, user_id, sale_date, amount, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, sale_date) DO UPDATE SET amount = excluded.amount, notes = excluded.notes, updated_at = excluded.updated_at`)
    .run(id, req.currentUser.user.id, sale.saleDate, sale.amount, sale.notes, createdAt, now);
  res.status(existing ? 200 : 201).json({ sale: { id, ...sale, createdAt, updatedAt: now } });
});

app.delete("/api/sales/:id", requireAuth, csrfRequired, (req, res) => {
  const result = db.prepare("DELETE FROM sales WHERE id = ? AND user_id = ?").run(req.params.id, req.currentUser.user.id);
  if (!result.changes) return res.status(404).json({ error: "매출 기록을 찾을 수 없습니다." });
  res.json({ message: "매출 기록을 삭제했습니다." });
});

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

app.post("/api/assistant", async (req, res) => {
  try {
    const { message, business } = req.body;

    if (!message?.trim()) {
      return res.status(400).json({ error: "요청 내용을 입력해주세요." });
    }

    if (!client) {
      return res.json({
        demo: true,
        answer: demoAnswer(message, business)
      });
    }

    const businessText = business
      ? `사업장명: ${business.name || "미입력"}
업종: ${business.category || "미입력"}
지역: ${business.location || "미입력"}
주요 상품/서비스: ${business.products || "미입력"}
타깃 고객: ${business.target || "미입력"}
원하는 말투: ${business.tone || "친근하고 정중하게"}`
      : "등록된 사업장 정보가 없습니다.";

    const response = await client.responses.create({
      model: "gpt-5-mini",
      instructions: `당신은 한국 소상공인을 돕는 'AI 사장님 비서'입니다.
사용자가 제공한 사업장 정보만 근거로 답변하세요.
없는 가격, 상품, 행사, 사실을 만들어내지 마세요.
한국어로 자연스럽고 실용적으로 답변하세요.
홍보글이나 고객 안내문은 바로 복사해 사용할 수 있게 작성하세요.

사업장 정보:
${businessText}`,
      input: message.trim()
    });

    res.json({ demo: false, answer: response.output_text });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "AI 요청 중 오류가 발생했습니다.",
      detail: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
});

function demoAnswer(message, business = {}) {
  const name = business?.name || "우리 매장";
  if (/홍보|인스타|광고|이벤트/.test(message)) {
    return `📢 ${name} 홍보문구 예시\n\n오늘도 ${name}을 찾아주시는 고객님께 감사드립니다!\n\n이번 주에는 고객님들이 부담 없이 즐길 수 있는 특별한 혜택을 준비해보세요. 매장의 대표 상품과 함께 소개하면 더욱 효과적입니다. 😊\n\n※ 현재는 DEMO 모드입니다. OpenAI API 키를 연결하면 실제 AI가 사업장 정보를 반영해 작성합니다.`;
  }
  if (/상품|메뉴|설명/.test(message)) {
    return `📝 상품/메뉴 설명 예시\n\n고객이 한눈에 특징과 장점을 이해할 수 있도록 핵심 포인트를 중심으로 작성해보세요.\n\n- 주요 특징\n- 고객에게 좋은 점\n- 추천 상황\n\n※ 현재는 DEMO 모드입니다.`;
  }
  return `안녕하세요! 저는 ${name}을 위한 AI 사장님 비서입니다. 🤖\n\n현재 DEMO 모드에서는 홍보글, 상품 설명, 고객 안내문 등의 예시를 보여드립니다.\n\nOpenAI API 키를 연결하면 실제 AI와 자유롭게 대화할 수 있습니다.`;
}

app.listen(port, () => {
  console.log(`AI 사장님 비서 V1: http://localhost:${port}`);
});
