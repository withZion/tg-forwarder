/* Forwarder landing page. No dependencies. */
(() => {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Reveal on scroll ---------- */
  const show = (el) => el.classList.add("in");
  if ("IntersectionObserver" in window && !reduced) {
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) { show(e.target); io.unobserve(e.target); }
    }), { rootMargin: "0px 0px -10% 0px" });
    document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
  } else {
    document.querySelectorAll(".reveal").forEach(show);
  }

  /* ---------- The relay ---------- */
  const stage = document.querySelector("[data-relay]");
  if (!stage || reduced || !("animate" in Element.prototype)) return;
  const bubble = stage.querySelector("[data-bubble]");
  const node = (k) => stage.querySelector(`[data-node="${k}"]`);
  const rule = (k) => stage.querySelector(`[data-rule="${k}"]`);
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // Each message: where it starts, which rules act on it, and what arrives
  const FOOTER = "Shared by Ada";
  const messages = [
    { src: "s0", dst: "d0", from: "News Wire Africa", rules: ["links", "footer"],
      raw: "Central bank holds rates, markets steady ahead of Friday. <s>t.me/nwa/48211</s>",
      out: "Central bank holds rates, markets steady ahead of Friday." },
    { src: "s1", from: "The Morning Brief", rules: ["block"], blocked: true,
      raw: "Sponsored: 50% off premium signals this week" },
    { src: "s2", dst: "d1", from: "Crypto Signals Daily", rules: ["mentions", "footer"],
      raw: "BTC holds 70k as volume returns <s>@cryptoguru</s>",
      out: "BTC holds 70k as volume returns" },
  ];

  const centre = (el) => {
    const s = stage.getBoundingClientRect(), r = el.getBoundingClientRect();
    return { x: r.left - s.left + r.width / 2, y: r.top - s.top + r.height / 2 };
  };
  const place = (p, scale = 1) => {
    const w = bubble.offsetWidth, h = bubble.offsetHeight;
    return `translate(${(p.x - w / 2).toFixed(1)}px, ${(p.y - h / 2).toFixed(1)}px) scale(${scale})`;
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const move = (from, to, ms, extra = {}) =>
    bubble.animate([{ transform: place(from, extra.s0 ?? 1), opacity: extra.o0 ?? 1 }, { transform: place(to, extra.s1 ?? 1), opacity: extra.o1 ?? 1 }],
      { duration: ms, easing: "cubic-bezier(.45,0,.2,1)", fill: "forwards" }).finished;
  const ping = (el) => { el.classList.add("ping"); setTimeout(() => el.classList.remove("ping"), 900); };

  let running = false, inView = false;
  const play = async () => {
    if (running) return;
    running = true;
    let i = 0;
    while (inView && !document.hidden) {
      const m = messages[i % messages.length];
      const src = node(m.src), rules = node("rules");
      bubble.classList.remove("blocked");
      bubble.innerHTML = `<span class="from">${esc(m.from)}</span>${m.raw}`;
      ping(src);
      await move(centre(src), centre(src), 1, { o0: 0, o1: 0 });
      await move(centre(src), centre(rules), 1100, { o0: 0, s0: .85 });
      // The rules act
      m.rules.forEach((k) => rule(k).classList.add("on"));
      await wait(900);
      if (m.blocked) {
        bubble.classList.add("blocked");
        bubble.innerHTML = `<span class="from">${esc(m.from)}</span>Blocked: contains "sponsored"`;
        await wait(900);
        await move(centre(rules), { ...centre(rules), y: centre(rules).y + 30 }, 600, { o1: 0, s1: .9 });
      } else {
        bubble.innerHTML = `<span class="from">${esc(m.from)}</span>${esc(m.out)}<span class="foot">${esc(FOOTER)}</span>`;
        await wait(700);
        const dst = node(m.dst);
        await move(centre(rules), centre(dst), 1100);
        ping(dst);
        await move(centre(dst), centre(dst), 500, { o1: 0, s1: .9 });
      }
      m.rules.forEach((k) => rule(k).classList.remove("on"));
      await wait(500);
      i++;
    }
    running = false;
  };

  new IntersectionObserver(([e]) => { inView = e.isIntersecting; if (inView) play(); }, { threshold: 0.15 }).observe(stage);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && inView) play(); });
})();
