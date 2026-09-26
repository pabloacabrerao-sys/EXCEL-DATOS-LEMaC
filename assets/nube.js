/* Nube — planilla compartida en vivo sobre Supabase.

   Todo lo que escribe pasa por la API REST (fetch común): crear filas, parchear
   campo por campo y marcar presencia. Los avisos instantáneos llegan por
   WebSocket cuando la librería de Supabase está disponible; si no, la misma
   información se obtiene sondeando cada pocos segundos. Sin configurar, la
   página funciona igual en modo local.                                        */

'use strict';

window.Nube = (function () {

  const CDNS = [
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js',
    'https://unpkg.com/@supabase/supabase-js@2/dist/umd/supabase.js'
  ];

  const est = {
    activa: false,          // hay configuración válida
    conectada: false,       // el último intento de hablar con la base salió bien
    enVivo: false,          // hay WebSocket; si no, se sondea
    yo: '',                 // identificador de este navegador
    nombre: '',
    error: ''
  };

  let cfg = null, cli = null, canal = null;
  let alCambiar = () => {}, alEstado = () => {}, alPresencia = () => {};
  let temporizador = null, ultimoFoco = '', ultimaPresencia = 0, sondeando = false;

  const ahora = () => Date.now();
  const CLAVE_ID = 'lemac.planilla.participante';

  function identificarme() {
    let v = '';
    try { v = localStorage.getItem(CLAVE_ID) || ''; } catch (e) { /* sin storage */ }
    if (!v) {
      v = (crypto.randomUUID ? crypto.randomUUID() : 'p' + Math.random().toString(36).slice(2) + ahora());
      try { localStorage.setItem(CLAVE_ID, v); } catch (e) { /* sin storage */ }
    }
    est.yo = v;
    return v;
  }

  /* ------------------------------------------------------------------ REST */
  function cabeceras(extra) {
    return Object.assign({
      apikey: cfg.clave,
      Authorization: 'Bearer ' + cfg.clave,
      'Content-Type': 'application/json'
    }, extra || {});
  }

  function pedir(ruta, opciones) {
    return fetch(cfg.url.replace(/\/+$/, '') + '/rest/v1' + ruta, opciones)
      .then(r => r.text().then(txt => {
        if (!r.ok) throw new Error('HTTP ' + r.status + (txt ? ' · ' + txt.slice(0, 200) : ''));
        return txt ? JSON.parse(txt) : null;
      }))
      .then(x => { marcar(true, ''); return x; })
      .catch(e => { marcar(false, e.message); throw e; });
  }

  function marcar(ok, error) {
    const cambio = est.conectada !== ok || est.error !== (error || '');
    est.conectada = ok;
    est.error = ok ? '' : (error || '');
    if (cambio) alEstado(Object.assign({}, est));
  }

  const rpc = (nombre, cuerpo) => pedir('/rpc/' + nombre, {
    method: 'POST', headers: cabeceras(), body: JSON.stringify(cuerpo)
  });

  /* ---------------------------------------------------------- operaciones */
  function listar() {
    return pedir('/mezclas?select=*&borrada=is.false&order=creada.asc', { headers: cabeceras() });
  }

  function crear(mezcla) {
    return pedir('/mezclas', {
      method: 'POST',
      headers: cabeceras({ Prefer: 'return=representation' }),
      body: JSON.stringify({
        nombre: mezcla.nombre || 'Mezcla',
        tipo: mezcla.tipo || '',
        datos: mezcla.datos || {},
        aportante: est.nombre || '',
        actualizada_por: est.nombre || ''
      })
    }).then(r => Array.isArray(r) ? r[0] : r);
  }

  // parche = {id_de_columna: valor}; null borra ese campo.
  function parchear(id, parche, nombre, tipo) {
    return rpc('parchear_mezcla', {
      p_id: id,
      p_datos: parche || {},
      p_nombre: (nombre === undefined ? null : nombre),
      p_tipo: (tipo === undefined ? null : tipo),
      p_quien: est.nombre || ''
    });
  }

  const borrar = id => rpc('borrar_mezcla', { p_id: id, p_quien: est.nombre || '' });

  /* ----------------------------------------------------------- presencia */
  function anunciar(foco, forzar) {
    if (!est.activa) return Promise.resolve();
    const t = ahora();
    if (!forzar && foco === ultimoFoco && t - ultimaPresencia < 12000) return Promise.resolve();
    ultimoFoco = foco; ultimaPresencia = t;
    return rpc('tocar_presencia', { p_id: est.yo, p_nombre: est.nombre || 'Alguien', p_foco: foco || '' })
      .catch(() => { /* la presencia es accesoria */ });
  }

  function leerPresencias() {
    return rpc('presentes', { p_segundos: 45 })
      .then(lista => { alPresencia((lista || []).filter(p => p.id !== est.yo)); })
      .catch(() => { /* idem */ });
  }

  /* -------------------------------------------------------------- sondeo */
  function sondear() {
    if (sondeando || !est.activa) return Promise.resolve();
    sondeando = true;
    return listar()
      .then(filas => { alCambiar(filas || []); })
      .catch(() => { /* el estado ya quedó marcado */ })
      .then(() => leerPresencias())
      .then(() => anunciar(ultimoFoco))
      .then(() => { sondeando = false; });
  }

  function programarSondeo() {
    clearInterval(temporizador);
    const base = Math.max(1500, (cfg.sondeoSegundos || 3) * 1000);
    // con WebSocket alcanza con un repaso lento de control
    const cada = est.enVivo ? Math.max(base * 6, 20000) : base;
    temporizador = setInterval(() => {
      if (document.hidden) return;
      sondear();
    }, cada);
  }

  /* --------------------------------------------------- tiempo real (WS) */
  function cargarLibreria(i) {
    i = i || 0;
    if (window.supabase && window.supabase.createClient) return Promise.resolve(window.supabase);
    if (i >= CDNS.length) return Promise.reject(new Error('no se pudo cargar la librería de tiempo real'));
    return new Promise((ok, mal) => {
      const s = document.createElement('script');
      s.src = CDNS[i];
      s.onload = () => (window.supabase && window.supabase.createClient) ? ok(window.supabase) : mal(new Error('carga incompleta'));
      s.onerror = () => mal(new Error('sin acceso a ' + CDNS[i]));
      document.head.appendChild(s);
    }).catch(() => cargarLibreria(i + 1));
  }

  function enVivo() {
    return cargarLibreria().then(sb => {
      cli = sb.createClient(cfg.url, cfg.clave, {
        auth: { persistSession: false },
        realtime: { params: { eventsPerSecond: 10 } }
      });
      canal = cli.channel('planilla-mezclas')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'mezclas' }, () => { sondear(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'presencias' }, () => { leerPresencias(); })
        .subscribe(estado => {
          est.enVivo = (estado === 'SUBSCRIBED');
          alEstado(Object.assign({}, est));
          programarSondeo();
        });
    }).catch(e => {
      est.enVivo = false;
      alEstado(Object.assign({}, est));
      programarSondeo();
    });
  }

  /* -------------------------------------------------------------- inicio */
  function iniciar(opciones) {
    alCambiar = opciones.alCambiar || alCambiar;
    alEstado = opciones.alEstado || alEstado;
    alPresencia = opciones.alPresencia || alPresencia;
    est.nombre = opciones.nombre || '';
    identificarme();

    return fetch('datos/config-nube.json', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .catch(() => null)
      .then(c => {
        cfg = c || {};
        if (!cfg.url || !cfg.clave) {
          est.activa = false;
          alEstado(Object.assign({}, est));
          return false;
        }
        est.activa = true;
        document.addEventListener('visibilitychange', () => { if (!document.hidden) sondear(); });
        window.addEventListener('online', () => sondear());
        return sondear().then(() => {
          programarSondeo();
          enVivo();
          return est.conectada;
        });
      });
  }

  function nombrar(n) {
    est.nombre = n || '';
    return anunciar(ultimoFoco, true);
  }

  function detener() {
    clearInterval(temporizador);
    if (canal && cli) { try { cli.removeChannel(canal); } catch (e) { /* ya cerrado */ } }
  }

  return {
    estado: est, iniciar, listar, crear, parchear, borrar,
    anunciar, sondear, nombrar, detener
  };
})();
