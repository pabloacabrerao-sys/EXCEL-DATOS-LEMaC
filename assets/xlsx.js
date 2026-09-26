/* MiniXLSX — lectura y escritura de archivos .xlsx sin dependencias externas.
   Alcance: lo que necesita esta planilla (valores de celda, anchos de columna,
   paneles fijos y listas de validación). Usa CompressionStream /
   DecompressionStream del navegador para el zip; si no están, escribe el zip
   sin comprimir (Excel igual lo abre) y avisa al leer.               */

'use strict';

window.MiniXLSX = (function () {

  /* ------------------------------------------------------------------ zip */
  const TABLA_CRC = (function () {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();

  function crc32(b) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < b.length; i++) c = TABLA_CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  const utf8 = s => new TextEncoder().encode(s);
  const hayStreams = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

  function porStream(u8, stream) {
    return new Response(new Blob([u8]).stream().pipeThrough(stream)).arrayBuffer()
      .then(ab => new Uint8Array(ab));
  }
  const deflar = u8 => hayStreams ? porStream(u8, new CompressionStream('deflate-raw')) : Promise.resolve(null);
  const inflar = u8 => hayStreams ? porStream(u8, new DecompressionStream('deflate-raw'))
    : Promise.reject(new Error('este navegador no puede descomprimir el archivo'));

  // archivos: [{nombre, datos:Uint8Array}] -> Blob zip
  function armarZip(archivos) {
    return Promise.all(archivos.map(a =>
      deflar(a.datos).then(z => {
        const usarZ = z && z.length < a.datos.length;
        return { nombre: utf8(a.nombre), crc: crc32(a.datos), orig: a.datos.length, cuerpo: usarZ ? z : a.datos, metodo: usarZ ? 8 : 0 };
      })
    )).then(entradas => {
      const partes = [], central = [];
      let desplazamiento = 0;

      entradas.forEach(e => {
        const h = new DataView(new ArrayBuffer(30));
        h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true);
        h.setUint16(6, 0x0800, true);                 // nombres en UTF-8
        h.setUint16(8, e.metodo, true);
        h.setUint32(14, e.crc, true);
        h.setUint32(18, e.cuerpo.length, true);
        h.setUint32(22, e.orig, true);
        h.setUint16(26, e.nombre.length, true);
        partes.push(new Uint8Array(h.buffer), e.nombre, e.cuerpo);

        const c = new DataView(new ArrayBuffer(46));
        c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true);
        c.setUint16(8, 0x0800, true);
        c.setUint16(10, e.metodo, true);
        c.setUint32(16, e.crc, true);
        c.setUint32(20, e.cuerpo.length, true);
        c.setUint32(24, e.orig, true);
        c.setUint16(28, e.nombre.length, true);
        c.setUint32(42, desplazamiento, true);
        central.push(new Uint8Array(c.buffer), e.nombre);
        desplazamiento += 30 + e.nombre.length + e.cuerpo.length;
      });

      const largoCentral = central.reduce((s, p) => s + p.length, 0);
      const fin = new DataView(new ArrayBuffer(22));
      fin.setUint32(0, 0x06054b50, true);
      fin.setUint16(8, entradas.length, true);
      fin.setUint16(10, entradas.length, true);
      fin.setUint32(12, largoCentral, true);
      fin.setUint32(16, desplazamiento, true);
      return new Blob(partes.concat(central, [new Uint8Array(fin.buffer)]),
        { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    });
  }

  // ArrayBuffer zip -> {ruta: Uint8Array}
  function abrirZip(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let fin = -1;
    for (let i = u8.length - 22; i >= 0 && i > u8.length - 70000; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { fin = i; break; }
    }
    if (fin < 0) throw new Error('no parece un archivo .xlsx (falta el índice del zip)');
    const cantidad = dv.getUint16(fin + 10, true);
    let p = dv.getUint32(fin + 16, true);
    const pend = [];
    for (let k = 0; k < cantidad; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('índice del zip dañado');
      const metodo = dv.getUint16(p + 10, true);
      const compr = dv.getUint32(p + 20, true);
      const nLargo = dv.getUint16(p + 28, true);
      const eLargo = dv.getUint16(p + 30, true);
      const cLargo = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const nombre = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nLargo));
      const nLocal = dv.getUint16(local + 26, true), eLocal = dv.getUint16(local + 28, true);
      const ini = local + 30 + nLocal + eLocal;
      pend.push({ nombre, metodo, datos: u8.subarray(ini, ini + compr) });
      p += 46 + nLargo + eLargo + cLargo;
    }
    return Promise.all(pend.map(e =>
      (e.metodo === 0 ? Promise.resolve(e.datos) : inflar(e.datos)).then(d => [e.nombre, d])
    )).then(pares => {
      const salida = {};
      pares.forEach(([n, d]) => { salida[n] = d; });
      return salida;
    });
  }

  /* -------------------------------------------------------------- escritura */
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/\u0000/g, '');

  function letraCol(n) {                     // 1 -> A
    let s = '';
    while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; }
    return s;
  }

  function xmlHoja(hoja) {
    const aoa = hoja.filas || [];
    const filas = aoa.map((f, i) => {
      const celdas = (f || []).map((v, k) => {
        if (v === null || v === undefined || v === '') return '';
        const ref = letraCol(k + 1) + (i + 1);
        if (typeof v === 'number' && Number.isFinite(v)) return '<c r="' + ref + '"><v>' + v + '</v></c>';
        return '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + esc(v) + '</t></is></c>';
      }).join('');
      return '<row r="' + (i + 1) + '">' + celdas + '</row>';
    }).join('');

    const ancho = aoa.reduce((m, f) => Math.max(m, (f || []).length), 1);
    const dim = 'A1:' + letraCol(Math.max(1, ancho)) + Math.max(1, aoa.length);

    let vistas = '<sheetViews><sheetView workbookViewId="0">';
    if (hoja.fijar) {
      vistas += '<pane xSplit="' + hoja.fijar.x + '" ySplit="' + hoja.fijar.y +
        '" topLeftCell="' + letraCol(hoja.fijar.x + 1) + (hoja.fijar.y + 1) +
        '" activePane="bottomRight" state="frozen"/>';
    }
    vistas += '</sheetView></sheetViews>';

    let cols = '';
    if (hoja.anchos && hoja.anchos.length) {
      cols = '<cols>' + hoja.anchos.map((w, k) =>
        '<col min="' + (k + 1) + '" max="' + (k + 1) + '" width="' + w + '" customWidth="1"/>').join('') + '</cols>';
    }

    let validaciones = '';
    if (hoja.listas && hoja.listas.length) {
      validaciones = '<dataValidations count="' + hoja.listas.length + '">' + hoja.listas.map(l =>
        '<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="' + l.rango + '">' +
        '<formula1>&quot;' + esc(l.opciones.join(',')) + '&quot;</formula1></dataValidation>').join('') + '</dataValidations>';
    }

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<dimension ref="' + dim + '"/>' + vistas + '<sheetFormatPr defaultRowHeight="15"/>' +
      cols + '<sheetData>' + filas + '</sheetData>' + validaciones + '</worksheet>';
  }

  // hojas: [{nombre, filas:[[...]], anchos?, fijar?{x,y}, listas?}] -> Blob
  function escribir(hojas) {
    const arch = [];
    const agregar = (nombre, texto) => arch.push({ nombre, datos: utf8(texto) });

    agregar('[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      hojas.map((h, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) +
        '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') +
      '</Types>');

    agregar('_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>');

    agregar('xl/workbook.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      hojas.map((h, i) => '<sheet name="' + esc(h.nombre) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') +
      '</sheets></workbook>');

    agregar('xl/_rels/workbook.xml.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      hojas.map((h, i) => '<Relationship Id="rId' + (i + 1) +
        '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') +
      '<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>');

    agregar('xl/styles.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
      '<borders count="1"><border/></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>');

    hojas.forEach((h, i) => agregar('xl/worksheets/sheet' + (i + 1) + '.xml', xmlHoja(h)));
    return armarZip(arch);
  }

  /* ---------------------------------------------------------------- lectura */
  function refACol(ref) {                    // "AB12" -> 27 (1-based)
    let n = 0;
    for (let i = 0; i < ref.length; i++) {
      const c = ref.charCodeAt(i);
      if (c < 65 || c > 90) break;
      n = n * 26 + (c - 64);
    }
    return n;
  }
  const refAFila = ref => parseInt(ref.replace(/^[A-Z]+/, ''), 10) || 0;

  function texto(nodo) {
    // <is>/<si> pueden venir partidos en varios <t> (rich text)
    return Array.from(nodo.getElementsByTagName('t')).map(t => t.textContent).join('');
  }

  function parsear(u8) {
    const doc = new DOMParser().parseFromString(new TextDecoder().decode(u8), 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('XML inválido dentro del .xlsx');
    return doc;
  }

  // ArrayBuffer -> {nombres:[...], hojas:{nombre: [[celda,...],...]}}
  function leer(buf) {
    return abrirZip(buf).then(zip => {
      const libro = zip['xl/workbook.xml'];
      if (!libro) throw new Error('el archivo no tiene una planilla dentro');
      const rels = zip['xl/_rels/workbook.xml.rels'] ? parsear(zip['xl/_rels/workbook.xml.rels']) : null;
      const mapaRel = {};
      if (rels) Array.from(rels.getElementsByTagName('Relationship')).forEach(r => {
        let t = r.getAttribute('Target') || '';
        if (t.startsWith('/')) t = t.slice(1); else if (!t.startsWith('xl/')) t = 'xl/' + t;
        mapaRel[r.getAttribute('Id')] = t.replace('xl/../', '');
      });

      const compartidas = [];
      if (zip['xl/sharedStrings.xml']) {
        Array.from(parsear(zip['xl/sharedStrings.xml']).getElementsByTagName('si'))
          .forEach(si => compartidas.push(texto(si)));
      }

      const nombres = [], hojas = {};
      Array.from(parsear(libro).getElementsByTagName('sheet')).forEach((s, i) => {
        const nombre = s.getAttribute('name') || ('Hoja' + (i + 1));
        const rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
        const ruta = mapaRel[rid] || ('xl/worksheets/sheet' + (i + 1) + '.xml');
        const datos = zip[ruta];
        nombres.push(nombre);
        if (!datos) { hojas[nombre] = []; return; }
        const aoa = [];
        Array.from(parsear(datos).getElementsByTagName('row')).forEach(row => {
          let iFila = parseInt(row.getAttribute('r'), 10);
          const celdas = Array.from(row.getElementsByTagName('c'));
          if (!iFila) iFila = (celdas[0] ? refAFila(celdas[0].getAttribute('r')) : aoa.length + 1);
          const f = aoa[iFila - 1] || (aoa[iFila - 1] = []);
          celdas.forEach((c, k) => {
            const ref = c.getAttribute('r');
            const iCol = ref ? refACol(ref) : k + 1;
            const tipo = c.getAttribute('t') || 'n';
            let v = '';
            if (tipo === 'inlineStr') {
              const is = c.getElementsByTagName('is')[0];
              v = is ? texto(is) : '';
            } else {
              const nv = c.getElementsByTagName('v')[0];
              const bruto = nv ? nv.textContent : '';
              if (tipo === 's') v = compartidas[parseInt(bruto, 10)] ?? '';
              else if (tipo === 'str' || tipo === 'e') v = bruto;
              else if (tipo === 'b') v = bruto === '1' ? 'VERDADERO' : 'FALSO';
              else if (bruto === '') v = '';
              else { const n = Number(bruto); v = Number.isFinite(n) ? n : bruto; }
            }
            f[iCol - 1] = v;
          });
        });
        for (let i2 = 0; i2 < aoa.length; i2++) if (!aoa[i2]) aoa[i2] = [];
        hojas[nombre] = aoa;
      });
      return { nombres, hojas };
    });
  }

  return { escribir, leer, letraCol, hayCompresion: hayStreams };
})();
