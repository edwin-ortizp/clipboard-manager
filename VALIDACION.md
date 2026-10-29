# Validación de Clipboard Manager 0.2.4

## Entrega local

- Instalador: `artifacts/release/0.2.4/Clipboard-Manager_0.2.4_x64-setup.exe`.
- Firma del actualizador: archivo adyacente `.exe.sig`; no es una firma Authenticode.
- Manifiesto y hash: `latest.json` y `sha256.json`, en la misma carpeta.
- SHA-256: `8DF4529A6334244D3755FF54AD4F824FF0960891BC5898CC02D9AABAD0DAF03E`.
- Se añadió únicamente `latest.json` a la release 0.2.3, con autorización. La 0.2.4 no se publicó y la instalación personal no se modificó.

## Comprobaciones ejecutadas

| Comprobación                                                  | Resultado                             |
| ------------------------------------------------------------- | ------------------------------------- |
| Svelte / TypeScript y compilación release                     | Sin errores ni advertencias de Svelte |
| Pruebas Rust                                                  | 30 correctas, 1 ignorada              |
| Pruebas Playwright                                            | 16 correctas                          |
| Migración NSIS mínima (validada en 0.2.3)                     | 7 escenarios correctos                |
| Plantilla completa del instalador aislada (validada en 0.2.3) | 7 escenarios correctos                |
| Ejecutable real con 1000 entradas ficticias                   | Correcto                              |
| Metadatos del ejecutable                                      | Clipboard Manager, versión 0.2.4      |
| Firma del paquete                                             | Válida con la clave pública existente |
| Paquete alterado o truncado                                   | Rechazado                             |

La prueba Rust ignorada requiere una estación de portapapeles aislada que este entorno no permite crear. No se escribió en el portapapeles personal para sortear esa restricción.

## Cierre del widget y canal público

Las pruebas de interfaz verificaron la × con ratón, Enter, foco visible y Escape en temas claro y oscuro a 380 × 540, sin desbordamiento. La aplicación real cerró el widget mediante la ×, mantuvo vivo el proceso y la preferencia de captura, lo reabrió y volvió a cerrarlo con Escape. La captura nativa estuvo desactivada en estas instancias de prueba para conservar el portapapeles personal; no se realizó una nueva prueba de captura real.

La consulta limpia actualizaciones y notas anteriores antes de buscar. Un fallo termina el estado de búsqueda, muestra el motivo y permite reintentar. Rust verificó timeout y conexión fallida con errores HTTP reales, respuesta JSON malformada, esquema inválido, manifiesto no disponible y plataforma incompatible. La UI comprobó una versión disponible seguida de error y reintento sin novedades.

Se descargaron el instalador y la firma publicados en 0.2.3. El SHA-256 coincidió con la entrega anterior y la firma pasó la verificación con la clave pública existente. Se publicó únicamente el manifiesto faltante, usando la URL exacta con `Clipboard.Manager`. Los IDs y hashes del instalador y su firma no cambiaron; tampoco la etiqueta o las notas. Recibo: `artifacts/repair-v0.2.3/publication-receipt.json`.

El endpoint público respondió correctamente y una instancia aislada del ejecutable 0.2.3 mostró «Tienes la última versión»; log `.tools/live-updater-v023.log`. Los archivos de 0.2.4 se prepararon solo localmente. Su firma es válida y una copia alterada y otra truncada fueron rechazadas.

Logs de esta entrega: `.tools/test-v024.log`, `.tools/ui-v024.log`, `.tools/build-v024.log`, `.tools/smoke-v024.log`, `.tools/signature-v024.log`, `.tools/signature-published-v023.log` y `.tools/live-updater-v024.log`. Capturas nuevas: `artifacts/widget-close-light.png`, `artifacts/widget-close-dark.png` y `artifacts/native-widget.png`.

## Compatibilidad del instalador

`scripts/test-brand-migration.ps1` comprueba las funciones de migración. Con `-FullInstaller`, compila la plantilla NSIS generada de distribución con sus mismos hooks y ejecutable, sustituyendo únicamente registros, escritorio y menú Inicio por ubicaciones de prueba. No ejecuta la aplicación al finalizar.

Se verificaron inicio automático activado, desactivado, deshabilitado por el Administrador de tareas y una referencia antigua ajena. Se verificó rechazo con código 42 ante registro de otra instalación, acceso directo nuevo ajeno e inicio automático nuevo ajeno. Los conflictos no escribieron el ejecutable nuevo.

El registro existente cambió de nombre visible sin crear otra aplicación; el binario anterior se retiró y el acceso propio pasó al ejecutable nuevo. El acceso antiguo ajeno se conservó. El comando de inicio nuevo usa comillas y conserva exactamente los 12 bytes de StartupApproved. Los archivos testigo de historial/configuración e imágenes mantuvieron sus bytes. El identificador, servicio de credenciales, nombres internos de datos y clave pública no cambian.

## Interfaz y aplicación real

Playwright comprobó la marca en dos líneas, ausencia del nombre anterior y desbordamientos en administración compacta y widget de 380 × 540. También comprobó historial, imágenes, prompts, cola, comparación IA, diccionario TSV y ajustes de actualización. Se revisó visualmente `artifacts/clipboard-manager-brand.png`.

`node scripts/native-smoke.mjs` abrió el ejecutable con identidad independiente, base temporal y captura desactivada, sin leer la credencial real. Verificó migración desde un esquema antiguo, 1000 entradas, imágenes, siete trabajos, resultados y comparaciones IA, y aplicación/relectura del diccionario. Resultado: `artifacts/native-smoke.json`.

Muestra orientativa: administración 120 ms, widget 409 ms; en segundo plano un proceso con 34,5 MB de memoria de trabajo y 0 % de CPU observado durante dos segundos. Usa datos ficticios y no constituye garantía para otros equipos.

Logs: `.tools/check-v023.log`, `.tools/test-v023.log`, `.tools/ui-v023-final.log`, `.tools/build-v023-final.log`, `.tools/bundle-v023-final.log`, `.tools/migration-full-v023.log`, `.tools/smoke-v023.log` y `.tools/signature-v023.log`.

## Comprobaciones pendientes

- Instalación interactiva sobre una instalación real anterior en una VM de Windows y reinicio de sesión para comprobar el lanzamiento automático. La automatización aislada no representa una VM completa ni una prueba sobre datos personales.
- Revisión manual de bandeja, notificaciones de Windows y escalados/monitores adicionales.
- Publicación de 0.2.4 cuando se autorice y prueba de instalación de una versión nueva mediante el actualizador. El manifiesto de 0.2.3 ya está publicado y su consulta HTTPS fue comprobada.

La transición desde 0.2.2 requiere instalar manualmente este paquete una vez, pues aquella versión consulta el canal anterior. Consulta [RELEASES.md](RELEASES.md).
