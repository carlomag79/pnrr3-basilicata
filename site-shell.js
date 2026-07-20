(function () {
  function initSiteShell() {
    const path = window.location.pathname.toLowerCase();
    const page = path.split("/").pop() || "index.html";
    const isHome = page === "index.html";
    const isSchools = page === "scuole.html";
    const isAccount = page === "account.html";
    const homeAnchor = anchor => isHome ? anchor : `index.html${anchor}`;

    const root = document.querySelector("#site-navigation");
    if (!root || root.dataset.ready === "true") return;
    root.dataset.ready = "true";

    root.innerHTML = `
      <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="mobile-drawer">
        <span class="menu-toggle__icon" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="menu-toggle__label">Menu</span>
      </button>
      <nav class="site-nav site-nav--desktop" aria-label="Navigazione principale">
        <a href="index.html"${isHome ? ' aria-current="page"' : ""}>Home</a>
        <a href="${homeAnchor("#dashboard-section")}">Dashboard</a>
        <a href="${homeAnchor("#map-section")}">Mappa</a>
        <a href="${homeAnchor("#results-section")}">Risultati</a>
        <a href="scuole.html"${isSchools ? ' aria-current="page"' : ""}>Scuole</a>
        <a href="assignments.html"${location.pathname.endsWith("assignments.html") ? ' aria-current="page"' : ""}>Assegnazioni</a>
        <a href="project.html"${location.pathname.endsWith("project.html") ? ' aria-current="page"' : ""}>Il progetto</a>
        <a href="account.html" class="account-menu-link"${isAccount ? ' aria-current="page"' : ""}>Log in</a>
      </nav>`;

    document.querySelector("#mobile-drawer")?.remove();

    const drawer = document.createElement("div");
    drawer.id = "mobile-drawer";
    drawer.className = "mobile-drawer";
    drawer.hidden = true;
    drawer.innerHTML = `
      <button class="mobile-drawer__backdrop" type="button" aria-label="Chiudi menu"></button>
      <aside class="mobile-drawer__panel" role="dialog" aria-modal="true" aria-label="Menu">
        <div class="mobile-drawer__head">
          <strong>Vincitori PNRR3 Basilicata Infanzia / Primaria</strong>
          <button class="mobile-drawer__close" type="button" aria-label="Chiudi menu">×</button>
        </div>
        <nav class="mobile-drawer__nav">
          <a href="index.html">Home</a>
          <a href="${homeAnchor("#dashboard-section")}">Dashboard</a>
          <a href="${homeAnchor("#map-section")}">Mappa delle preferenze</a>
          <a href="${homeAnchor("#results-section")}">Risultati</a>
          <a href="scuole.html">Scuole disponibili</a>
          <a href="assignments.html">Assegnazioni ufficiali</a>
          <a href="project.html">Il progetto</a>
          <a href="account.html" class="account-menu-link">Log in</a>
        </nav>
      </aside>`;
    document.body.appendChild(drawer);

    const toggle = root.querySelector(".menu-toggle");

    function closeMenu() {
      toggle.setAttribute("aria-expanded", "false");
      drawer.hidden = true;
      document.documentElement.classList.remove("menu-open");
      document.body.classList.remove("menu-open");
    }

    function openMenu() {
      toggle.setAttribute("aria-expanded", "true");
      drawer.hidden = false;
      document.documentElement.classList.add("menu-open");
      document.body.classList.add("menu-open");
    }

    toggle.addEventListener("click", () => drawer.hidden ? openMenu() : closeMenu());
    drawer.querySelector(".mobile-drawer__close").addEventListener("click", closeMenu);
    drawer.querySelector(".mobile-drawer__backdrop").addEventListener("click", closeMenu);
    drawer.querySelectorAll("a").forEach(link => link.addEventListener("click", closeMenu));
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && !drawer.hidden) closeMenu();
    });

    function updateAccountMenu(session) {
      const label = session?.user ? "Il mio account" : "Log in";
      document.querySelectorAll(".account-menu-link").forEach(link => {
        link.textContent = label;
        link.setAttribute(
          "aria-label",
          session?.user ? "Apri il mio account" : "Accedi o registrati"
        );
      });
    }

    updateAccountMenu(null);

    if (
      window.supabase &&
      window.APP_CONFIG?.SUPABASE_URL &&
      window.APP_CONFIG?.SUPABASE_KEY
    ) {
      try {
        const authClient = window.supabase.createClient(
          window.APP_CONFIG.SUPABASE_URL,
          window.APP_CONFIG.SUPABASE_KEY
        );

        authClient.auth.getSession().then(({ data }) => {
          updateAccountMenu(data?.session || null);
        });

        authClient.auth.onAuthStateChange((_event, session) => {
          updateAccountMenu(session);
        });
      } catch (error) {
        console.error("Impossibile determinare lo stato dell’account.", error);
      }
    }

    const footerRoot =
      document.querySelector("#site-footer") ||
      document.querySelector(".site-footer");

    if (footerRoot && footerRoot.dataset.ready !== "true") {
      footerRoot.dataset.ready = "true";
      footerRoot.classList.add("site-footer");
      footerRoot.innerHTML = `
        <div class="container site-footer__inner">
          <p>
            Progetto nato da un’idea di
            <a href="https://carlomagni.it" target="_blank" rel="noopener noreferrer">Carlo Magni</a>
            e del gruppo WhatsApp “Concorso Vincitori PNRR3 Basilicata Infanzia / Primaria Infanzia e Primaria”.
          </p>
          <p class="footer-admin-link"><a href="admin.html">Area amministrativa</a></p>
        </div>`;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initSiteShell, { once: true });
  } else {
    initSiteShell();
  }
})();