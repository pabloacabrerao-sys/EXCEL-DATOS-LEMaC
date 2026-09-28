# Planilla colaborativa de mezclas asfálticas — LEMaC

Versión web de la planilla `Planilla_colaborativa_de_mezclas.xlsx`: una página que los colegas
abren con un link, completan desde el navegador (computadora o celular) y devuelven como archivo,
para juntar diseños históricos de mezclas y calibrar el Dosificador del LEMaC.

**Link para compartir:** https://pabloacabrerao-sys.github.io/EXCEL-DATOS-LEMaC/

La planilla tiene dos modos: **local** (cada uno carga lo suyo y lo manda como archivo) y
**compartido en vivo** (todos escriben sobre la misma planilla y ven los cambios al momento).
Para prender el segundo hay que crear una base gratuita en Supabase y pegar dos datos en
`datos/config-nube.json`: está explicado paso a paso en [CONFIGURAR-NUBE.md](CONFIGURAR-NUBE.md).

## Qué hace la página

- Las columnas del Excel original (más “% filler de aporte”, que faltaba), mismos ocho tipos de mezcla (CAC D 12, CAC D 19, MAC F8, MAC F10, CAD 12,
  SMA 10, SMA 12, SMA 19) y la misma matriz de obligatorio / recomendado / no aplica del Excel.
- **Instrucciones**: es lo primero que se abre, con los pasos en texto grande y botones que llevan
  a cada hoja. **Tabla**: la planilla completa, con los mismos colores que el Excel.
  **Fichas**: una mezcla por vez, mostrando sólo los datos que corresponden al tipo elegido, con
  la norma de cada ensayo a mano.
- Calcula el estado de cada mezcla (*Completa* o *Faltan N*) mientras se carga.
- Guarda solo en el navegador de quien carga: se puede cerrar y seguir otro día.
- Revisa los datos antes de enviar: obligatorios que faltan, granulometría que crece, series
  Marshall con menos de tres contenidos, óptimo fuera de la serie, valores fuera de rango.
- Exporta a `.xlsx` **con el mismo formato que la planilla original** (se importa desde
  *Pestaña 5 → Importar tabla de recopilación…*), a CSV y a JSON.
- Importa un `.json` propio o un `.xlsx` con el formato de la planilla, para retomar trabajo.
- No usa librerías externas para lo esencial: el lector/escritor de `.xlsx` es `assets/xlsx.js`.
- **En modo compartido**: edición simultánea con fusión campo por campo, presencia de quién está
  editando cada celda, cola de cambios cuando se corta internet y avisos instantáneos por
  WebSocket con sincronización por sondeo como respaldo.

## Cómo lo usa un colega

1. Abre el link y escribe su nombre en *Aportado por*.
2. **+ Nueva** → elige el tipo de mezcla → completa lo que esté en naranja (obligatorio) y, si lo
   tiene, lo amarillo (recomendado). Lo gris no corresponde a ese tipo.
3. Repite por cada mezcla que quiera aportar.
4. **Enviar / Exportar** → revisa los avisos → *Descargar y abrir el formulario de aporte*:
   se descarga un `.json` y se abre un aporte en GitHub donde lo adjunta.
   Si no tiene cuenta de GitHub, usa *Preparar envío por correo* o manda el archivo descargado
   por donde le quede cómodo.

No hace falta instalar nada ni tener Excel.

## Cómo se reciben y consolidan los aportes

Los aportes llegan como *issues* con la etiqueta `aporte`
([formulario](.github/ISSUE_TEMPLATE/aporte-de-mezclas.yml)). Para incorporarlos:

```bash
# guardar los archivos adjuntos de los issues en aportes/
python3 scripts/consolidar.py aportes/ --xlsx
```

El script:

- acepta `.json` de la página web y `.xlsx` con el formato de la planilla (necesita `openpyxl`);
- agrega al consolidado `datos/mezclas.json` sin repetir (compara aportante + obra + nombre + tipo);
- informa qué mezclas quedaron incompletas y qué obligatorios les faltan;
- con `--xlsx` escribe además `datos/consolidado.xlsx`, listo para importar en el Dosificador.

Después de un `git push` del `datos/mezclas.json` actualizado, la pestaña **Ya cargadas** de la
página muestra el consolidado y permite bajarlo en Excel.

Para ver el estado sin agregar nada: `python3 scripts/consolidar.py --revisar`.

## Publicar la página

En GitHub: **Settings → Pages → Build and deployment → Deploy from a branch**, rama
`claude/gallant-hypatia-jx3phk` (o la rama principal si se fusiona), carpeta `/ (root)`.
En un par de minutos queda publicada en la URL de arriba. Son archivos estáticos: no hay
servidor, base de datos ni claves.

## Estructura

| Ruta | Qué es |
| --- | --- |
| `index.html` | la página |
| `assets/app.js` | lógica de la planilla (requisitos, estado, avisos, importar/exportar) |
| `assets/xlsx.js` | lectura y escritura de `.xlsx` sin dependencias |
| `assets/estilos.css` | estilos |
| `assets/nube.js` | sincronización con la planilla compartida (Supabase) |
| `datos/esquema.json` | columnas, ayudas, grupos y matriz de requisitos por tipo de mezcla |
| `datos/config-nube.json` | URL y clave pública de Supabase; vacío = modo local |
| `supabase/esquema.sql` | tablas, permisos y funciones de la base compartida |
| `datos/mezclas.json` | consolidado de lo que fueron aportando los colegas |
| `plantilla/…xlsx` | la planilla Excel original, para quien prefiera cargar ahí |
| `scripts/consolidar.py` | junta los aportes recibidos en el consolidado |
| `aportes/` | carpeta de trabajo para los archivos que llegan |

## Cambiar columnas o requisitos

Todo sale de `datos/esquema.json`: `columnas` (con `col`, `id`, `label`, `ayuda`, `tipo`) y
`tipos[].requisitos`, que asocia cada letra de columna con `obligatorio`, `recomendado` o
`no_aplica`. Editando ese archivo cambian a la vez las fichas, la tabla, los avisos, el Excel que
se exporta y el consolidador; no hay listas de columnas repetidas en el código.

## Los dos modos

| | Local (sin configurar) | Compartido en vivo |
| --- | --- | --- |
| Dónde quedan los datos | en el navegador de cada uno | en una base Supabase gratuita |
| Cómo llegan al LEMaC | archivo por issue o correo | ya están; se exportan cuando haga falta |
| Varios a la vez | cada uno en su copia | todos en la misma planilla |
| Qué hay que configurar | nada | `datos/config-nube.json` ([guía](CONFIGURAR-NUBE.md)) |

En modo compartido el envío por archivo sigue disponible: sirve para quien prefiera cargar en
Excel o no quiera entrar a la planilla compartida.
