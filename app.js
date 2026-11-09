/* =====================================================================
   APP LÍDERES — registro con guardado local y subida automática
   Flujo: guardar en el celular -> subir cuando haya señal
   ===================================================================== */
(() => {
  const CFG = window.APP_CONFIG;
  const $ = (id) => document.getElementById(id);
  const K = { sesion: "ld_sesion", cola: "ld_cola", rech: "ld_rechazados", lista: "ld_lista", stats: "ld_stats" };

  // ---------- almacenamiento local ----------
  const leer = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } };
  const guardar = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  let sesion = leer(K.sesion, null);
  let sincronizando = false;
  let gps = null;

  // ---------- llamada al servidor ----------
  async function rpc(fn, params) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    try {
      const r = await fetch(`${CFG.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: CFG.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${CFG.SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify(params),
        signal: ctrl.signal
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }

  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() :
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16);
    }));
  const soloDigitos = (s) => (s || "").replace(/\D/g, "");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const RESP = { si: "Sí", no: "No", tal_vez: "Tal vez" };

  function toast(msg, ms = 2600) {
    const t = $("toast"); t.textContent = msg; t.classList.add("ver");
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("ver"), ms);
  }

  // ---------- vistas ----------
  function mostrar(vista) {
    $("v-login").hidden = vista !== "login";
    $("v-app").hidden = vista !== "app";
  }

  function pintarEstado() {
    const cola = leer(K.cola, []);
    const stats = leer(K.stats, { total: 0, hoy: 0 });
    $("s-total").textContent = stats.total + cola.length;
    $("s-hoy").textContent = stats.hoy + cola.filter(x => new Date(x.creado).toDateString() === new Date().toDateString()).length;
    $("s-pend").textContent = cola.length;
    document.querySelector(".stat.pend").classList.toggle("activo", cola.length > 0);

    const er = $("estado-red");
    if (sincronizando) { er.textContent = "Subiendo registros…"; er.style.setProperty("--estado", "#e8a33d"); }
    else if (!navigator.onLine) { er.textContent = "Sin señal · los registros se guardan en el celular"; er.style.setProperty("--estado", "#e74c3c"); }
    else if (cola.length) { er.textContent = `${cola.length} por subir · se enviarán automáticamente`; er.style.setProperty("--estado", "#e8a33d"); }
    else { er.textContent = "En línea · todo está subido"; er.style.setProperty("--estado", "#3ddc84"); }
  }

  function pintarLista() {
    const filtro = $("buscar").value.trim().toLowerCase();
    const coincide = (p) => !filtro || (p.nombre || "").toLowerCase().includes(filtro) || (p.cedula || "").includes(filtro);
    const cola = leer(K.cola, []).filter(coincide);
    const rech = leer(K.rech, []).filter(coincide);
    const lista = leer(K.lista, []).filter(coincide);
    let html = "";
    rech.forEach(p => html += `
      <li><div><div class="n">${esc(p.nombre)}</div><div class="d">CC ${esc(p.cedula)}</div>
        <div class="err-msg">${esc(p.mensaje)}</div></div>
        <div><span class="chip err">No subido</span><br><button class="btn-x" data-quitar="${esc(p.client_uuid)}">Quitar</button></div></li>`);
    cola.forEach(p => html += `
      <li><div><div class="n">${esc(p.nombre)}</div><div class="d">CC ${esc(p.cedula)} · ${RESP[p.respuesta]}</div></div>
        <span class="chip pend">Por subir</span></li>`);
    lista.forEach(p => html += `
      <li><div><div class="n">${esc(p.nombre)}</div><div class="d">CC ${esc(p.cedula)}${p.con_gps ? " · 📍" : ""}${p.direccion ? " · " + esc(p.direccion) : ""}</div></div>
        <span class="chip ${esc(p.respuesta)}">${RESP[p.respuesta] || ""}</span></li>`);
    $("lista").innerHTML = html || `<li class="vacio">${filtro ? "Sin resultados" : "Aún no hay personas registradas"}</li>`;
  }

  // ---------- sincronización ----------
  async function sincronizar(manual = false) {
    if (!sesion || sincronizando) return;
    if (!navigator.onLine) { if (manual) toast("Sin señal. Se subirá cuando haya conexión."); pintarEstado(); return; }
    sincronizando = true; pintarEstado();
    let subidos = 0, rechazados = 0, sinRed = false;
    try {
      const pendientes = leer(K.cola, []);
      for (const item of pendientes) {
        let res;
        try {
          res = await rpc("registrar_persona", { p_codigo: sesion.codigo, p_pin: sesion.pin, p_persona: item });
        } catch { sinRed = true; break; }           // sin red: se reintenta después
        if (res.ok) {
          subidos++;
        } else if (res.error === "auth") {
          toast("Tu PIN cambió o fue bloqueado. Ingresa de nuevo; tus registros siguen guardados.", 5000);
          sinRed = true; cerrarSesion(true); break;
        } else {
          rechazados++;
          const r = leer(K.rech, []); r.unshift({ ...item, mensaje: res.mensaje || "No se pudo guardar" }); guardar(K.rech, r);
        }
        // quitar de la cola SOLO después de una respuesta del servidor
        guardar(K.cola, leer(K.cola, []).filter(x => x.client_uuid !== item.client_uuid));
        pintarEstado();
      }
      if (!sinRed && sesion) {
        try {
          const mp = await rpc("mis_personas", { p_codigo: sesion.codigo, p_pin: sesion.pin });
          if (mp.ok) { guardar(K.lista, mp.personas); guardar(K.stats, { total: mp.total, hoy: mp.hoy }); }
        } catch { /* se mantiene la copia local */ }
      }
    } finally {
      sincronizando = false; pintarEstado(); pintarLista();
    }
    if (subidos) toast(`✓ ${subidos} registro(s) subido(s)`);
    if (rechazados) toast(`${rechazados} registro(s) no se subieron. Revisa "Mis personas".`, 5000);
    else if (manual && !subidos && !sinRed) toast("Todo está al día");
    else if (manual && sinRed) toast("No hay conexión con el servidor. Se reintentará.");
  }

  // ---------- ingreso ----------
  $("f-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const codigo = $("l-codigo").value.trim().toUpperCase(), pin = $("l-pin").value.trim();
    const btn = e.submitter; btn.disabled = true; $("l-error").textContent = "";
    try {
      const res = await rpc("login_lider", { p_codigo: codigo, p_pin: pin });
      if (!res.ok) { $("l-error").textContent = res.error; return; }
      if (sesion === null && leer(K.cola, []).length && leer(K.sesion + "_ultimo", "") !== codigo) {
        // registros pendientes de otro líder en este celular: se conservan para ese líder
        $("l-error").textContent = "Este celular tiene registros sin subir de otro líder. Ese líder debe ingresar primero.";
        return;
      }
      sesion = { codigo: res.codigo, pin, nombre: res.nombre };
      guardar(K.sesion, sesion); guardar(K.sesion + "_ultimo", res.codigo);
      guardar(K.stats, { total: res.total, hoy: 0 });
      iniciarApp(); sincronizar();
    } catch {
      $("l-error").textContent = "Sin conexión. La primera vez necesitas señal para ingresar.";
    } finally { btn.disabled = false; }
  });

  function cerrarSesion(forzado = false) {
    const pend = leer(K.cola, []).length;
    if (!forzado && pend && !confirm(`Tienes ${pend} registro(s) sin subir. Se conservarán en este celular, pero no se subirán hasta que vuelvas a ingresar. ¿Salir?`)) return;
    if (!forzado && !pend && !confirm("¿Cerrar sesión?")) return;
    sesion = null; localStorage.removeItem(K.sesion);
    if (!pend) { localStorage.removeItem(K.lista); localStorage.removeItem(K.stats); localStorage.removeItem(K.rech); }
    $("l-pin").value = ""; mostrar("login");
  }
  $("b-salir").addEventListener("click", () => cerrarSesion());

  // ---------- GPS ----------
  $("b-gps").addEventListener("click", () => {
    if (!navigator.geolocation) { $("gps-info").textContent = "Este celular no permite GPS."; return; }
    $("gps-info").textContent = "Buscando señal GPS… (puede tardar unos segundos al aire libre)";
    $("b-gps").disabled = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        gps = { latitud: +pos.coords.latitude.toFixed(6), longitud: +pos.coords.longitude.toFixed(6), precision_m: Math.round(pos.coords.accuracy) };
        $("gps-info").innerHTML = `✓ ${gps.latitud}, ${gps.longitud} (±${gps.precision_m} m) · ` +
          `<a href="https://maps.google.com/?q=${gps.latitud},${gps.longitud}" target="_blank" rel="noopener">ver en mapa</a>`;
        $("b-gps").textContent = "📍 Volver a capturar"; $("b-gps").disabled = false;
      },
      (err) => {
        $("gps-info").textContent = err.code === 1
          ? "Permiso de ubicación negado. Actívalo en la configuración del navegador."
          : "No se pudo obtener la ubicación. Intenta de nuevo cerca de una ventana o al aire libre.";
        $("b-gps").disabled = false;
      },
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 }
    );
  });

  // ---------- guardar persona ----------
  $("f-persona").addEventListener("submit", (e) => {
    e.preventDefault();
    const err = (m) => { $("p-error").textContent = m; return false; };
    $("p-error").textContent = "";
    const nombre = $("p-nombre").value.trim().replace(/\s+/g, " ");
    const cedula = soloDigitos($("p-cedula").value);
    const respuesta = (document.querySelector("input[name=respuesta]:checked") || {}).value;
    if (nombre.length < 3) return err("Escribe el nombre completo.");
    if (cedula.length < 5 || cedula.length > 12) return err("La cédula debe tener entre 5 y 12 dígitos.");
    if (!respuesta) return err("Selecciona la respuesta: Sí, No o Tal vez.");
    if (!$("p-consent").checked) return err("Falta marcar la autorización de datos.");

    const yaEsta = [...leer(K.cola, []), ...leer(K.lista, [])].some(p => p.cedula === cedula);
    if (yaEsta) return err("Esta cédula ya está en tu lista.");

    const item = {
      client_uuid: uuid(), nombre, cedula,
      direccion: $("p-direccion").value.trim(),
      latitud: gps ? gps.latitud : "", longitud: gps ? gps.longitud : "", precision_m: gps ? gps.precision_m : "",
      respuesta, consentimiento: true, creado: new Date().toISOString()
    };
    const cola = leer(K.cola, []); cola.push(item); guardar(K.cola, cola);   // 1) queda guardado en el celular

    e.target.reset(); gps = null;
    $("gps-info").textContent = "Sin ubicación. Funciona sin internet; activa el GPS del celular.";
    $("b-gps").textContent = "📍 Capturar ubicación";
    pintarEstado(); pintarLista();
    toast(navigator.onLine ? "✓ Guardado. Subiendo…" : "✓ Guardado en el celular. Se subirá al tener señal.");
    $("p-nombre").focus();
    sincronizar();                                                          // 2) se sube si hay señal
  });

  // ---------- pestañas y lista ----------
  document.querySelectorAll(".tab").forEach(b => b.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(x => x.classList.toggle("activa", x === b));
    $("t-registrar").hidden = b.dataset.tab !== "registrar";
    $("t-lista").hidden = b.dataset.tab !== "lista";
    if (b.dataset.tab === "lista") pintarLista();
  }));
  $("buscar").addEventListener("input", pintarLista);
  $("b-sync").addEventListener("click", () => sincronizar(true));
  $("lista").addEventListener("click", (e) => {
    const id = e.target.dataset.quitar; if (!id) return;
    guardar(K.rech, leer(K.rech, []).filter(x => x.client_uuid !== id)); pintarLista();
  });

  // ---------- reintentos automáticos ----------
  window.addEventListener("online", () => { pintarEstado(); sincronizar(); });
  window.addEventListener("offline", pintarEstado);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) sincronizar(); });
  setInterval(() => { if (leer(K.cola, []).length) sincronizar(); }, 30000);

  function iniciarApp() {
    $("u-nombre").textContent = sesion.nombre;
    mostrar("app"); pintarEstado(); pintarLista();
  }

  // ---------- aviso de instalación en iPhone (solo en Safari, sin instalar) ----------
  const esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const instalada = navigator.standalone || matchMedia("(display-mode: standalone)").matches;
  if (esIOS && !instalada && !window.Capacitor) {
    $("ios-tip").hidden = false;
    $("ios-tip").querySelector(".ios-x").addEventListener("click", () => $("ios-tip").hidden = true);
  }

  // ---------- arranque ----------
  $("org-nombre").textContent = CFG.NOMBRE_ORGANIZACION;
  document.title = CFG.NOMBRE_ORGANIZACION + " · Registro";
  $("txt-autorizacion").textContent = CFG.TEXTO_AUTORIZACION;
  if (sesion) { iniciarApp(); sincronizar(); } else mostrar("login");

  // En el APK los archivos ya están dentro de la app; el service worker solo se usa en la versión web
  if (!window.Capacitor && "serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
