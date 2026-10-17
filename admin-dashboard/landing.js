// ==========================================================================
// OMOS (One Mining System Operation) — Enterprise Landing Page Controller
// ==========================================================================
(function () {
  const layarLogin = document.getElementById('layarLogin');
  if (!layarLogin) return;

  // 1. Dark / Light Theme Switcher (Sun & Moon)
  const btnThemeToggle = document.getElementById('btnThemeToggle');
  const THEME_KEY = 'omos_landing_theme';

  function applyTheme(theme) {
    const next = theme === 'light' ? 'light' : 'dark';
    layarLogin.setAttribute('data-theme', next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (_) {}
  }

  try {
    const savedTheme = localStorage.getItem(THEME_KEY);
    if (savedTheme === 'light' || savedTheme === 'dark') {
      applyTheme(savedTheme);
    } else {
      layarLogin.setAttribute('data-theme', 'dark');
    }
  } catch (_) {
    layarLogin.setAttribute('data-theme', 'dark');
  }

  btnThemeToggle?.addEventListener('click', () => {
    const current = layarLogin.getAttribute('data-theme') || 'dark';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });

  // 2. Live Cockpit Clock
  function updateLandingClock() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('id-ID', { hour12: false, timeZone: 'Asia/Jakarta' }) + ' WIB';
    const c1 = document.getElementById('lpLiveClock');
    if (c1) c1.textContent = timeStr;
  }
  updateLandingClock();
  setInterval(updateLandingClock, 1000);

  // 3. Cockpit Tab Switcher
  document.querySelectorAll('#layarLogin [data-cockpit-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-cockpit-tab');
      document.querySelectorAll('#layarLogin [data-cockpit-tab]').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      document.querySelectorAll('#layarLogin .lp-cockpit-pane').forEach((pane) => {
        pane.hidden = pane.id !== `cockpitPane-${target}`;
      });
    });
  });

  // 4. Modal Login Open / Close & Tabs
  const modalLogin = document.getElementById('modalLoginOmos');
  const tabAdmin = document.getElementById('tabBtnAdminLogin');
  const tabPortal = document.getElementById('tabBtnPortalKaryawan');
  const paneAdmin = document.getElementById('paneAdminLogin');
  const panePortal = document.getElementById('panePortalKaryawan');

  function switchLoginTab(mode) {
    const isPortal = mode === 'portal';
    if (tabAdmin) tabAdmin.classList.toggle('is-active', !isPortal);
    if (tabPortal) tabPortal.classList.toggle('is-active', isPortal);
    if (paneAdmin) paneAdmin.hidden = isPortal;
    if (panePortal) panePortal.hidden = !isPortal;
  }

  function openLoginModal(defaultTab = 'admin') {
    if (!modalLogin) return;
    modalLogin.hidden = false;
    switchLoginTab(defaultTab);
    if (defaultTab === 'admin') {
      setTimeout(() => document.getElementById('inputEmail')?.focus(), 60);
    }
  }

  function closeLoginModal() {
    if (modalLogin) modalLogin.hidden = true;
  }

  ['btnNavLogin', 'btnHeroLogin', 'btnCardLogin'].forEach((id) => {
    document.getElementById(id)?.addEventListener('click', () => openLoginModal('admin'));
  });
  document.getElementById('btnCloseLoginModal')?.addEventListener('click', closeLoginModal);
  modalLogin?.addEventListener('click', (e) => {
    if (e.target === modalLogin) closeLoginModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalLogin && !modalLogin.hidden) {
      closeLoginModal();
    }
  });

  tabAdmin?.addEventListener('click', () => switchLoginTab('admin'));
  tabPortal?.addEventListener('click', () => switchLoginTab('portal'));

  // 4b. Auto-sanitize Email Input (otomatis ubah koma ',' menjadi titik '.' & hapus spasi agar validasi HTML5 tidak gagal)
  const inputEmail = document.getElementById('inputEmail');
  function sanitizeEmailField() {
    if (!inputEmail) return;
    const cleaned = inputEmail.value.replace(/,/g, '.').replace(/\s+/g, '');
    if (inputEmail.value !== cleaned) {
      inputEmail.value = cleaned;
    }
    inputEmail.setCustomValidity('');
  }
  inputEmail?.addEventListener('input', sanitizeEmailField);
  inputEmail?.addEventListener('change', sanitizeEmailField);
  inputEmail?.addEventListener('blur', sanitizeEmailField);

  // 5. Contact Us Form Handler (WhatsApp & Email)
  const formContact = document.getElementById('formContactOmos');
  const feedbackEl = document.getElementById('contactFeedbackMsg');

  function getContactPayload() {
    return {
      name: document.getElementById('inContactName')?.value.trim() || '',
      company: document.getElementById('inContactCompany')?.value.trim() || '',
      role: document.getElementById('inContactRole')?.value.trim() || '-',
      module: document.getElementById('inContactModule')?.value || 'Full Suite OMOS',
      message: document.getElementById('inContactMessage')?.value.trim() || '',
    };
  }

  formContact?.addEventListener('submit', (e) => {
    e.preventDefault();
    const payload = getContactPayload();
    const text = [
      `*Halo Tim OMOS (One Mining System Operation)*`,
      `Saya ingin mendiskusikan implementasi / request demo OMOS:`,
      `• *Nama:* ${payload.name}`,
      `• *Perusahaan/Site:* ${payload.company}`,
      `• *Jabatan:* ${payload.role}`,
      `• *Fokus Modul:* ${payload.module}`,
      `• *Kebutuhan:* ${payload.message}`,
    ].join('\n');

    if (feedbackEl) {
      feedbackEl.hidden = false;
      feedbackEl.textContent = `✓ Membuka WhatsApp untuk meneruskan pesan dari ${payload.name}...`;
    }
    const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(waUrl, '_blank', 'noopener,noreferrer');
  });

  document.getElementById('btnContactEmail')?.addEventListener('click', () => {
    const payload = getContactPayload();
    if (!payload.name || !payload.company) {
      if (feedbackEl) {
        feedbackEl.hidden = false;
        feedbackEl.textContent = 'Silakan lengkapi Nama dan Perusahaan terlebih dahulu.';
      }
      return;
    }
    const subject = `[OMOS Inquiry] ${payload.company} — ${payload.module}`;
    const body = [
      `Halo Tim OMOS (One Mining System Operation),`,
      ``,
      `Nama: ${payload.name}`,
      `Perusahaan / Site: ${payload.company}`,
      `Jabatan / Departemen: ${payload.role}`,
      `Fokus Modul Prioritas: ${payload.module}`,
      ``,
      `Pesan / Kebutuhan Operasional:`,
      payload.message,
    ].join('\n');
    if (feedbackEl) {
      feedbackEl.hidden = false;
      feedbackEl.textContent = `✓ Membuka aplikasi email untuk support@omos-mining.com...`;
    }
    window.location.href = `mailto:support@omos-mining.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  });
})();
