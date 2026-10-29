# Clipboard Manager

Gestor de portapapeles para Windows 11 con historial de texto e imágenes y acciones de IA mediante un servidor compatible con OpenAI. Tauri 2 + Rust + Svelte 5 + SQLite.

Consulta [VALIDACION.md](VALIDACION.md) para los resultados, mediciones y comprobaciones manuales pendientes de esta entrega.

## Usar la aplicación

1. Ejecuta el instalador de `artifacts/release/<versión>/` o el ejecutable `src-tauri/target/release/clipboard-manager.exe`.
2. Copia texto o imágenes en cualquier aplicación. Clipboard Manager guarda el historial mientras está ejecutándose, aunque cierres sus ventanas.
3. Abre el widget con **Ctrl+Alt+V** o desde el icono en la bandeja. El atajo puede cambiarse en Ajustes. Win+V sigue abriendo el historial de Windows.
4. Selecciona uno o varios textos y elige un prompt. Puedes procesarlos por separado o unirlos, ajustando previamente su orden.
5. Los resultados aparecen automáticamente en el historial, marcados como IA. Al terminar un lote se copia el último resultado correcto, siempre que no hayas copiado otra cosa durante la espera. La cola conserva los originales y todos los resultados para su revisión.

Los favoritos no cuentan para el límite de 1000 entradas normales, compartido por textos e imágenes. Puedes cambiar ese límite, pausar la captura y limpiar las entradas normales. Las imágenes permiten vista ampliada, copia, favoritos y eliminación, sin acciones de IA. La limpieza del historial no elimina los originales ni los resultados conservados en los trabajos de IA.

La **×** del widget o **Escape** cierran su ventana sin detener la captura ni la cola. Puedes reabrirlo con el atajo o desde la bandeja. Para terminar la aplicación y la captura, usa **Salir** en el menú del icono de la bandeja. El inicio con Windows está desactivado por defecto.

## Diccionario de equivalencias

En **Ajustes → Diccionario de equivalencias**, selecciona un archivo `.tsv`, compruébalo y guarda los ajustes. El archivo permanece en la ruta elegida y Clipboard Manager lo lee sin modificarlo; usa una ubicación permanente, no una carpeta temporal de cargas. Una ruta vacía desconfigura el diccionario.

Cada regla usa cuatro columnas separadas por tabuladores: `origen`, `reemplazo`, `word|any`, `case|nocase`. Se admite UTF-8 con o sin BOM, comentarios iniciados por `#` y líneas vacías. Origen y destino no pueden estar vacíos. Las filas inválidas, modos desconocidos y orígenes duplicados o incompatibles muestran su número de línea.

En una tarjeta de texto abre **⋯ → Aplicar equivalencias**. No se ejecuta automáticamente ni utiliza IA. Se procesa el texto completo con coincidencias literales, priorizando las más largas que se solapen y sin aplicar reglas otra vez sobre lo que se acaba de reemplazar. `word` usa límites Unicode; `any` permite coincidencias dentro de otro texto; `nocase` ignora mayúsculas, pero no acentos. Se evita repetir una regla dentro de su propio resultado canónico, como duplicar el punto de `.gitignore`.

La entrada queda sustituida por el texto corregido, identificada como **Diccionario**, sin conservar otra entrada ni una comparación con el original. Si ya existía ese resultado, se unifican las entradas y se conserva el favorito si cualquiera lo tenía. Los trabajos antiguos de IA no se modifican. Las imágenes no tienen esta acción.

Cada ejecución vuelve a leer el TSV para tomar tus cambios. Si el archivo es inválido o no está disponible, no se modifica el historial ni el portapapeles. Si no hay cambios, tampoco se escribe nada. Al corregir, el resultado se copia solo si el portapapeles no cambió desde que ejecutaste la acción; si no se puede copiar, el texto corregido sigue disponible en el historial.

## Actualizaciones y avisos

Los resultados generados llevan un chip **IA**. **Ver cambios** compara el original y el resultado por palabras: eliminaciones en rojo y tachadas, adiciones en verde y subrayadas. Puedes alternar entre Cambios, Original y Resultado; la ventana completa también permite Dos columnas. **Copiar resultado** siempre copia el texto final limpio, cualquiera que sea la vista. Si los textos coinciden se indica expresamente; si la comparación es demasiado costosa se muestra por bloques. No se aceptan o rechazan cambios individuales.

La versión 0.2 incorpora **Ajustes → Actualizaciones**. La 0.1 requiere una actualización manual inicial. El canal de GitHub está preparado y pendiente de publicación autorizada; consulta [RELEASES.md](RELEASES.md). Las actualizaciones mantienen los datos y verifican la firma del instalador.

Los resultados se guardan aunque pauses la captura. Con Clipboard Manager en primer plano verás un aviso y el resumen en el historial; en segundo plano se intenta mostrar una notificación de Windows. Puedes desactivar copia automática y notificaciones desde Ajustes. Si el portapapeles cambió mientras trabajaba la IA, se conserva tu copia más reciente y el resultado queda disponible en el historial. Un lote entrega una única notificación final.

La tipografía Nunito y su licencia se incluyen localmente; la interfaz funciona sin descargar fuentes.

## Conectar IA local

Instala y ejecuta tu servidor de modelos por separado. En Ajustes configura:

| Campo                | Ejemplo                                                                 |
| -------------------- | ----------------------------------------------------------------------- |
| URL base             | `http://127.0.0.1:1234/v1` para una configuración habitual de LM Studio |
| URL base alternativa | `http://127.0.0.1:11434/v1` para una configuración habitual de Ollama   |
| Modelo               | El identificador del modelo cargado en tu servidor                      |
| Clave API            | Opcional, según el servidor                                             |

Las direcciones son ejemplos: utiliza la URL que muestre tu servidor. Clipboard Manager añade `/models` o `/chat/completions` a la URL base; no añade `/v1` por su cuenta. El servidor debe aceptar `messages` y devolver texto en `choices[0].message.content`. No se requiere streaming.

Guarda los ajustes y usa **Consultar modelos** si el servidor ofrece `/models`; también puedes escribir el identificador manualmente. **Probar conexión y generación** realiza una petición breve de prueba al modelo, por lo que comprueba más que la disponibilidad del endpoint. Ambas acciones utilizan la clave ya guardada, no una clave todavía sin guardar.

La cola procesa un trabajo a la vez. El timeout es de 120 segundos. Un fallo no impide ejecutar los siguientes trabajos; cancelar aborta la petición del cliente, aunque el servidor puede continuar calculando. Los reintentos son explícitos. Cada trabajo conserva su texto, prompt, URL y modelo; la credencial se obtiene del almacén de Windows en el momento de ejecutarlo.

Al reiniciar, los trabajos que estaban ejecutándose pasan a fallidos y requieren reintento. Si había pendientes, la cola arranca pausada hasta pulsar **Reanudar**. Pausar la cola permite terminar el trabajo actual; cancelar lo interrumpe.

## Prompts

La biblioteca permite crear, editar y eliminar prompts, establecer su orden y marcarlos como favoritos. Las instrucciones deben incluir `{{text}}`, que se sustituye por el texto completo. Se incluyen cuatro ejemplos en la primera apertura. Cambiar o eliminar un prompt no afecta a los trabajos que ya estaban encolados.

## Datos y privacidad

- Las imágenes PNG y miniaturas se guardan en la subcarpeta `media` de los datos de la aplicación. Se eliminan cuando se elimina o purga su entrada, excepto favoritos.
- SQLite se guarda en `%APPDATA%\local.clipia.desktop\clipia.sqlite3`, con archivos auxiliares WAL/SHM mientras se usa.
- El historial y los trabajos se guardan sin cifrar. La clave API se conserva separadamente en el almacén de credenciales de Windows.
- No hay cuentas, sincronización, telemetría propia ni envío automático a IA. El destino de red es el proveedor configurado; una URL remota enviará allí el texto seleccionado.
- No se escriben contenidos ni claves en logs. Los errores HTTP muestran el estado, sin incluir el cuerpo potencialmente sensible del servidor.
- Se respetan `ExcludeClipboardContentFromMonitorProcessing` y `CanIncludeInClipboardHistory=0`. Esto no identifica todas las contraseñas: si una aplicación copia texto sin estas marcas, puede entrar en el historial. Puedes pausar la captura desde la bandeja.
- Se capturan texto plano e imágenes desde que Clipboard Manager está activo. No se importa el historial previo de Windows, ni archivos o formato enriquecido. Las imágenes se conservan como PNG y no se envían al modelo.

## Desarrollo

Requisitos: Node.js 22.12+ (o 20.19+), Rust estable MSVC, Microsoft Edge WebView2 Runtime y Visual Studio Build Tools con **Desarrollo para el escritorio con C++** y Windows SDK. Las dependencias quedan fijadas en `package-lock.json` y `src-tauri/Cargo.lock`.

```powershell
npm ci
npm run desktop:dev
```

`scripts/native.ps1` prepara el entorno de MSVC instalado. También admite una instalación portable local en `.tools/msvc/setup_x64.bat`; esa carpeta no se distribuye ni se incorpora al código fuente.

```powershell
npm run build
npm run native:check
npm run native:test
npm run test:ui
npm run desktop:build
```

Las pruebas de interfaz usan Microsoft Edge mediante Playwright y un transporte IPC simulado, sin acceder al portapapeles real. Las pruebas Rust verifican persistencia, Unicode, deduplicación, purga, reinicio y respuestas HTTP de servidores de prueba locales. `npm run dev` solo abre la vista web, sin funciones de escritorio.

`node scripts/native-smoke.mjs` comprueba el ejecutable release con WebView2 real, 1000 entradas ficticias, un proveedor HTTP simulado y una base temporal bajo `.tools/`. Comprueba cola serial, snapshots de prompts, unión, errores, cancelación, reintento y recuperación tras reinicio; genera capturas y métricas en `artifacts/`. No captura ni modifica el portapapeles personal.

La prueba Rust de captura nativa en una estación de Windows aislada queda ignorada por defecto: este entorno devuelve `Acceso denegado` al crearla. Se puede ejecutar explícitamente en un entorno con ese permiso mediante `cargo test --manifest-path src-tauri/Cargo.toml native_capture -- --ignored`. Esto deja pendiente comprobar manualmente la captura desde otras aplicaciones, las exclusiones y la ausencia de recaptura propia en el escritorio real. Las pruebas no verifican un modelo local real ni una configuración física de varios monitores.

El empaquetado produce un instalador NSIS para el usuario actual. Los paquetes de actualización incluyen firma criptográfica; no se incluye firma Authenticode ni se publican versiones automáticamente.

### Ejecución aislada para pruebas

El ejecutable acepta `--data-dir <carpeta>` para usar otra base de datos y `--no-capture` para desactivar la integración del portapapeles durante pruebas. `--background` evita mostrar la ventana de administración al iniciar. Solo se permite una instancia normal de Clipboard Manager por sesión. Combinar `--data-dir` y `--no-capture` crea una identidad de pruebas separada, sin leer la clave real del proveedor.

## Arquitectura

- `src/`: ventanas de administración y widget, tipos y estilos locales, sin fuentes o recursos remotos.
- `src-tauri/src/db.rs`: esquema local, historial, prompts, configuración y recuperación al reiniciar.
- `src-tauri/src/clipboard.rs`: ventana nativa de mensajes, escucha de cambios, formatos de exclusión y escritura Unicode sin recaptura propia.
- `src-tauri/src/ai.rs`: transporte HTTP compatible con OpenAI y acceso al almacén de credenciales.
- `src-tauri/src/media.rs`: normalización PNG, miniaturas y limpieza de archivos.
- `src-tauri/src/delivery.rs`: entrega final de lotes, copia protegida y notificaciones.
- `src-tauri/src/updates.rs`: consulta, descarga, verificación e instalación de actualizaciones.
- `src-tauri/src/main.rs`: comandos tipados, cola serial, eventos, atajo, ventanas y bandeja.

La comunicación entre UI y Rust usa comandos internos Tauri. El frontend no tiene acceso HTTP directo al proveedor ni recibe la clave API.

Las ventanas se crean bajo demanda y se destruyen al cerrarlas; el widget también se libera al perder el foco. La captura y la cola permanecen activas en Rust sin necesitar una ventana web residente. Al reabrir el widget se recupera el historial persistente; la búsqueda y selección temporal comienzan de nuevo.
