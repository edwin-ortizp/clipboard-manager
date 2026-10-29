# Validación de Clipia 0.2.2

Fecha local: 28 de octubre de 2026. Windows x64.

## Entrega

- Instalador: `artifacts/release/0.2.2/Clipia_0.2.2_x64-setup.exe`.
- Tamaño: 5 149 885 bytes (4,91 MiB).
- SHA-256: `784FD4AB327489165BABAA3352E164C0A1BC4C9B499A88D834A1380084AF9C1B`.
- Firma `.sig`, manifiesto `latest.json` y `sha256.json` adyacentes.
- No se publicaron archivos ni se modificó la instalación personal.

## Resultados

| Comprobación                            | Resultado                                              |
| --------------------------------------- | ------------------------------------------------------ |
| TypeScript, Svelte y Vite               | Sin errores ni advertencias                            |
| Rust check                              | Correcto                                               |
| Pruebas Rust                            | 27 pasaron; 1 ignorada por permiso de estación Windows |
| Interfaz de producción en Edge          | 12 pasaron                                             |
| TSV adjunto, leído sin modificarlo      | 334 equivalencias válidas                              |
| Ejecutable real con datos temporales    | Correcto                                               |
| Firma del instalador                    | Válida                                                 |
| Instalador alterado y descarga truncada | Rechazados                                             |

## Diccionario TSV

El parser se comprobó con BOM, comentarios, líneas vacías, cuatro columnas, modos válidos, orígenes duplicados o incompatibles y UTF-8 inválido. El motor se verificó con palabras completas, frases, mayúsculas, acentos, límites Unicode incluyendo marcas combinadas, coincidencias literales y protección de resultados como `.gitignore` y `COVID-19`. Prioriza la coincidencia más larga cuando se solapan reglas, incluidas frases con distintos puntos de inicio, y no procesa nuevamente el texto que acaba de generar.

Se comprobaron archivos editados y eliminados entre ejecuciones, ausencia de cambios, reemplazo en la misma entrada, limpieza del origen IA y su vínculo, unificación de duplicados conservando favoritos y rechazo de una entrada que cambió durante la operación. No se guardó un original adicional ni se modificaron trabajos anteriores de IA.

La validación del archivo adjunto se ejecutó con el ejemplo local `check-mappings`, pasando la ruta como argumento. Solo se registró su cantidad de reglas; su contenido no se incorporó al código, a fixtures de prueba ni al instalador.

Las pruebas de interfaz verificaron selección de ruta, estado de 334 reglas, guardado, acción manual, etiqueta Diccionario, diálogo con título Texto corregido y aviso sin cambios. También probaron navegación por teclado del menú en el widget, Escape sin cerrar el widget, ausencia de la acción en imágenes y errores con número de línea sin modificar el historial.

## Ejecutable real

`node scripts/native-smoke.mjs` usa una identidad independiente, una base temporal y captura desactivada, sin leer la clave real de IA ni modificar el portapapeles personal. Partió del esquema 0.1 con 1000 textos ficticios y volvió a comprobar migración, cola, resultados IA, imágenes y comparación.

La prueba configuró un TSV temporal, ejecutó el comando nativo, verificó la sustitución del texto completo y la conservación del favorito, repitió la acción sin cambios y editó el archivo para comprobar su recarga. Una fila inválida produjo error sin modificar la entrada. También comprobó la prioridad de la frase más larga en el binario entregado. El primer paquete de desarrollo no incluía ese último ajuste; se reconstruyó y el paquete final pasó la prueba completa.

El portapapeles de Windows no se escribió durante estas pruebas aisladas. Se verificó que, ante un fallo de copia, el resultado corregido permaneciera guardado. La protección de una nueva copia reutiliza la comprobación de secuencia dentro de la operación nativa de escritura.

## Evidencia y medición orientativa

- `artifacts/mappings-settings.png`: selección, validación y estado del diccionario.
- `artifacts/mappings-history.png`: una única entrada corregida con etiqueta Diccionario.
- `artifacts/mappings-widget-menu.png`: menú compacto y accesibilidad.
- `artifacts/native-smoke.json`: resultado estructurado de la prueba real.
- Logs: `.tools/test-v022.log`, `.tools/ui-v022-final.log`, `.tools/provided-tsv-check.log`, `.tools/build-v022-delivery.log`, `.tools/smoke-v022.log` y `.tools/signature-v022.log`.

Muestra con datos ficticios y captura desactivada: recarga de administración 115 ms; apertura del widget 355 ms. Con ventanas cerradas quedó un proceso con 34,7 MB de memoria de trabajo, 7,2 MB privados y 0 % de CPU observado durante dos segundos. Con la administración abierta el árbol WebView2/depuración usó 442 MB de memoria de trabajo. No incluye un servidor de modelos ni constituye una garantía para otros equipos.

## Límites de esta verificación

- No se instaló 0.2.2 sobre la instalación personal en ejecución ni se efectuó una actualización completa entre dos instalaciones. Se verificaron el respaldo y migración reales, el instalador firmado, el manifiesto, las validaciones de UI y el rechazo de paquetes alterados o incompletos. La actualización online requiere publicar primero el canal autorizado en GitHub.
- La prueba de captura en una estación Windows aislada sigue ignorada porque crearla devuelve `Acceso denegado`. Queda pendiente verificar en el escritorio real la captura desde navegador/herramienta de recortes, pegado en otra aplicación, exclusiones y copia automática cuando cambian los datos durante una generación. Las conversiones y almacenamiento de imagen sí se verificaron con tests ejecutados.
- Las notificaciones de Windows se implementaron desde Rust para funcionar sin ventanas abiertas; su presentación por el sistema requiere validar la aplicación instalada y sus permisos de notificación. No se generaron notificaciones de prueba en el perfil personal.
- No se verificaron escalado físico de varios monitores, inicio con Windows ni un servidor/modelo de IA real elegido por el usuario.

El historial y los archivos de imagen no están cifrados. La clave de IA permanece separada en el almacén de Windows. La clave privada del actualizador permanece fuera del proyecto y de los artefactos públicos, en una carpeta restringida a la cuenta actual. No se publicó ningún dato ni se modificó la aplicación personal en ejecución.

- La selección nativa de archivo se integró con el plugin oficial de Tauri; las pruebas UI simulan la respuesta del selector. No se abrió un diálogo de archivos sobre el perfil personal para automatizar su interacción.
