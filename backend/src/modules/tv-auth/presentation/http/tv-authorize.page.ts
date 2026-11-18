export interface TvAuthorizePageConfig {
  sessionId: string;
  /** Prefijo de la API relativo al origen, p. ej. `/api/v1`. */
  apiBase: string;
  /** Client ID web de Google; null si el inicio con Google no está configurado. */
  googleClientId: string | null;
  nonce: string;
}

/** Cabeceras de seguridad propias de la página (sustituyen a las globales de helmet). */
export function tvAuthorizeHeaders(nonce: string): Record<string, string> {
  return {
    'Content-Security-Policy': [
      "default-src 'none'",
      `script-src 'nonce-${nonce}' https://accounts.google.com/gsi/client`,
      `style-src 'nonce-${nonce}' https://accounts.google.com/gsi/style`,
      "connect-src 'self' https://accounts.google.com/gsi/",
      'frame-src https://accounts.google.com/gsi/',
      "img-src 'self' data: https:",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
    // Google Identity Services abre una ventana emergente: COOP estricto la rompería.
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Cache-Control': 'no-store',
  };
}

/** Serializa JSON para incrustarlo en un `<script type="application/json">` sin romper el HTML. */
function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</gu, '\\u003c')
    .replace(/>/gu, '\\u003e')
    .replace(/&/gu, '\\u0026')
    .replace(/\u2028/gu, '\\u2028')
    .replace(/\u2029/gu, '\\u2029');
}

export function renderTvAuthorizePage(config: TvAuthorizePageConfig): string {
  const data = safeJson({
    sessionId: config.sessionId,
    apiBase: config.apiBase,
    googleClientId: config.googleClientId,
  });
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Autorizar televisor - COTAS</title>
<style nonce="${config.nonce}">
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #0b1220; color: #e8edf5; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { width: 100%; max-width: 420px; padding: 24px; }
  h1 { font-size: 1.4rem; margin: 0 0 4px; }
  p.lead { margin: 0 0 20px; color: #9fb0c8; }
  .card { background: #131c2e; border: 1px solid #22304a; border-radius: 14px; padding: 16px; margin-bottom: 16px; }
  .label { font-size: .75rem; text-transform: uppercase; letter-spacing: .06em; color: #7f93b2; }
  .value { font-size: 1.05rem; margin: 2px 0 12px; word-break: break-word; }
  .value:last-child { margin-bottom: 0; }
  .btn { display: block; width: 100%; padding: 14px; border: 0; border-radius: 12px; font-size: 1rem;
    font-weight: 600; cursor: pointer; margin-top: 10px; }
  .btn.primary { background: #3b82f6; color: #fff; }
  .btn.ghost { background: transparent; color: #9fb0c8; border: 1px solid #2a3a57; }
  .btn:disabled { opacity: .5; cursor: not-allowed; }
  .msg { padding: 12px 14px; border-radius: 12px; margin-bottom: 16px; }
  .msg.error { background: #3a1620; border: 1px solid #7a2a3d; color: #ffd5dd; }
  .msg.ok { background: #10301f; border: 1px solid #1f6b3e; color: #c9f5d9; }
  .msg.warn { background: #33280f; border: 1px solid #7a6020; color: #ffe9b0; }
  .center { text-align: center; }
  p.flush { margin-top: 0; }
  #google-button { display: flex; justify-content: center; margin: 8px 0; min-height: 44px; }
  [hidden] { display: none !important; }
  small { color: #7f93b2; }
</style>
</head>
<body>
<main>
  <h1>Autorizar televisor</h1>
  <p class="lead">Confirma que quieres iniciar sesi&oacute;n en este televisor con tu cuenta COTAS.</p>

  <div id="message" class="msg" hidden role="alert"></div>

  <section id="device" class="card" hidden>
    <div class="label">Televisor que solicita acceso</div>
    <div class="value" id="device-name"></div>
    <div class="label">Tipo</div>
    <div class="value" id="device-platform"></div>
    <div class="label">Red de origen</div>
    <div class="value" id="device-from"></div>
    <div class="label">Tiempo restante</div>
    <div class="value" id="countdown"></div>
  </section>

  <section id="signin" class="card center" hidden>
    <p class="flush">Inicia sesi&oacute;n con Google para continuar.</p>
    <div id="google-button"></div>
    <small>Solo se muestra tu cuenta. Aun no se autoriza nada.</small>
  </section>

  <section id="confirm" class="card" hidden>
    <div class="label">Cuenta que se vincular&aacute;</div>
    <div class="value" id="account-name"></div>
    <div class="value" id="account-email"></div>
    <small>Solo autoriza si t&uacute; est&aacute;s frente a este televisor y lo reconoces.</small>
    <button id="authorize" class="btn primary" type="button">Autorizar este televisor</button>
    <button id="reject" class="btn ghost" type="button">Rechazar</button>
  </section>
</main>
<script type="application/json" id="cfg" nonce="${config.nonce}">${data}</script>
<script nonce="${config.nonce}">
(function () {
  'use strict';
  var cfg = JSON.parse(document.getElementById('cfg').textContent);
  var params = new URLSearchParams(location.hash.slice(1));
  var code = params.get('c') || '';
  // El código nunca viaja al servidor en la URL: se quita del historial del navegador.
  history.replaceState(null, '', location.pathname);

  var el = function (id) { return document.getElementById(id); };
  var idToken = null;
  var remaining = 0;
  var timer = null;
  var finished = false;

  function show(id, visible) { el(id).hidden = !visible; }
  function message(kind, text) {
    var box = el('message');
    box.className = 'msg ' + kind;
    box.textContent = text;
    box.hidden = false;
  }
  function finish(kind, text) {
    finished = true;
    clearInterval(timer);
    show('signin', false);
    show('confirm', false);
    message(kind, text);
  }
  function platformLabel(p) {
    return ({ TV: 'Televisor', ANDROID: 'Android', IOS: 'iOS', WEB: 'Web', OTHER: 'Otro' })[p] || p;
  }
  function call(path, body) {
    return fetch(cfg.apiBase + '/auth/tv/qr/session/' + cfg.sessionId + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'omit',
      cache: 'no-store'
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        if (!res.ok) { var e = new Error(json.message || 'No se pudo completar la operación.'); e.code = json.code; e.status = res.status; throw e; }
        return json;
      });
    });
  }
  function fatal(err) {
    var terminal = ['TV_QR_EXPIRED', 'TV_QR_CLOSED', 'TV_QR_LOCKED', 'TV_QR_INVALID'];
    if (terminal.indexOf(err.code) !== -1) { finish('error', err.message); return true; }
    return false;
  }
  function tick() {
    remaining = Math.max(0, remaining - 1);
    var m = Math.floor(remaining / 60), s = remaining % 60;
    el('countdown').textContent = m + ':' + (s < 10 ? '0' : '') + s;
    if (remaining === 0 && !finished) { finish('error', 'El código QR expiró. Genera uno nuevo en el televisor.'); }
  }

  function onGoogle(response) {
    if (finished || !response || !response.credential) { return; }
    message('warn', 'Verificando tu cuenta…');
    call('/identify', { code: code, idToken: response.credential }).then(function (info) {
      idToken = response.credential;
      el('account-name').textContent = info.account.displayName || 'Cuenta COTAS';
      el('account-email').textContent = info.account.email;
      show('signin', false);
      show('confirm', true);
      el('message').hidden = true;
    }).catch(function (err) {
      if (!fatal(err)) { message('error', err.message); }
    });
  }

  function loadGoogle() {
    if (!cfg.googleClientId) {
      finish('error', 'El inicio de sesión con Google no está disponible en este momento.');
      return;
    }
    var script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = function () {
      window.google.accounts.id.initialize({
        client_id: cfg.googleClientId,
        callback: onGoogle,
        auto_select: false,
        cancel_on_tap_outside: true
      });
      window.google.accounts.id.renderButton(el('google-button'), {
        theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with', locale: 'es', width: 280
      });
      show('signin', true);
    };
    script.onerror = function () { finish('error', 'No se pudo cargar Google Sign-In. Revisa tu conexión.'); };
    document.head.appendChild(script);
  }

  el('authorize').addEventListener('click', function () {
    if (!idToken || finished) { return; }
    el('authorize').disabled = true; el('reject').disabled = true;
    call('/authorize', { code: code, idToken: idToken }).then(function () {
      finish('ok', 'Listo. Tu televisor iniciará sesión en unos segundos. Ya puedes cerrar esta página.');
    }).catch(function (err) {
      el('authorize').disabled = false; el('reject').disabled = false;
      if (!fatal(err)) { message('error', err.message); }
    });
  });
  el('reject').addEventListener('click', function () {
    if (finished) { return; }
    el('authorize').disabled = true; el('reject').disabled = true;
    call('/reject', { code: code }).then(function () {
      finish('warn', 'Solicitud rechazada. El televisor no iniciará sesión.');
    }).catch(function (err) {
      if (!fatal(err)) { message('error', err.message); }
    });
  });

  if (!code) {
    finish('error', 'El enlace está incompleto. Escanea de nuevo el código QR del televisor.');
    return;
  }
  call('/info', { code: code }).then(function (info) {
    el('device-name').textContent = info.device.deviceName || 'Televisor sin nombre';
    el('device-platform').textContent = platformLabel(info.device.platform);
    el('device-from').textContent = info.device.requestedFrom || 'No disponible';
    remaining = info.expiresIn + 1;
    tick();
    timer = setInterval(tick, 1000);
    show('device', true);
    loadGoogle();
  }).catch(function (err) {
    finish('error', err.message);
  });
})();
</script>
</body>
</html>`;
}
