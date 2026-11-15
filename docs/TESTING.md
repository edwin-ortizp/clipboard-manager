# Pruebas y validación

## Flujo de trabajo

Antes de implementar un CHG, comprobar rama, cambios pendientes y línea base de pruebas. Preservar el trabajo existente. Tras cada tarea ejecutar las pruebas relevantes y sus criterios de aceptación; si fallan, detener el avance. Al finalizar ejecutar la suite completa y registrar comandos, resultados y pendientes en la bitácora del CHG.

## Comprobaciones disponibles

Ejecutar desde la raíz del repositorio:

| Comando | Qué verifica |
| --- | --- |
| `npm run native:test` | Pruebas Rust: persistencia, migraciones compatibles, Unicode, purga, cola y servicios HTTP de prueba, entre otras |
| `npm run test:ui` | Playwright en Microsoft Edge, con IPC simulado; ejecuta previamente `npm run build` |
| `npm run build` | Comprobación Svelte/TypeScript y compilación Vite |
| `npm run native:check` | Comprobación de compilación Rust mediante el entorno MSVC del proyecto |
| `npm run desktop:build` | Compilación y empaquetado nativo; no sustituye las pruebas funcionales |

La suite completa de código e interfaz comprende `native:test`, `test:ui` y `build`. Añadir compilación nativa y comprobaciones manuales cuando el cambio afecte integración Windows o empaquetado. `scripts/native.ps1` prepara MSVC y admite la instalación portable en `.tools/msvc`; no cambiar el entorno del equipo para esquivar un fallo sin diagnosticarlo.

## Aislamiento y cobertura

Usar datos ficticios, SQLite temporal o en memoria y servidores HTTP locales de prueba. No leer ni modificar historial, credenciales o portapapeles personales para pruebas automatizadas.

`node scripts/native-smoke.mjs` valida el ejecutable release y WebView2 real con datos temporales en `.tools/`, proveedor simulado y captura desactivada; genera evidencia en `artifacts/`. Usarlo cuando el cambio requiera comprobar la integración real, sobre un ejecutable compilado con los cambios. No atribuir sus resultados al build nuevo si se ejecutó uno anterior.

El ejecutable admite `--data-dir <carpeta>` y `--no-capture`; combinados proporcionan una identidad de pruebas separada sin leer la clave real del proveedor. `--background` oculta la administración al iniciar. Consultar el README antes de introducir otras formas de aislamiento.

Las pruebas de interfaz no demuestran captura o pegado nativos, atajos globales ni comportamiento con ventanas elevadas. La prueba Rust `native_capture` está ignorada por defecto por restricciones del escritorio aislado; su ejecución explícita requiere un entorno adecuado. Un test ignorado no cuenta como caso aprobado.

## Aceptación y evidencia

Los tests nuevos deben cubrir reglas y fallos relevantes del CHG, reutilizando los mocks existentes. Para funciones Windows, documentar comprobaciones manuales de activación, desactivación, cierre, reinicio, foco y combinaciones de teclas según el alcance aprobado. No dar por aprobado un caso que requiere confirmación del usuario o QA sin esa evidencia.

Registrar fecha, entorno o build cuando importe, comando, resultado y limitaciones. Separar pruebas ejecutadas, pendientes y resultados históricos de [VALIDACION.md](../VALIDACION.md). Para cambios solo documentales, revisar exactitud, enlaces locales y whitespace; no es necesario recompilar la aplicación.
