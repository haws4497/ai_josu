document.addEventListener("click", event => {
  const link = event.target.closest("a[href]");
  if (!link || event.defaultPrevented || link.target || link.hasAttribute("download")) return;
  const target = new URL(link.href, window.location.href);
  if (target.origin !== window.location.origin || (target.pathname === window.location.pathname && target.hash)) return;
  event.preventDefault();
  document.body.classList.add("is-leaving");
  window.setTimeout(() => { window.location.href = target.href; }, 180);
});
