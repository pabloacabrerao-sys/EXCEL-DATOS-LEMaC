/* Planilla colaborativa de mezclas asfálticas — LEMaC
   Replica la planilla Excel en una página que se puede completar desde el navegador.
   Sin servidor: cada colega carga sus mezclas, se guardan en su navegador y al final
   las envía como archivo (aporte en GitHub o correo). */

'use strict';

const CONFIG = {
  repo: 'pabloacabrerao-sys/EXCEL-DATOS-LEMaC', // se autodetecta en GitHub Pages
  correo: '',                                   // opcional: destinatario del envío por correo
  plantillaIssue: 'aporte-de-mezclas.yml',
  clave: 'lemac.planilla.mezclas.v1'
};

let ESQ = null;                                  // esquema.json
let ST = { autor: '', sel: '', mezclas: [] };    // estado de trabajo (sel = lid de la mezcla abierta)
const PORCOL = {};                               // letra de columna -> definición
const PORID = {};                                // id -> definición

/* ---------------------------------------------------------------- utilidades */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

// Engancha un evento sólo si el elemento existe: así una versión vieja de este
// archivo servida desde la caché nunca puede cortar el arranque de la página.
function alTocar(sel, evento, fn) {
  const n = $(sel);
  if (n) n.addEventListener(evento, fn);
  return n;
}

function el(tag, attrs, hijos) {
  const n = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (k === 'class') n.className = attrs[k];
    else if (k === 'text') n.textContent = attrs[k];
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), attrs[k]);
    else if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
  }
  (hijos || []).forEach(h => n.appendChild(h));
  return n;
}

// Acepta "6,2" y "6.2"; devuelve número o null.
function num(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
const coma = n => (n === null || n === undefined || n === '') ? '' : String(n).replace('.', ',');
const vacio = v => v === null || v === undefined || String(v).trim() === '';

function tipoDe(nombre) { return ESQ.tipos.find(t => t.nombre === nombre) || null; }

// 'obligatorio' | 'recomendado' | 'no_aplica'; sin tipo elegido todavía: 'sin_tipo'
function req(mez, col) {
  const t = tipoDe(mez.tipo);
  if (!t) return 'sin_tipo';
  return t.requisitos[col] || 'no_aplica';
}

function claseCelda(mez, col) {
  const r = req(mez, col);
  if (r === 'sin_tipo') return '';
  if (r === 'obligatorio') return vacio(mez.d[col]) ? 'oblig-falta' : 'oblig';
  if (r === 'recomendado') return 'recom';
  return 'naplica';
}

function estado(mez) {
  if (!mez.tipo) return { clase: 'vacio', texto: 'Elegí el tipo de mezcla', faltan: [] };
  const t = tipoDe(mez.tipo);
  if (!t) return { clase: 'falta', texto: 'Tipo no válido', faltan: [] };
  const faltan = ESQ.columnas.filter(c => t.requisitos[c.col] === 'obligatorio' && vacio(mez.d[c.col]));
  return faltan.length
    ? { clase: 'falta', texto: 'Faltan ' + faltan.length, faltan }
    : { clase: 'ok', texto: 'Completa', faltan: [] };
}

/* ------------------------------------------------------------ persistencia */
function guardar() {
  try {
    localStorage.setItem(CONFIG.clave, JSON.stringify({ esq: ESQ.version, autor: ST.autor, mezclas: ST.mezclas }));
    marcarGuardado('Guardado ' + new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }));
  } catch (e) {
    marcarGuardado('No se pudo guardar en este navegador');
  }
}
function marcarGuardado(txt) { $('#guardado').textContent = txt; }

// Los datos del navegador se guardan por letra de columna. Cuando el esquema
// suma una columna en el medio, las letras se corren: esta tabla dice qué
// significaba cada letra en la versión 1 para reubicar los valores por su id.
const LETRAS_V1 = {
  BW: 'densidad_filler_de_aporte_g_cm3',
  BX: 'cs_del_filler',
  BY: 'vca_varillado_fraccion_gruesa_pct',
  BZ: 'densidad_del_ligante',
  CA: 'observaciones'
};

function migrarDesdeV1(mezclas) {
  mezclas.forEach(m => {
    if (!m || !m.d) return;
    const d = {};
    for (const letra in m.d) {
      const id = LETRAS_V1[letra];
      const destino = id && PORID[id] ? PORID[id].col : letra;
      d[destino] = m.d[letra];
    }
    m.d = d;
  });
  return mezclas;
}

function cargarGuardado() {
  try {
    const raw = localStorage.getItem(CONFIG.clave);
    if (!raw) return;
    const o = JSON.parse(raw);
    if (o && Array.isArray(o.mezclas)) {
      ST.autor = o.autor || '';
      const version = Number(o.esq) || 1;
      const mezclas = version < 2 ? migrarDesdeV1(o.mezclas) : o.mezclas;
      ST.mezclas = mezclas.map(saneaMezcla);
      if (version < 2) guardar();
    }
  } catch (e) { /* si está corrupto se arranca de cero */ }
}

function nuevoLid() {
  return (crypto.randomUUID ? crypto.randomUUID() : 'l' + Math.random().toString(36).slice(2) + Date.now());
}

function saneaMezcla(m) {
  const d = {};
  if (m && m.d) for (const k in m.d) if (PORCOL[k]) d[k] = m.d[k];
  return {
    lid: (m && m.lid) || nuevoLid(),
    id: (m && m.id) || null,                      // identificador en la planilla compartida
    nombre: (m && m.nombre) || '',
    tipo: (m && m.tipo) || '',
    aportante: (m && m.aportante) || '',
    d: d
  };
}

const mid = m => m.id || m.lid;
const mezclaPorLid = lid => ST.mezclas.find(m => m.lid === lid) || null;
const mezclaSel = () => mezclaPorLid(ST.sel) || ST.mezclas[0] || null;
const tablaVisible = () => !$('#vista-tabla').classList.contains('oculta');

function nuevaMezcla(tipo) {
  const m = saneaMezcla({ nombre: 'Mezcla ' + (ST.mezclas.length + 1), tipo: tipo || '', aportante: ST.autor });
  if (ST.autor) m.d[PORID.aportado_por.col] = ST.autor;
  ST.mezclas.push(m);
  ST.sel = m.lid;
  guardar();
  subirSiHaceFalta(m);
  return m;
}

/* -------------------------------------------------------------- vista fichas */
function pintarLista() {
  const ul = $('#lista');
  ul.textContent = '';
  if (!ST.mezclas.length) {
    ul.appendChild(el('li', {}, [el('span', { class: 'nota', text: 'Todavía no cargaste ninguna.' })]));
    return;
  }
  ST.mezclas.forEach((m, i) => {
    const e = estado(m);
    const b = el('button', {
      type: 'button', class: m.lid === ST.sel ? 'sel' : '',
      onclick: () => { ST.sel = m.lid; pintarFichas(); }
    });
    b.appendChild(document.createTextNode(m.nombre || 'Mezcla ' + (i + 1)));
    const quien = Nube.estado.activa && m.aportante && m.aportante !== ST.autor ? ' · ' + m.aportante : '';
    b.appendChild(el('span', { class: 'lst-tipo', text: (m.tipo || 'sin tipo') + ' · ' + e.texto + quien }));
    if (Nube.estado.activa && !m.id) b.appendChild(el('span', { class: 'lst-tipo', text: 'sin subir' }));
    ul.appendChild(el('li', {}, [b]));
  });
}

function inputCampo(mez, def, enTabla) {
  let n;
  if (def.tipo === 'lista') {
    n = el('select');
    n.appendChild(el('option', { value: '', text: enTabla ? '' : '—' }));
    def.opciones.forEach(o => n.appendChild(el('option', { value: o, text: o })));
    n.value = mez.d[def.col] || '';
  } else {
    n = el('input', {
      type: 'text',
      inputmode: def.tipo === 'numero' ? 'decimal' : null,
      value: def.tipo === 'numero' ? coma(mez.d[def.col] ?? '') : (mez.d[def.col] ?? '')
    });
  }
  n.dataset.col = def.col;
  n.dataset.mid = mid(mez);
  n.addEventListener('input', () => {
    mez.d[def.col] = n.value.trim();
    if (def.col === PORID.aportado_por.col && n.value.trim() && !ST.autor) {
      ST.autor = n.value.trim(); $('#autor').value = ST.autor;
    }
    encolar(mez, def.col, mez.d[def.col]);
    alCambiar(mez, def.col, n);
  });
  n.addEventListener('change', guardar);
  n.addEventListener('focus', () => avisarFoco(mez, def.col));
  n.addEventListener('blur', () => avisarFoco(null, ''));
  return n;
}

// Refresca sólo lo que depende de esta celda, para no repintar toda la planilla.
function alCambiar(mez, col, nodo) {
  const td = nodo.closest('td');
  if (td) {
    td.className = (td.classList.contains('num') ? 'num ' : '') + claseCelda(mez, col);
    const tr = td.closest('tr');
    const est = tr && tr.querySelector('td.est');
    if (est) { const e = estado(mez); est.className = 'est fija ' + e.clase; est.textContent = e.texto; }
  }
  const campo = nodo.closest('label.campo');
  if (campo) {
    const marca = campo.querySelector('.marca.ob');
    if (marca) marca.classList.toggle('hay', !vacio(mez.d[col]));
    pintarEstadoFicha(mez);
  }
  pintarLista();
  clearTimeout(alCambiar._t);
  alCambiar._t = setTimeout(guardar, 600);
}

function pintarEstadoFicha(mez) {
  const n = $('#estado-ficha');
  if (!n) return;
  const e = estado(mez);
  n.className = 'estado ' + e.clase;
  n.textContent = e.texto === 'Completa' ? 'Completa ✓' : e.texto + (e.faltan.length ? ' datos obligatorios' : '');
}

function campoFicha(mez, def) {
  const r = req(mez, def.col);
  const etq = el('span', {}, [document.createTextNode(def.label)]);
  if (r === 'obligatorio') etq.appendChild(el('span', { class: 'marca ob' + (vacio(mez.d[def.col]) ? '' : ' hay'), text: 'oblig.' }));
  else if (r === 'recomendado') etq.appendChild(el('span', { class: 'marca re', text: 'recom.' }));
  if (def.ayuda) etq.appendChild(el('span', { class: 'ayuda-i', title: def.ayuda, text: 'i' }));
  const lab = el('label', { class: 'campo ' + (def.tipo === 'numero' ? 'n' : 't') }, [etq, inputCampo(mez, def, false)]);
  return lab;
}

function pintarFichas() {
  pintarLista();
  const cont = $('#ficha');
  cont.textContent = '';
  const mez = mezclaSel();
  if (mez) ST.sel = mez.lid;
  if (!mez) {
    cont.appendChild(el('div', { class: 'vacio-ficha' }, [
      el('p', { text: 'Agregá tu primera mezcla con el botón “+ Nueva”.' }),
      el('p', { class: 'nota', text: 'Cada ficha es una mezcla: elegís el tipo y la página te muestra sólo los datos que corresponden.' })
    ]));
    return;
  }

  // cabecera: nombre, tipo, estado, borrar
  const inNombre = el('input', { type: 'text', value: mez.nombre });
  inNombre.addEventListener('input', () => {
    mez.nombre = inNombre.value;
    encolar(mez, '__nombre', mez.nombre);
    pintarLista();
    clearTimeout(alCambiar._t); alCambiar._t = setTimeout(guardar, 600);
  });

  const selTipo = el('select');
  selTipo.appendChild(el('option', { value: '', text: '— elegir —' }));
  ESQ.tipos.forEach(t => selTipo.appendChild(el('option', { value: t.nombre, text: t.nombre })));
  selTipo.value = mez.tipo || '';
  selTipo.addEventListener('change', () => {
    mez.tipo = selTipo.value;
    encolar(mez, '__tipo', mez.tipo);
    guardar(); pintarFichas(); if (tablaVisible()) pintarTabla();
  });

  const cab = el('div', { class: 'ficha-cab' }, [
    el('label', { class: 'campo t' }, [el('span', { text: 'Nombre de la mezcla' }), inNombre]),
    el('label', { class: 'campo' }, [el('span', { text: 'Tipo de mezcla' }), selTipo]),
    el('span', { class: 'estado', id: 'estado-ficha' }),
    el('button', {
      class: 'btn btn-chico btn-peligro', type: 'button', text: 'Borrar esta mezcla',
      onclick: () => {
        const compartida = Nube.estado.activa && mez.id;
        const aviso = compartida
          ? '¿Borrar “' + (mez.nombre || 'esta mezcla') + '” de la planilla compartida? La van a dejar de ver todos.'
          : '¿Borrar “' + (mez.nombre || 'esta mezcla') + '”?';
        if (!confirm(aviso)) return;
        borrarMezcla(mez);
      }
    })
  ]);
  cont.appendChild(cab);
  pintarEstadoFicha(mez);

  if (!mez.tipo) {
    cont.appendChild(el('div', { class: 'vacio-ficha', text: 'Elegí el tipo de mezcla para ver qué datos hay que cargar.' }));
    return;
  }

  // grupos del esquema; los que no aplican al tipo no se muestran
  ESQ.grupos.forEach((g, gi) => {
    const desde = ESQ.columnas.findIndex(c => c.col === g.desde);
    const cols = ESQ.columnas.slice(desde, desde + g.n).filter(c => req(mez, c.col) !== 'no_aplica');
    if (!cols.length) return;
    const rej = el('div', { class: 'rejilla' }, cols.map(c => campoFicha(mez, c)));
    const esSerie = /Serie Marshall/.test(g.titulo);
    const soloRecom = cols.every(c => req(mez, c.col) === 'recomendado');
    if (esSerie && soloRecom) {
      const hayDatos = cols.some(c => !vacio(mez.d[c.col]));
      const d = el('details', { class: 'serie' }, [el('summary', { text: g.titulo + ' (opcional)' }), rej]);
      if (hayDatos) d.open = true;
      cont.appendChild(d);
    } else {
      cont.appendChild(el('fieldset', { class: 'grupo' }, [el('legend', { text: g.titulo }), rej]));
    }
  });

  const noAplica = ESQ.columnas.filter(c => req(mez, c.col) === 'no_aplica');
  if (noAplica.length) {
    cont.appendChild(el('p', { class: 'nota', text: noAplica.length + ' datos no corresponden a ' + mez.tipo + ' y por eso no se muestran.' }));
  }
}

/* -------------------------------------------------------------- vista tabla */
function pintarTabla() {
  const tab = $('#tabla');
  tab.textContent = '';
  const cg = el('colgroup');
  [40, 132, 92].forEach(w => cg.appendChild(el('col', { style: 'width:' + w + 'px' })));
  ESQ.columnas.forEach(c => cg.appendChild(el('col', { 'data-col': c.col })));
  cg.appendChild(el('col'));
  tab.appendChild(cg);

  // fila de grupos
  const thead = el('thead');
  const trG = el('tr', { class: 'grupos' });
  trG.appendChild(el('th', { class: 'fija f0 grupo-fijo', colspan: 3, text: 'Mezcla' }));
  ESQ.grupos.forEach(g => trG.appendChild(el('th', { colspan: g.n, text: g.titulo })));
  trG.appendChild(el('th', { text: '' }));
  thead.appendChild(trG);

  const trC = el('tr', { class: 'cols' });
  trC.appendChild(el('th', { class: 'fija f0', text: '#' }));
  trC.appendChild(el('th', { class: 'fija f1', text: 'Tipo de mezcla' }));
  trC.appendChild(el('th', { class: 'fija f2', text: 'Estado' }));
  ESQ.columnas.forEach(c => trC.appendChild(el('th', { title: c.ayuda || '', text: c.label })));
  trC.appendChild(el('th', { text: '' }));
  thead.appendChild(trC);
  tab.appendChild(thead);

  const tb = el('tbody');
  ST.mezclas.forEach((mez, i) => {
    const tr = el('tr', { 'data-fila': mid(mez) });
    tr.appendChild(el('td', { class: 'fija f0', text: String(i + 1) }));

    const sel = el('select');
    sel.appendChild(el('option', { value: '', text: '—' }));
    ESQ.tipos.forEach(t => sel.appendChild(el('option', { value: t.nombre, text: t.nombre })));
    sel.value = mez.tipo || '';
    sel.addEventListener('change', () => {
      mez.tipo = sel.value;
      encolar(mez, '__tipo', mez.tipo);
      guardar(); pintarTabla(); pintarLista();
    });
    tr.appendChild(el('td', { class: 'fija f1 sel-tipo' }, [sel]));

    const e = estado(mez);
    tr.appendChild(el('td', { class: 'est fija f2 ' + e.clase, text: e.texto }));

    ESQ.columnas.forEach(c => {
      const td = el('td', { class: (c.tipo === 'numero' ? 'num ' : '') + claseCelda(mez, c.col) }, [inputCampo(mez, c, true)]);
      tr.appendChild(td);
    });
    tr.appendChild(el('td', {
      class: 'borrar'
    }, [el('button', {
      type: 'button', title: 'Borrar la fila', text: '✕',
      onclick: () => {
        if (!confirm('¿Borrar la fila ' + (i + 1) + (Nube.estado.activa && mez.id ? ' de la planilla compartida?' : '?'))) return;
        borrarMezcla(mez);
      }
    })]));
    tb.appendChild(tr);
  });
  tab.appendChild(tb);
  aplicarCompacta();
}

function aplicarCompacta() {
  const on = $('#chk-compacta').checked;
  const conTipo = ST.mezclas.filter(m => tipoDe(m.tipo));
  $$('#tabla colgroup col[data-col]').forEach(col => {
    const L = col.dataset.col;
    const ocultar = on && conTipo.length > 0 &&
      conTipo.every(m => req(m, L) === 'no_aplica') &&
      ST.mezclas.every(m => vacio(m.d[L]));
    col.className = ocultar ? 'oculta' : '';
  });
}

/* ================================================================ EN VIVO ==
   Sincronización con la planilla compartida: cola de cambios propios, fusión
   de los cambios ajenos campo por campo y presencia de quien está editando. */

const PENDIENTES = {};      // lid -> {columna|__nombre|__tipo: valor}
let PRESENTES = [];         // otras personas conectadas
let relojEnvio = null, relojReintento = null;

const aDatosId = d => {
  const o = {};
  ESQ.columnas.forEach(c => { if (!vacio(d[c.col])) o[c.id] = d[c.col]; });
  return o;
};

function encolar(mez, clave, valor) {
  if (!Nube.estado.activa) return;
  (PENDIENTES[mez.lid] = PENDIENTES[mez.lid] || {})[clave] = valor;
  clearTimeout(relojEnvio);
  relojEnvio = setTimeout(enviarPendientes, 700);
}

function enviarPendientes() {
  if (!Nube.estado.activa) return;
  ST.mezclas.forEach(mez => {
    const p = PENDIENTES[mez.lid];
    if (!p || !Object.keys(p).length) return;
    if (!mez.id) { subirSiHaceFalta(mez); return; }   // todavía no existe en la base
    delete PENDIENTES[mez.lid];
    const parche = {};
    let nombre, tipo;
    for (const k in p) {
      if (k === '__nombre') nombre = p[k];
      else if (k === '__tipo') tipo = p[k];
      else if (PORCOL[k]) parche[PORCOL[k].id] = vacio(p[k]) ? null : p[k];
    }
    Nube.parchear(mez.id, parche, nombre, tipo)
      .catch(() => {                                   // sin conexión: se reintenta
        const otra = PENDIENTES[mez.lid] = PENDIENTES[mez.lid] || {};
        for (const k in p) if (!(k in otra)) otra[k] = p[k];
      });
  });
}

function subirSiHaceFalta(mez) {
  if (!Nube.estado.activa || mez.id || mez.subiendo) return Promise.resolve();
  mez.subiendo = true;
  return Nube.crear({ nombre: mez.nombre, tipo: mez.tipo, datos: aDatosId(mez.d) })
    .then(fila => {
      mez.subiendo = false;
      if (!fila || !fila.id) return;
      mez.id = fila.id;
      mez.aportante = fila.aportante || ST.autor;
      guardar(); repintar();
      enviarPendientes();                          // lo tipeado mientras subía
    })
    .catch(() => { mez.subiendo = false; });
}

// Busca el input de una celda concreta (la mezcla puede haber cambiado de
// identificador al subirse, por eso se resuelve siempre desde la mezcla).
function nodoDe(mez, col) {
  const clave = mid(mez);
  return $$('[data-col="' + col + '"]').find(n => n.dataset.mid === clave) || null;
}

// Repinta sin robarle el cursor a quien está escribiendo: si alguien agrega una
// fila o cambia un tipo, el que estaba tipeando sigue en su celda y su posición.
function repintar() {
  const a = document.activeElement;
  let ref = null;
  if (a && a.dataset && a.dataset.col) {
    const m = ST.mezclas.find(x => mid(x) === a.dataset.mid);
    if (m) ref = { lid: m.lid, col: a.dataset.col, ini: a.selectionStart, fin: a.selectionEnd };
  }
  pintarFichas();
  if (tablaVisible()) pintarTabla();
  if (!ref) return;
  const m = mezclaPorLid(ref.lid);
  const n = m && nodoDe(m, ref.col);
  if (!n) return;
  n.focus();
  if (ref.ini !== null && ref.ini !== undefined && n.setSelectionRange) {
    try { n.setSelectionRange(ref.ini, ref.fin); } catch (e) { /* selects no tienen selección */ }
  }
  avisarFoco(m, ref.col);
}

function subirTodasLocales() {
  if (!Nube.estado.activa) return;
  ST.mezclas.forEach(m => subirSiHaceFalta(m));
}

function borrarMezcla(mez) {
  const quitar = () => {
    ST.mezclas = ST.mezclas.filter(x => x.lid !== mez.lid);
    delete PENDIENTES[mez.lid];
    if (ST.sel === mez.lid) ST.sel = ST.mezclas.length ? ST.mezclas[0].lid : '';
    guardar(); repintar(); pintarAvisos();
  };
  if (Nube.estado.activa && mez.id) {
    Nube.borrar(mez.id).then(quitar).catch(() => alert('No se pudo borrar en la planilla compartida. Revisá la conexión y probá de nuevo.'));
  } else quitar();
}

// ¿el usuario está escribiendo justo en esta celda?
function enFoco(mez, col) {
  const a = document.activeElement;
  return !!(a && a.dataset && a.dataset.col === col && a.dataset.mid === mid(mez));
}

function desdeFila(f) {
  const d = {};
  const datos = f.datos || {};
  for (const k in datos) if (PORID[k] && !vacio(datos[k])) d[PORID[k].col] = String(datos[k]);
  return saneaMezcla({ id: f.id, nombre: f.nombre, tipo: f.tipo, aportante: f.aportante, d: d });
}

// Aplica una fila remota sobre la copia local. Devuelve 'estructura' si hay que
// repintar todo (cambió el tipo) o 'valores' si alcanza con refrescar celdas.
function fusionarFila(mez, f) {
  const p = PENDIENTES[mez.lid] || {};
  let cambio = '';
  if (!('__tipo' in p) && (f.tipo || '') !== mez.tipo) { mez.tipo = f.tipo || ''; cambio = 'estructura'; }
  if (!('__nombre' in p) && (f.nombre || '') !== mez.nombre) { mez.nombre = f.nombre || ''; cambio = cambio || 'valores'; }
  if ((f.aportante || '') !== mez.aportante) { mez.aportante = f.aportante || ''; cambio = cambio || 'valores'; }

  const remoto = {};
  const datos = f.datos || {};
  for (const k in datos) if (PORID[k]) remoto[PORID[k].col] = vacio(datos[k]) ? '' : String(datos[k]);

  ESQ.columnas.forEach(c => {
    if (c.col in p) return;                    // hay un cambio propio sin enviar
    if (enFoco(mez, c.col)) return;            // lo está escribiendo ahora mismo
    const nuevo = remoto[c.col] || '';
    const actual = mez.d[c.col] || '';
    if (nuevo === actual) return;
    if (nuevo === '') delete mez.d[c.col]; else mez.d[c.col] = nuevo;
    cambio = cambio || 'valores';
  });
  return cambio;
}

// Refresca en pantalla las celdas de una mezcla sin repintar la planilla.
function refrescarNodos(mez) {
  const clave = mid(mez);
  $$('[data-mid]').forEach(n => {
    if (n.dataset.mid !== clave) return;
    const col = n.dataset.col;
    if (!col || document.activeElement === n) return;
    const v = mez.d[col] ?? '';
    if (n.value !== String(v)) n.value = v;
    const td = n.closest('td');
    if (td) td.className = (td.classList.contains('num') ? 'num ' : '') + claseCelda(mez, col);
    const campo = n.closest('label.campo');
    if (campo) {
      const marca = campo.querySelector('.marca.ob');
      if (marca) marca.classList.toggle('hay', !vacio(mez.d[col]));
    }
  });
  const e = estado(mez);
  const tr = document.querySelector('tr[data-fila="' + (window.CSS && CSS.escape ? CSS.escape(clave) : clave) + '"]');
  const celda = tr && tr.querySelector('td.est');
  if (celda) { celda.className = 'est fija f2 ' + e.clase; celda.textContent = e.texto; }
  if (mezclaSel() === mez) pintarEstadoFicha(mez);
  pintarLista();
}

function fusionarRemotas(filas) {
  const porId = new Map(ST.mezclas.filter(m => m.id).map(m => [m.id, m]));
  const vistos = new Set();
  let estructura = false;
  const refrescar = [];

  (filas || []).forEach(f => {
    vistos.add(f.id);
    const m = porId.get(f.id);
    if (!m) { ST.mezclas.push(desdeFila(f)); estructura = true; return; }
    const cambio = fusionarFila(m, f);
    if (cambio === 'estructura') estructura = true;
    else if (cambio === 'valores') refrescar.push(m);
  });

  // filas que otro borró
  const quedan = ST.mezclas.filter(m => !m.id || vistos.has(m.id));
  if (quedan.length !== ST.mezclas.length) {
    ST.mezclas = quedan;
    estructura = true;
  }
  if (!mezclaSel() && ST.mezclas.length) ST.sel = ST.mezclas[0].lid;

  guardar();
  if (estructura) {
    repintar();
  } else {
    refrescar.forEach(refrescarNodos);
  }
  if (!$('#vista-enviar').classList.contains('oculta')) pintarAvisos();
  pintarFoco();
}

/* ------------------------------------------------------------- presencia */
function avisarFoco(mez, col) {
  if (!Nube.estado.activa) return;
  Nube.anunciar(mez && mez.id ? mez.id + '|' + col : '');
}

function pintarPresencia(lista) {
  PRESENTES = lista || [];
  pintarEstadoNube();
  pintarFoco();
}

// Marca las celdas que otra persona está editando en este momento.
function pintarFoco() {
  $$('.foco-otro').forEach(n => { n.classList.remove('foco-otro'); n.removeAttribute('title'); });
  PRESENTES.forEach(p => {
    if (!p.foco) return;
    const corte = p.foco.indexOf('|');
    if (corte < 0) return;
    const idFila = p.foco.slice(0, corte), col = p.foco.slice(corte + 1);
    $$('[data-mid]').forEach(n => {
      if (n.dataset.mid !== idFila || n.dataset.col !== col) return;
      const marca = n.closest('td') || n.closest('label.campo') || n;
      marca.classList.add('foco-otro');
      marca.setAttribute('title', (p.nombre || 'Otra persona') + ' está editando este dato');
    });
  });
}

function pintarEstadoNube() {
  const n = $('#nube');
  if (!n) return;
  const e = Nube.estado;
  let clase = 'nube', txt = '';
  if (!e.activa) { clase += ' local'; txt = 'Modo local'; }
  else if (!e.conectada) { clase += ' mal'; txt = 'Sin conexión — se guarda acá y se sincroniza'; }
  else {
    clase += ' bien';
    const otros = PRESENTES.length;
    txt = (e.enVivo ? 'En vivo' : 'Sincronizada') + ' · ' +
      (otros ? otros + ' colega(s) conectado(s)' : 'sólo vos');
  }
  n.className = clase;
  n.textContent = txt;
  n.title = PRESENTES.length
    ? 'Conectados: ' + PRESENTES.map(p => p.nombre || 'alguien').join(', ')
    : (e.error || '');
  const cierre = $('#inst-cierre');
  if (cierre) {
    cierre.textContent = e.activa
      ? 'no hace falta enviar nada, el LEMaC ya lo ve'
      : 'al terminar, mandalo desde “Enviar / Exportar” (paso 4)';
  }
  const tit = $('#titulo-lista');
  if (tit) tit.textContent = e.activa ? 'Mezclas del equipo' : 'Mis mezclas';
  const nota = $('#nota-lista');
  if (nota) {
    nota.textContent = e.activa
      ? 'Todos ven y editan la misma planilla. Los cambios se sincronizan solos; si te quedás sin internet, se guardan acá y suben al volver.'
      : 'Los datos quedan guardados en este navegador. Cuando termines, andá a Enviar / Exportar.';
  }
  const sin = ST.mezclas.filter(m => !m.id).length;
  const b = $('#btn-subir');
  if (b) {
    b.classList.toggle('oculta', !(e.activa && sin));
    b.textContent = 'Subir ' + sin + ' mezcla(s) a la compartida';
  }
}

function arrancarNube() {
  return Nube.iniciar({
    nombre: ST.autor,
    alCambiar: fusionarRemotas,
    alEstado: () => pintarEstadoNube(),
    alPresencia: pintarPresencia
  }).then(() => {
    pintarEstadoNube();
    if (!Nube.estado.activa) return;
    clearInterval(relojReintento);
    relojReintento = setInterval(() => {         // reintentos de lo que quedó sin enviar
      if (document.hidden) return;
      ST.mezclas.forEach(m => { if (!m.id) subirSiHaceFalta(m); });
      enviarPendientes();
    }, 6000);
  });
}

/* ------------------------------------------------------------------ avisos */
function revisar() {
  const av = [];
  if (!ST.mezclas.length) { av.push(['adv', 'No hay ninguna mezcla cargada.']); return av; }
  if (vacio(ST.autor)) av.push(['adv', 'Poné tu nombre arriba, en “Aportado por”: así sabemos de quién es cada dato.']);

  const gran = ESQ.columnas.slice(
    ESQ.columnas.findIndex(c => c.col === 'J'),
    ESQ.columnas.findIndex(c => c.col === 'J') + 10
  );
  const series = ['T', 'AD', 'AN', 'AX', 'BH'];

  ST.mezclas.forEach((m, i) => {
    const nom = (m.nombre || 'Mezcla ' + (i + 1));
    if (!m.tipo) { av.push(['err', nom + ': falta elegir el tipo de mezcla.']); return; }
    const e = estado(m);
    if (e.faltan.length) {
      const lista = e.faltan.slice(0, 6).map(c => c.label).join(', ');
      av.push(['adv', nom + ': faltan ' + e.faltan.length + ' datos obligatorios (' + lista + (e.faltan.length > 6 ? ', …' : '') + ').']);
    }

    // rangos
    ESQ.columnas.forEach(c => {
      const v = m.d[c.col];
      if (vacio(v) || c.tipo !== 'numero') return;
      const n = num(v);
      if (n === null) { av.push(['err', nom + ' · ' + c.label + ': “' + v + '” no es un número.']); return; }
      if (c.min !== undefined && (n < c.min || n > c.max)) {
        av.push(['err', nom + ' · ' + c.label + ': ' + coma(v) + ' está fuera de ' + c.min + '–' + c.max + '.']);
      }
    });

    // granulometría: el % que pasa no puede crecer al bajar el tamiz
    let ant = null, antL = '';
    gran.forEach(c => {
      const n = num(m.d[c.col]);
      if (n === null) return;
      if (ant !== null && n > ant + 0.001) {
        av.push(['err', nom + ': la granulometría crece de ' + antL + ' (' + coma(ant) + ') a ' + c.label + ' (' + coma(n) + '); el % que pasa tiene que ir bajando.']);
      }
      ant = n; antL = c.label;
    });

    // serie Marshall
    const cas = series.map(s => num(m.d[s])).filter(v => v !== null);
    if (cas.length && cas.length < 3) av.push(['adv', nom + ': la serie Marshall tiene ' + cas.length + ' contenido(s) de asfalto; hacen falta 3 como mínimo (ideal 5).']);
    const dup = cas.filter((v, k) => cas.indexOf(v) !== k);
    if (dup.length) av.push(['adv', nom + ': hay contenidos de asfalto repetidos en la serie (' + dup.map(coma).join(', ') + ').']);
    const opt = num(m.d['BR']);
    if (opt !== null && cas.length >= 2) {
      const lo = Math.min(...cas), hi = Math.max(...cas);
      if (opt < lo - 0.001 || opt > hi + 0.001) {
        av.push(['adv', nom + ': el %CA óptimo (' + coma(opt) + ') queda fuera de la serie ensayada (' + coma(lo) + ' a ' + coma(hi) + ').']);
      }
    }

    // datos en columnas que no corresponden
    const sobra = ESQ.columnas.filter(c => req(m, c.col) === 'no_aplica' && !vacio(m.d[c.col]));
    if (sobra.length) {
      av.push(['adv', nom + ': hay ' + sobra.length + ' dato(s) en columnas que no corresponden a ' + m.tipo + ' (' + sobra.slice(0, 4).map(c => c.label).join(', ') + (sobra.length > 4 ? ', …' : '') + ').']);
    }
  });

  const completas = ST.mezclas.filter(m => estado(m).clase === 'ok').length;
  av.unshift([completas === ST.mezclas.length ? 'ok' : 'adv',
    ST.mezclas.length + ' mezcla(s) cargada(s), ' + completas + ' completa(s).']);
  return av;
}

function pintarAvisos() {
  const cont = $('#avisos');
  cont.textContent = '';
  revisar().forEach(([cl, txt]) => cont.appendChild(el('div', { class: 'aviso ' + cl, text: txt })));
}

/* ---------------------------------------------------------------- exportar */
function bajar(nombre, blob) {
  const u = URL.createObjectURL(blob);
  const a = el('a', { href: u, download: nombre });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 2000);
}

function aJSON() {
  return {
    planilla: 'mezclas-asfalticas-lemac',
    version: ESQ.version,
    aportante: ST.autor,
    exportado: new Date().toISOString(),
    mezclas: ST.mezclas.map(m => {
      const datos = {};
      ESQ.columnas.forEach(c => { if (!vacio(m.d[c.col])) datos[c.id] = m.d[c.col]; });
      return { nombre: m.nombre, tipo: m.tipo, estado: estado(m).texto, datos };
    })
  };
}

function nombreArchivo(ext) {
  const quien = (ST.autor || 'aporte').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'aporte';
  const f = new Date().toISOString().slice(0, 10);
  return 'mezclas-' + quien + '-' + f + '.' + ext;
}

function exportarJSON() {
  bajar(nombreArchivo('json'), new Blob([JSON.stringify(aJSON(), null, 1)], { type: 'application/json' }));
}

function exportarCSV() {
  const sep = ';';
  const esc = v => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const filas = [['Mezcla', 'Tipo de mezcla', 'Estado'].concat(ESQ.columnas.map(c => c.label))];
  ST.mezclas.forEach((m, i) => {
    filas.push([m.nombre || 'Mezcla ' + (i + 1), m.tipo, estado(m).texto]
      .concat(ESQ.columnas.map(c => coma(m.d[c.col] ?? ''))));
  });
  const txt = '﻿' + filas.map(f => f.map(esc).join(sep)).join('\r\n');
  bajar(nombreArchivo('csv'), new Blob([txt], { type: 'text/csv;charset=utf-8' }));
}

// Arma las hojas del .xlsx con las mismas filas de encabezado y columnas que la planilla original.
function hojasXLSX(lista) {
  const anchoTotal = 3 + ESQ.columnas.length;
  const filaGrupos = new Array(anchoTotal).fill('');
  filaGrupos[0] = 'Elegir el tipo en la columna B';
  ESQ.grupos.forEach(g => {
    filaGrupos[3 + ESQ.columnas.findIndex(c => c.col === g.desde)] = g.titulo;
  });
  const encabezados = ['Mezcla', 'Tipo de mezcla', 'Estado'].concat(ESQ.columnas.map(c => c.label));

  const filas = [filaGrupos, encabezados];
  lista.forEach((m, i) => {
    const f = [m.nombre || 'Mezcla ' + (i + 1), m.tipo, estado(m).texto];
    ESQ.columnas.forEach(c => {
      const v = m.d[c.col];
      if (vacio(v)) { f.push(''); return; }
      if (c.tipo === 'numero') { const n = num(v); f.push(n === null ? v : n); }
      else f.push(v);
    });
    filas.push(f);
  });

  const filasReq = [filaGrupos.slice(), encabezados.slice()];
  filasReq[0][0] = 'No modificar';
  ESQ.tipos.forEach(t => {
    const f = [t.clave, t.nombre, ''];
    ESQ.columnas.forEach(c => {
      const r = t.requisitos[c.col];
      f.push(r === 'obligatorio' ? 'Obligatorio' : r === 'recomendado' ? 'Recomendado' : '-');
    });
    filasReq.push(f);
  });

  const anchos = [16, 14, 12].concat(ESQ.columnas.map(c => Math.min(28, Math.max(10, c.label.length + 2))));
  const listas = [
    { rango: 'B3:B302', opciones: ESQ.tipos.map(t => t.nombre) },
    { rango: 'F3:F302', opciones: PORID.capa_r_b.opciones },
    { rango: 'G3:G302', opciones: PORID.transito_t1_t4.opciones }
  ];

  return [
    { nombre: 'Mezclas', filas: filas, anchos: anchos, fijar: { x: 3, y: 2 }, listas: listas },
    { nombre: 'Requisitos', filas: filasReq, anchos: anchos },
    { nombre: 'Instrucciones', filas: ESQ.instrucciones.map(r => [r.a || '', r.b || '']), anchos: [24, 100] }
  ];
}

function bajarXLSX(lista, nombre) {
  return MiniXLSX.escribir(hojasXLSX(lista))
    .then(blob => bajar(nombre, blob))
    .catch(err => alert('No se pudo generar el Excel (' + err.message + ').\nProbá con “JSON” o “CSV”.'));
}

function exportarXLSX() { return bajarXLSX(ST.mezclas, nombreArchivo('xlsx')); }

/* ---------------------------------------------------------------- importar */
function importarJSON(obj) {
  const arr = Array.isArray(obj) ? obj : (obj.mezclas || []);
  let n = 0;
  arr.forEach(m => {
    const d = {};
    const src = m.datos || m.d || {};
    for (const k in src) {
      const def = PORID[k] || PORCOL[k];
      if (def && !vacio(src[k])) d[def.col] = String(src[k]).trim();
    }
    ST.mezclas.push(saneaMezcla({ nombre: m.nombre || 'Mezcla ' + (ST.mezclas.length + 1), tipo: m.tipo || '', aportante: ST.autor, d: d }));
    n++;
  });
  if (!ST.autor && obj.aportante) { ST.autor = obj.aportante; $('#autor').value = ST.autor; }
  return n;
}

function importarXLSX(buf) {
  return MiniXLSX.leer(buf).then(libro => {
    const nombreHoja = libro.nombres.includes('Mezclas') ? 'Mezclas' : libro.nombres[0];
    const aoa = libro.hojas[nombreHoja] || [];
    // la fila de encabezados es la que contiene "Tipo de mezcla"
    const iEnc = aoa.findIndex(f => f.some(v => String(v).trim() === 'Tipo de mezcla'));
    if (iEnc < 0) throw new Error('no se encontró la fila de encabezados (falta “Tipo de mezcla”)');
    const enc = aoa[iEnc].map(v => String(v ?? '').trim());
    const mapa = {};                                  // índice de columna -> definición
    enc.forEach((h, k) => { const d = ESQ.columnas.find(c => c.label === h); if (d) mapa[k] = d; });
    const iTipo = enc.indexOf('Tipo de mezcla');
    const iNom = enc.indexOf('Mezcla');
    let n = 0;
    for (let r = iEnc + 1; r < aoa.length; r++) {
      const f = aoa[r] || [];
      const tipo = String(f[iTipo] ?? '').trim();
      const d = {};
      for (const k in mapa) {
        const v = f[k];
        if (!vacio(v)) d[mapa[k].col] = typeof v === 'number' ? coma(v) : String(v).trim();
      }
      if (!tipo && !Object.keys(d).length) continue;
      ST.mezclas.push(saneaMezcla({
        nombre: (iNom >= 0 ? String(f[iNom] ?? '').trim() : '') || 'Mezcla ' + (ST.mezclas.length + 1),
        tipo: tipo, aportante: ST.autor, d: d
      }));
      n++;
    }
    return n;
  });
}

function alElegirArchivo(ev) {
  const f = ev.target.files && ev.target.files[0];
  if (!f) return;
  const fin = n => {
    guardar(); subirTodasLocales(); pintarFichas(); pintarTabla(); pintarAvisos();
    alert(n ? 'Se agregaron ' + n + ' mezcla(s).' : 'El archivo no tenía mezclas para agregar.');
    ev.target.value = '';
  };
  const rd = new FileReader();
  if (/\.json$/i.test(f.name)) {
    rd.onload = () => {
      try { fin(importarJSON(JSON.parse(rd.result))); }
      catch (e) { alert('No se pudo leer el JSON: ' + e.message); }
    };
    rd.readAsText(f);
  } else {
    rd.onload = () => importarXLSX(new Uint8Array(rd.result)).then(fin)
      .catch(e => alert('No se pudo leer el Excel: ' + e.message));
    rd.readAsArrayBuffer(f);
  }
}

/* ------------------------------------------------------------------ enviar */
function repoDetectado() {
  const m = /^([^.]+)\.github\.io$/.exec(location.hostname);
  if (m) {
    const seg = location.pathname.split('/').filter(Boolean)[0];
    if (seg) return m[1] + '/' + seg;
  }
  return CONFIG.repo;
}

function resumenEnvio() {
  const porTipo = {};
  ST.mezclas.forEach(m => { const t = m.tipo || 'sin tipo'; porTipo[t] = (porTipo[t] || 0) + 1; });
  const completas = ST.mezclas.filter(m => estado(m).clase === 'ok').length;
  return ST.mezclas.length + ' mezcla(s) (' + completas + ' completa(s)): ' +
    Object.keys(porTipo).map(t => porTipo[t] + ' × ' + t).join(', ');
}

function enviarAporte() {
  if (!ST.mezclas.length) { alert('Primero cargá al menos una mezcla.'); return; }
  exportarJSON();
  const repo = repoDetectado();
  const url = 'https://github.com/' + repo + '/issues/new?' + new URLSearchParams({
    template: CONFIG.plantillaIssue,
    aportante: ST.autor || '',
    resumen: resumenEnvio()
  }).toString();
  window.open(url, '_blank', 'noopener');
  alert('Se descargó el archivo ' + nombreArchivo('json') + '.\n\n' +
    'En la pestaña que se abrió, adjuntalo arrastrándolo al campo “Archivo con las mezclas” y tocá “Submit new issue”.');
}

function enviarCorreo() {
  if (!ST.mezclas.length) { alert('Primero cargá al menos una mezcla.'); return; }
  exportarJSON();
  const cuerpo = 'Hola,\n\nAdjunto ' + resumenEnvio() + ' para la planilla colaborativa de mezclas del LEMaC.\n' +
    'El archivo adjunto es: ' + nombreArchivo('json') + '\n\nSaludos,\n' + (ST.autor || '');
  location.href = 'mailto:' + encodeURIComponent(CONFIG.correo) +
    '?subject=' + encodeURIComponent('Aporte de mezclas — ' + (ST.autor || 'sin nombre')) +
    '&body=' + encodeURIComponent(cuerpo);
}

/* -------------------------------------------------------------- ya cargadas */
let CARGADAS = [];

// Pasa una mezcla del consolidado (claves por id) al formato interno (claves por columna).
function desdeConsolidado(m) {
  const d = {};
  const datos = m.datos || {};
  for (const k in datos) if (PORID[k] && !vacio(datos[k])) d[PORID[k].col] = String(datos[k]);
  return { nombre: m.nombre || 'Mezcla', tipo: m.tipo || '', d };
}

function pintarCargadas() {
  const res = $('#resumen-cargadas');
  const tab = $('#tabla-cargadas');
  fetch('datos/mezclas.json', { cache: 'no-store' })
    .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
    .then(o => {
      const arr = o.mezclas || [];
      CARGADAS = arr.map(desdeConsolidado);
      tab.textContent = '';
      if (!arr.length) {
        res.textContent = 'Todavía no hay mezclas consolidadas. Las que envíen los colegas se van agregando acá.';
        return;
      }
      res.textContent = arr.length + ' mezcla(s) consolidada(s)' + (o.actualizado ? ' · actualizado ' + o.actualizado : '') + '.';
      const cols = ['obra_informe', 'aportado_por', 'ligante_ca_30_am_3', 'pct_ca_optimo_adoptado'];
      const thead = el('thead', {}, [el('tr', { class: 'cols' },
        [el('th', { text: '#' }), el('th', { text: 'Mezcla' }), el('th', { text: 'Tipo' })]
          .concat(cols.map(id => el('th', { text: PORID[id] ? PORID[id].label : id }))))]);
      tab.appendChild(thead);
      const tb = el('tbody');
      arr.forEach((m, i) => {
        const d = m.datos || {};
        tb.appendChild(el('tr', {}, [
          el('td', { class: 'est', text: String(i + 1) }),
          el('td', { class: 'est', text: m.nombre || '' }),
          el('td', { class: 'est', text: m.tipo || '' })
        ].concat(cols.map(id => el('td', { class: 'est', text: d[id] ?? '' })))));
      });
      tab.appendChild(tb);
    })
    .catch(() => {
      CARGADAS = [];
      res.textContent = 'No se pudo leer datos/mezclas.json.';
      tab.textContent = '';
    });
}

/* -------------------------------------------------------------------- ayuda */
function pintarAyuda() {
  const c = $('#ayuda-cuerpo');
  c.textContent = '';
  let ul = null;
  ESQ.instrucciones.forEach(r => {
    if (r.a && !r.b) { c.appendChild(el('h3', { text: r.a })); ul = null; return; }
    if (r.a && r.b) { if (!ul) { ul = el('ul'); c.appendChild(ul); } ul.appendChild(el('li', { text: r.a + ': ' + r.b })); return; }
    if (r.b) { if (!ul) { ul = el('ul'); c.appendChild(ul); } ul.appendChild(el('li', { text: r.b })); }
  });
  c.appendChild(el('h3', { text: 'En esta página' }));
  const u2 = el('ul');
  [
    'Los datos se guardan solos en este navegador; podés cerrar y seguir después.',
    'En “Fichas” se ven sólo los datos que corresponden al tipo elegido; en “Tabla” se ve la planilla completa.',
    'Se usa coma o punto decimal, como te resulte más cómodo.',
    'Al terminar, “Enviar / Exportar” revisa los datos y arma el archivo para mandar.'
  ].forEach(t => u2.appendChild(el('li', { text: t })));
  c.appendChild(u2);
}

/* ------------------------------------------------------------------- inicio */
function cambiarVista(v) {
  $$('.tab').forEach(b => b.classList.toggle('activo', b.dataset.vista === v));
  ['instrucciones', 'fichas', 'tabla', 'enviar', 'cargadas'].forEach(x => $('#vista-' + x).classList.toggle('oculta', x !== v));
  window.scrollTo(0, 0);
  // cada hoja se redibuja al entrar: así lo cargado en Tabla se ve al toque en Fichas
  if (v === 'fichas') pintarFichas();
  if (v === 'tabla') pintarTabla();
  if (v === 'enviar') pintarAvisos();
  if (v === 'cargadas') pintarCargadas();
}

function iniciar() {
  ESQ.columnas.forEach(c => { PORCOL[c.col] = c; PORID[c.id] = c; });
  document.title = ESQ.titulo + ' — LEMaC';
  cargarGuardado();
  const inAutor = $('#autor');
  if (inAutor) inAutor.value = ST.autor;
  alTocar('#autor', 'input', e => {
    ST.autor = e.target.value.trim();
    clearTimeout(alCambiar._t);
    alCambiar._t = setTimeout(() => { guardar(); Nube.nombrar(ST.autor); }, 600);
  });
  $$('.tab').forEach(b => b.addEventListener('click', () => cambiarVista(b.dataset.vista)));
  alTocar('#btn-nueva', 'click', () => { nuevaMezcla(); pintarFichas(); });
  alTocar('#btn-nueva2', 'click', () => { nuevaMezcla(); pintarTabla(); pintarFichas(); });
  alTocar('#chk-compacta', 'change', aplicarCompacta);
  alTocar('#btn-xlsx', 'click', exportarXLSX);
  alTocar('#btn-csv', 'click', exportarCSV);
  alTocar('#btn-json', 'click', exportarJSON);
  alTocar('#btn-enviar', 'click', enviarAporte);
  alTocar('#btn-mail', 'click', enviarCorreo);
  alTocar('#archivo', 'change', alElegirArchivo);
  alTocar('#btn-borrar', 'click', () => {
    if (Nube.estado.activa) {
      if (!confirm('Esto limpia la copia de este navegador. Las mezclas ya subidas siguen en la planilla compartida ' +
        '(para sacar una de ahí, abrila y usá “Borrar esta mezcla”). ¿Seguimos?')) return;
      ST.mezclas = []; ST.sel = ''; guardar();
      pintarFichas(); pintarTabla(); pintarAvisos();
      Nube.sondear();
      return;
    }
    if (!confirm('¿Borrar todas las mezclas guardadas en este navegador?')) return;
    ST.mezclas = []; ST.sel = ''; guardar(); pintarFichas(); pintarTabla(); pintarAvisos();
  });
  alTocar('#btn-cons-xlsx', 'click', () => {
    if (!CARGADAS.length) { alert('Todavía no hay mezclas consolidadas.'); return; }
    bajarXLSX(CARGADAS, 'mezclas-consolidadas-' + new Date().toISOString().slice(0, 10) + '.xlsx');
  });
  alTocar('#btn-cons-mias', 'click', () => {
    if (!CARGADAS.length) { alert('Todavía no hay mezclas consolidadas.'); return; }
    if (!confirm('Se van a agregar ' + CARGADAS.length + ' mezcla(s) del consolidado a las tuyas. ¿Seguimos?')) return;
    CARGADAS.forEach(m => ST.mezclas.push(saneaMezcla({ nombre: m.nombre, tipo: m.tipo, d: Object.assign({}, m.d) })));
    guardar(); subirTodasLocales(); pintarFichas(); cambiarVista('fichas');
  });
  pintarAyuda();
  $$('.btn-ir').forEach(b => b.addEventListener('click', () => cambiarVista(b.dataset.ir)));
  alTocar('#nube', 'click', () => {
    alert(Nube.diagnostico());
    if (Nube.estado.activa) Nube.sondear();
  });
  alTocar('#btn-subir', 'click', () => { subirTodasLocales(); pintarEstadoNube(); });
  const nota = $('#nota-repo');
  if (nota) nota.textContent = 'Los aportes van al repositorio ' + repoDetectado() + '.';
  marcarGuardado(ST.mezclas.length ? ST.mezclas.length + ' mezcla(s) guardada(s)' : 'sin datos todavía');
  if (ST.mezclas.length) ST.sel = ST.mezclas[0].lid;
  pintarFichas();
  arrancarNube();
  window.addEventListener('beforeunload', guardar);
}

function fallo(titulo, detalle) {
  const m = document.querySelector('main');
  if (!m) return;
  m.textContent = '';
  const p = el('div', { class: 'panel' }, [
    el('h2', { text: titulo }),
    el('p', { text: detalle }),
    el('p', { class: 'nota', text: 'Casi siempre se arregla recargando la página sin caché: Ctrl+F5 (o Cmd+Shift+R en Mac).' }),
    el('button', { class: 'btn btn-fuerte', type: 'button', text: 'Recargar', onclick: () => location.reload(true) })
  ]);
  m.appendChild(p);
}

fetch('datos/esquema.json', { cache: 'no-store' })
  .then(r => {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  })
  .catch(e => {
    fallo('No se pudo leer la definición de la planilla',
      'No se pudo descargar datos/esquema.json (' + e.message + '). Puede ser la conexión.');
    throw e;
  })
  .then(o => {
    ESQ = o;
    try {
      iniciar();
    } catch (e) {
      fallo('La planilla no pudo arrancar', 'Error inesperado: ' + e.message);
      throw e;
    }
  })
  .catch(() => { /* ya se mostró el cartel */ });
