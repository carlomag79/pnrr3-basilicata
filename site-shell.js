(function () {
  const path = window.location.pathname.toLowerCase();
  const isSchoolsPage = path.endsWith("scuole.html");

  const navigationRoot = document.querySelector("#site-navigation");
  if (navigationRoot) {
    const homeHref = isSchoolsPage ? "index.html" : "#top";
    const dashboardHref = isSchoolsPage ? "index.html#dashboard-section" : "#dashboard-section";
    const formHref = isSchoolsPage ? "index.html#form-section" : "#form-section";
    const manageHref = isSchoolsPage ? "index.html#manage-section" : "#manage-section";
    const mapHref = isSchoolsPage ? "index.html#map-section" : "#map-section";
    const resultsHref = isSchoolsPage ? "index.html#results-section" : "#results-section";

    navigationRoot.innerHTML = `
      <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="primary-menu">
        <span class="menu-toggle__icon" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="menu-toggle__label">Menu</span>
      </button>
      <nav id="primary-menu" class="site-nav" aria-label="Navigazione principale">
        <a href="${homeHref}"${!isSchoolsPage ? ' aria-current="page"' : ''}>Home</a>
        <a href="${dashboardHref}">Dashboard</a>
        <a href="${formHref}">Compila</a>
        <a href="${manageHref}">Modifica dati</a>
        <a href="${mapHref}">Mappa</a>
        <a href="${resultsHref}">Risultati</a>
        <a href="scuole.html"${isSchoolsPage ? ' aria-current="page"' : ''}>Scuole</a>
      </nav>
    `;

    const toggle = navigationRoot.querySelector(".menu-toggle");
    const menu = navigationRoot.querySelector(".site-nav");

    toggle.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!open));
      menu.classList.toggle("is-open", !open);
    });

    menu.addEventListener("click", event => {
      if (event.target.closest("a")) {
        toggle.setAttribute("aria-expanded", "false");
        menu.classList.remove("is-open");
      }
    });

    document.addEventListener("click", event => {
      if (!navigationRoot.contains(event.target)) {
        toggle.setAttribute("aria-expanded", "false");
        menu.classList.remove("is-open");
      }
    });
  }

  const footer = document.querySelector("#site-footer");
  if (footer) {
    const schoolCredit = isSchoolsPage
      ? '<p>Dati scolastici: Ministero dell’Istruzione e del Merito, anagrafe scuole statali 2026/2027.</p>'
      : '';

    footer.innerHTML = `
      <div class="container">
        ${schoolCredit}
        <p>Dati cartografici: ISTAT / Openpolis. Mappa: Leaflet e OpenStreetMap.</p>
        <p class="project-credit">
          Progetto nato da un’idea di
          <a href="https://carlomagni.it" target="_blank" rel="noopener noreferrer">Carlo Magni</a>
          e del gruppo WhatsApp “Concorso PNRR3 Basilicata Infanzia e Primaria”.
        </p>
        <p class="footer-admin-link"><a href="admin.html">Area amministrativa</a></p>
      </div>
    `;
  }
})();
