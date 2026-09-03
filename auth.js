const $ = selector => document.querySelector(selector);
let csrfToken = "";

document.addEventListener("click", event => {
  const link = event.target.closest("a[href]");
  if (!link || event.defaultPrevented || link.target || link.hasAttribute("download")) return;
  const target = new URL(link.href, window.location.href);
  if (target.origin !== window.location.origin || (target.pathname === window.location.pathname && target.hash)) return;
  event.preventDefault(); document.body.classList.add("is-leaving");
  window.setTimeout(() => { window.location.href = target.href; }, 180);
});

async function getCsrfToken() {
  if (csrfToken) return csrfToken;
  let response;
  try {
    response = await fetch("/api/auth/csrf");
  } catch (error) {
    throw new Error("서버에 연결할 수 없습니다. 서버가 실행 중인지 확인해주세요.");
  }
  if (!response.ok) {
    throw new Error(`인증 토큰을 가져오지 못했습니다. (상태 코드: ${response.status})`);
  }
  let data;
  try {
    data = await response.json();
  } catch (error) {
    throw new Error("서버가 올바르지 않은 응답을 반환했습니다. /api/auth/csrf 엔드포인트를 확인해주세요.");
  }
  if (!data || !data.csrfToken) {
    throw new Error("서버 응답에 csrfToken이 없습니다. 백엔드 구현을 확인해주세요.");
  }
  csrfToken = data.csrfToken;
  return csrfToken;
}

function showMessage(text, type = "error") {
  const box = $("#formMessage");
  if (!box) return;
  box.textContent = text;
  box.className = `form-message ${type}`;
}

function setLoading(button, loading, loadingText) {
  button.disabled = loading;
  button.textContent = loading ? loadingText : button.dataset.defaultText;
}

async function request(url, body) {
  const token = await getCsrfToken();
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": token }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "요청 처리 중 오류가 발생했습니다.");
  if (data.csrfToken) csrfToken = data.csrfToken;
  return data;
}

document.querySelectorAll(".toggle-password").forEach(button => button.addEventListener("click", () => {
  const input = document.getElementById(button.dataset.target);
  const isPassword = input.type === "password";
  input.type = isPassword ? "text" : "password";
  button.textContent = isPassword ? "숨기기" : "보기";
  button.setAttribute("aria-label", isPassword ? "비밀번호 숨기기" : "비밀번호 보기");
}));

const registerForm = $("#registerForm");
if (registerForm) registerForm.addEventListener("submit", async event => {
  event.preventDefault(); showMessage("");
  const button = registerForm.querySelector("button[type=submit]");
  const values = Object.fromEntries(new FormData(registerForm));
  if (values.password !== values.passwordConfirm) return showMessage("비밀번호가 일치하지 않습니다.");
  setLoading(button, true, "가입 중...");
  try { const data = await request("/api/auth/register", values); showMessage(data.message, "success"); setTimeout(() => { window.location.href = "/login"; }, 700); }
  catch (error) { showMessage(error.message); }
  finally { setLoading(button, false); }
});

const loginForm = $("#loginForm");
if (loginForm) loginForm.addEventListener("submit", async event => {
  event.preventDefault(); showMessage("");
  const button = loginForm.querySelector("button[type=submit]");
  const values = Object.fromEntries(new FormData(loginForm));
  setLoading(button, true, "로그인 중...");
  try { await request("/api/auth/login", values); window.location.href = "/"; }
  catch (error) { showMessage(error.message); }
  finally { setLoading(button, false); }
});

const forgotForm = $("#forgotForm");
if (forgotForm) forgotForm.addEventListener("submit", async event => {
  event.preventDefault(); showMessage("");
  const button = forgotForm.querySelector("button[type=submit]");
  setLoading(button, true, "확인 중...");
  try { const data = await request("/api/auth/forgot-password", Object.fromEntries(new FormData(forgotForm))); showMessage(data.message, "success"); }
  catch (error) { showMessage(error.message); }
  finally { setLoading(button, false); }
});

const profile = $("#profile");
if (profile) (async () => {
  const response = await fetch("/api/auth/me");
  if (!response.ok) return window.location.replace("/login");
  const { user, csrfToken: token } = await response.json(); csrfToken = token;
  $("#profileName").textContent = user.name;
  $("#profileNickname").textContent = user.nickname;
  $("#profileEmail").textContent = user.email;
  $("#profileCreatedAt").textContent = new Intl.DateTimeFormat("ko-KR", { dateStyle: "long" }).format(new Date(user.createdAt));
})();

const logoutButton = $("#logoutButton");
if (logoutButton) logoutButton.addEventListener("click", async () => { try { await request("/api/auth/logout", {}); } finally { window.location.href = "/login"; } });