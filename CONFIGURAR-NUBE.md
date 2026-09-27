# Prender la edición simultánea (10 minutos, gratis)

Mientras `datos/config-nube.json` esté vacío, la página funciona en **modo local**: cada uno
carga lo suyo y lo manda como archivo. Completando esos dos datos pasa a **modo compartido**:
todos escriben sobre la misma planilla y se ven los cambios al momento.

La base la pone Supabase (plan gratuito). Vos hacés cinco pasos; el código ya está.

## 1. Crear el proyecto

1. Entrá a <https://supabase.com> → *Start your project* → se puede entrar con la cuenta de GitHub.
2. *New project*:
   - **Name**: `planilla-mezclas-lemac` (o el que quieras).
   - **Database password**: generala y guardala en algún lado; no la vas a necesitar para esto.
   - **Region**: `South America (São Paulo)` es la más cercana.
   - **Plan**: Free.
3. Esperá un par de minutos a que termine de crearse.

## 2. Crear las tablas

1. En el menú de la izquierda: **SQL Editor** → *New query*.
2. Abrí [`supabase/esquema.sql`](supabase/esquema.sql) de este repositorio, copiá **todo** el
   contenido y pegalo en el editor.
3. **Run**. Tiene que decir *Success*. Se puede volver a ejecutar sin romper nada.

Eso crea las tablas `mezclas` y `presencias`, la función que mezcla los cambios campo por campo,
los permisos y los avisos en tiempo real.

## 3. Copiar las dos claves

En **Project Settings → API** (o *API Keys*) vas a ver:

- **Project URL**: algo como `https://abcdefghijkl.supabase.co`. Si la pantalla te la muestra
  terminada en `/rest/v1/`, no importa: la página la acomoda sola.
- **anon public** (en proyectos nuevos aparece como *publishable key*, empieza con `sb_publishable_`)

⚠️ Esa clave pública es la única que va acá. **Nunca** copies la `service_role` / *secret*: esa da
permiso total sobre la base y no debe estar en un repositorio.

## 4. Pegarlas en el repositorio

Editá `datos/config-nube.json`:

```json
{
  "url": "https://abcdefghijkl.supabase.co",
  "clave": "eyJhbGciOi...la-clave-publica...",
  "sondeoSegundos": 3
}
```

Se puede hacer desde la web de GitHub (lápiz de editar → *Commit changes*). En un minuto o dos
GitHub Pages republica la página.

> Si algo no anda, tocá el cartel de estado arriba a la derecha: te dice contra qué proyecto está
> hablando, si llega a la base, si tiene los avisos instantáneos y cuál fue el último error.

## 5. Probar

Abrí el link en dos navegadores distintos (o pedile a alguien que lo abra). Arriba a la derecha
tiene que decir **“En vivo · 1 colega(s) conectado(s)”** y lo que escribe uno aparece en la
pantalla del otro en unos segundos.

## Qué hace el modo compartido

- **Todos ven la misma planilla.** Cada mezcla es una fila compartida; el nombre de quien la
  cargó queda en la lista.
- **No se pisan.** Los cambios se mandan campo por campo: dos personas pueden estar en la misma
  fila, en columnas distintas, sin borrarse nada. Si alguien te cambia un dato que estás
  escribiendo justo en ese momento, gana lo tuyo.
- **Se ve quién está editando qué**: la celda que otro tiene abierta aparece con borde violeta y
  su nombre.
- **Sin internet sigue andando**: lo que cargues queda guardado en tu navegador, el cartel de
  arriba pasa a *Sin conexión* y cuando vuelve la señal se sincroniza solo.
- **Los avisos son instantáneos** cuando el navegador puede abrir el WebSocket de Supabase; si
  está bloqueado (redes de oficina, proxys), la página se sincroniza igual cada pocos segundos.
  Podés cambiar cada cuánto con `sondeoSegundos`.
- Las exportaciones a Excel, CSV y JSON siguen funcionando igual.

## Cosas para tener en cuenta

- **Quien tenga el link puede escribir.** Es lo mismo que un Google Sheets con link abierto. Por
  las dudas, nadie puede borrar filas de verdad: “borrar” marca la fila como borrada y queda en
  la base (`select * from mezclas where borrada` la recupera). Si más adelante querés que sólo
  entren personas identificadas, se agrega login de Supabase y se cambian las *policies* del
  final de `supabase/esquema.sql`.
- **El plan gratuito pausa el proyecto** si no se usa por una semana larga. Se reactiva con un
  botón desde el panel de Supabase; los datos no se pierden.
- **Respaldo**: bajá de vez en cuando el Excel desde *Enviar / Exportar* y guardalo, o corré
  `python3 scripts/consolidar.py` con un export JSON para dejarlo versionado en el repositorio.
- Para volver al modo local, dejá `url` y `clave` vacíos.
