const $ = (selector) => document.querySelector(selector);

let business = JSON.parse(localStorage.getItem("businessProfile") || "null");

const messages = $("#messages");
const promptInput = $("#prompt");
const form = $("#chatForm");
const modal = $("#modal");
let csrfToken = "";

async function loadAuth() {
  try {
    const res = await fetch("/api/auth/me");
    if (!res.ok) return;
    const { user, csrfToken: token } = await res.json();
    csrfToken = token;
    $("#loginLink").classList.add("hidden");
    $("#profileLink").classList.remove("hidden");
    $("#scheduleLink").classList.remove("hidden");
    $("#salesLink").classList.remove("hidden");
    $("#logoutBtn").classList.remove("hidden");
    $("#userNickname").textContent = user.nickname;
  } catch (_) { /* 로그인 화면은 공개 상태로 유지합니다. */ }
}
loadAuth();

function updateBusinessUI() {
  if (!business) return;
  $("#businessName").textContent = business.name || "내 사업장";
  $("#businessMeta").textContent = `${business.category || "업종 미입력"} · ${business.location || "지역 미입력"}`;
  $("#bName").value = business.name || "";
  $("#bCategory").value = business.category || "";
  $("#bLocation").value = business.location || "";
  $("#bProducts").value = business.products || "";
  $("#bTarget").value = business.target || "";
  $("#bTone").value = business.tone || "친근하고 정중하게";
}
updateBusinessUI();

function addMessage(text, role = "ai") {
  const wrap = document.createElement("div");
  wrap.className = `message ${role}`;
  wrap.innerHTML = `
    <div class="avatar">${role === "ai" ? "✦" : "나"}</div>
    <div class="bubble"></div>
  `;
  wrap.querySelector(".bubble").textContent = text;
  messages.appendChild(wrap);
  messages.scrollTop = messages.scrollHeight;
  return wrap;
}

function toLocalInputValue(iso) {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function addScheduleDraft(draft) {
  const wrap = document.createElement("div");
  wrap.className = "schedule-draft";
  const heading = document.createElement("strong");
  heading.textContent = "📅 일정으로 저장할까요?";
  const titleInput = document.createElement("input");
  titleInput.value = draft.title;
  titleInput.maxLength = 120;
  titleInput.setAttribute("aria-label", "일정 제목");
  const dateInput = document.createElement("input");
  dateInput.type = "datetime-local";
  dateInput.value = toLocalInputValue(draft.startsAt);
  dateInput.setAttribute("aria-label", "일정 날짜와 시간");
  const actions = document.createElement("div");
  actions.className = "schedule-draft-actions";
  const save = document.createElement("button");
  save.type = "button"; save.className = "primary-btn"; save.textContent = "일정 저장";
  const cancel = document.createElement("button");
  cancel.type = "button"; cancel.className = "ghost-btn"; cancel.textContent = "취소";
  save.addEventListener("click", async () => {
    save.disabled = true; save.textContent = "저장 중...";
    try {
      const response = await fetch("/api/schedules", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken }, body: JSON.stringify({ title: titleInput.value, startsAt: dateInput.value, notes: draft.notes }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "일정을 저장하지 못했습니다.");
      wrap.replaceChildren();
      const done = document.createElement("p"); done.textContent = "✅ 일정표에 저장했어요."; wrap.appendChild(done);
    } catch (error) { save.disabled = false; save.textContent = "일정 저장"; alert(error.message); }
  });
  cancel.addEventListener("click", () => wrap.remove());
  actions.append(save, cancel); wrap.append(heading, titleInput, dateInput, actions); messages.appendChild(wrap); messages.scrollTop = messages.scrollHeight;
}

async function askAI(message) {
  addMessage(message, "user");
  promptInput.value = "";

  const loading = addMessage("생각하고 있어요…", "ai");
  loading.classList.add("typing");

  try {
    const res = await fetch("/api/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, business })
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || "요청 실패");
    loading.querySelector(".bubble").textContent = data.answer;
    loading.classList.remove("typing");
    if (csrfToken) {
      const draftResponse = await fetch("/api/schedules/draft", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken }, body: JSON.stringify({ message }) });
      const draftData = await draftResponse.json();
      if (draftResponse.ok && draftData.draft) addScheduleDraft(draftData.draft);
    }
  } catch (error) {
    loading.querySelector(".bubble").textContent =
      "오류가 발생했습니다. 서버가 실행 중인지 확인해주세요.\n\n" + error.message;
    loading.classList.remove("typing");
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const message = promptInput.value.trim();
  if (message) askAI(message);
});

document.querySelectorAll(".quick").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".quick").forEach(x => x.classList.remove("active"));
    btn.classList.add("active");
    promptInput.value = btn.dataset.prompt;
    promptInput.focus();
  });
});

document.querySelectorAll(".suggestion").forEach(btn => {
  btn.addEventListener("click", () => {
    promptInput.value = btn.textContent;
    promptInput.focus();
  });
});

$("#businessBtn").addEventListener("click", () => modal.classList.remove("hidden"));
$("#closeModal").addEventListener("click", () => modal.classList.add("hidden"));
modal.addEventListener("click", (e) => {
  if (e.target === modal) modal.classList.add("hidden");
});

$("#businessForm").addEventListener("submit", (e) => {
  e.preventDefault();
  business = {
    name: $("#bName").value.trim(),
    category: $("#bCategory").value.trim(),
    location: $("#bLocation").value.trim(),
    products: $("#bProducts").value.trim(),
    target: $("#bTarget").value.trim(),
    tone: $("#bTone").value
  };
  localStorage.setItem("businessProfile", JSON.stringify(business));
  updateBusinessUI();
  modal.classList.add("hidden");
  addMessage(`사업장 정보를 저장했어요. 이제 ${business.name || "사업장"}에 맞춰 답변할게요.`, "ai");
});

$("#clearBtn").addEventListener("click", () => {
  messages.innerHTML = "";
  addMessage("대화를 초기화했어요. 무엇을 도와드릴까요?", "ai");
});

$("#logoutBtn").addEventListener("click", async () => {
  try {
    if (!csrfToken) {
      const response = await fetch("/api/auth/csrf");
      csrfToken = (await response.json()).csrfToken;
    }
    await fetch("/api/auth/logout", { method: "POST", headers: { "X-CSRF-Token": csrfToken } });
  } finally {
    window.location.href = "/login";
  }
});
