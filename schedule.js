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

function message(text, type = "error") { const box = $("#scheduleMessage"); box.textContent = text; box.className = `form-message ${type}`; }
function formatDate(value) { return new Intl.DateTimeFormat("ko-KR", { dateStyle:"medium", timeStyle:"short" }).format(new Date(value)); }
async function loadSchedules() {
  const response = await fetch("/api/schedules");
  if (!response.ok) return window.location.replace("/login");
  const { schedules } = await response.json();
  const list = $("#scheduleList"); list.replaceChildren();
  if (!schedules.length) { const empty = document.createElement("p"); empty.className = "empty-schedule"; empty.textContent = "등록된 일정이 없습니다."; list.appendChild(empty); return; }
  schedules.forEach(item => {
    const card = document.createElement("article"); card.className = "schedule-item";
    const title = document.createElement("strong"); title.textContent = item.title;
    const date = document.createElement("time"); date.textContent = formatDate(item.startsAt); date.dateTime = item.startsAt;
    const notes = document.createElement("p"); notes.textContent = item.notes;
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "schedule-delete"; remove.textContent = "삭제";
    remove.addEventListener("click", async () => { if (!confirm("이 일정을 삭제할까요?")) return; const res = await fetch(`/api/schedules/${item.id}`, { method:"DELETE", headers:{"X-CSRF-Token":csrfToken} }); if (!res.ok) return message("일정을 삭제하지 못했습니다."); loadSchedules(); });
    card.append(title, date); if (item.notes) card.append(notes); card.append(remove); list.appendChild(card);
  });
}

(async () => { const me = await fetch("/api/auth/me"); if (!me.ok) return window.location.replace("/login"); csrfToken = (await me.json()).csrfToken; loadSchedules(); })();
$("#scheduleForm").addEventListener("submit", async event => { event.preventDefault(); const button = $("#scheduleForm button"); button.disabled=true; button.textContent="저장 중..."; try { const response = await fetch("/api/schedules", {method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":csrfToken},body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))}); const data=await response.json(); if(!response.ok) throw new Error(data.error); event.currentTarget.reset(); message("일정을 저장했어요.","success"); loadSchedules(); } catch(error) { message(error.message); } finally {button.disabled=false;button.textContent="일정 추가";} });
