(function () {
  const path = window.location.pathname.toLowerCase();
  const page = path.split("/").pop() || "index.html";
  const isHome = page === "" || page === "index.html";
  const isSchools = page === "scuole.html";
  const isAccount = page === "account.html";

  const homeAnchor = anchor => isHome ? anchor : `index.html${anchor}`;

  const root = document.querySelector("#site-navigation");
  if (root) {
    root.innerHTML = `
      <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="mobile-drawer">
        <span class="menu-toggle__icon" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="menu-toggle__label">Menu</span>
      </button>

      <nav class="site-nav site-nav--desktop" aria-label="Navigazione principale">
        <a href="index.html"${isHome ? ' aria-current="page"' : ""}>Home</a>
        <a href="${homeAnchor("#dashboard-section")}">Dashboard</a>
        <a href="account.html"${isAccount ? ' aria-current="page"' : ""}>Le mie preferenze</a>
        <a href="${homeAnchor("#map-section")}">Mappa</a>
        <a href="${homeAnchor("#results-section")}">Risultati</a>
        <a href="scuole.html"${isSchools ? ' aria-current="page"' : ""}>Scuole</a>
      </nav>
    `;

    const drawer = document.createElement("div");
    drawer.id = "mobile-drawer";
    drawer.className = "mobile-drawer";
    drawer.hidden = true;
    drawer.innerHTML = `
      <button class="mobile-drawer__backdrop" type="button" aria-label="Chiudi menu"></button>
      <aside class="mobile-drawer__panel" aria-label="Menu mobile">
        <div class="mobile-drawer__head">
          <strong>PNRR3 Basilicata</strong>
          <button class="mobile-drawer__close" type="button" aria-label="Chiudi menu">×</button>
        </div>
        <nav class="mobile-drawer__nav">
          <a href="index.html">Home</a>
          <a href="${homeAnchor("#dashboard-section")}">Dashboard</a>
          <a href="account.html">Le mie preferenze</a>
          <a href="${homeAnchor("#map-section")}">Mappa delle preferenze</a>
          <a href="${homeAnchor("#results-section")}">Risultati</a>
          <a href="scuole.html">Scuole disponibili</a>
        </nav>
      </aside>
    `;
    document.body.appendChild(drawer);

    const toggle = root.querySelector(".menu-toggle");
    const closeButtons = drawer.querySelectorAll(".mobile-drawer__close, .mobile-drawer__backdrop");

    function setOpen(open) {
      toggle.setAttribute("aria-expanded", String(open));
      drawer.hidden = !open;
      document.documentElement.classList.toggle("menu-open", open);
      document.body.classList.toggle("menu-open", open);
      if (open) drawer.querySelector(".mobile-drawer__close").focus();
    }

    toggle.addEventListener("click", () => setOpen(drawer.hidden));
    closeButtons.forEach(button => button.addEventListener("click", () => setOpen(false)));
    drawer.querySelectorAll("a").forEach(link => link.addEventListener("click", () => setOpen(false)));
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && !drawer.hidden) setOpen(false);
    });
  }

  const footer = document.querySelector(".site-footer");
  if (footer && !footer.dataset.sharedFooter) {
    footer.dataset.sharedFooter = "true";
  }
})();