const sales$ = selector => document.querySelector(selector);
let salesCsrf = "";
let currentMonth = new Date();
let monthSales = [];

function salesMessage(text, type = "error") { const box = sales$("#salesMessage"); box.textContent = text; box.className = `form-message ${type}`; }
function monthKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; }
function dateKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function money(value) { return `${Number(value).toLocaleString("ko-KR")}원`; }
function renderCalendar() {
  const year = currentMonth.getFullYear(); const month = currentMonth.getMonth();
  sales$("#monthLabel").textContent = `${year}년 ${month + 1}월`;
  const firstDay = new Date(year, month, 1).getDay(); const lastDate = new Date(year, month + 1, 0).getDate();
  const byDate = new Map(monthSales.map(item => [item.saleDate, item])); const grid = sales$("#calendarGrid"); grid.replaceChildren();
  for (let i = 0; i < firstDay; i += 1) { const blank = document.createElement("div"); blank.className = "calendar-day blank"; grid.appendChild(blank); }
  for (let day = 1; day <= lastDate; day += 1) {
    const key = dateKey(new Date(year, month, day)); const item = byDate.get(key); const cell = document.createElement("button"); cell.type = "button"; cell.className = "calendar-day" + (item ? " has-sales" : ""); cell.dataset.date = key;
    const number = document.createElement("span"); number.className = "day-number"; number.textContent = day;
    const amount = document.createElement("strong"); amount.textContent = item ? money(item.amount) : "-";
    cell.append(number, amount); cell.addEventListener("click", () => fillSaleForm(key, item)); grid.appendChild(cell);
  }
  sales$("#monthTotal").textContent = money(monthSales.reduce((sum, item) => sum + item.amount, 0));
}
function fillSaleForm(date, item) { sales$("#saleDate").value = date; sales$("#saleAmount").value = item?.amount ?? ""; sales$("#salesForm [name=notes]").value = item?.notes ?? ""; sales$("#saleAmount").focus(); }
async function loadMonth() { const response = await fetch(`/api/sales?month=${monthKey(currentMonth)}`); if (!response.ok) return window.location.replace("/login"); monthSales = (await response.json()).sales; renderCalendar(); }

(async () => { const me = await fetch("/api/auth/me"); if (!me.ok) return window.location.replace("/login"); salesCsrf = (await me.json()).csrfToken; const today = new Date(); sales$("#saleDate").value = dateKey(today); await loadMonth(); })();
sales$("#prevMonth").addEventListener("click", () => { currentMonth.setMonth(currentMonth.getMonth() - 1); loadMonth(); });
sales$("#nextMonth").addEventListener("click", () => { currentMonth.setMonth(currentMonth.getMonth() + 1); loadMonth(); });
sales$("#salesForm").addEventListener("submit", async event => { event.preventDefault(); const button = event.currentTarget.querySelector("button"); button.disabled = true; button.textContent = "저장 중..."; try { const response = await fetch("/api/sales", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": salesCsrf }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "매출을 저장하지 못했습니다."); salesMessage("하루 매출을 저장했습니다.", "success"); currentMonth = new Date(`${data.sale.saleDate}T00:00:00`); await loadMonth(); } catch (error) { salesMessage(error.message); } finally { button.disabled = false; button.textContent = "매출 저장"; } });
