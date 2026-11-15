# Arquitectura

## Estructura actual

Aplicación Windows con Tauri 2, Rust, Svelte 5, TypeScript y SQLite. Vite compila el frontend. La comunicación con Rust usa comandos IPC tipados y eventos Tauri; el frontend no accede directamente al proveedor HTTP ni recibe la clave API.

| Área | Responsabilidad |
| --- | --- |
| `src/App.svelte`, `src/types.ts` | Administración, widget, estado de interfaz y contratos IPC |
| Componentes de `src/` y `src/style.css` | Miniaturas, menús, chip IA, comparación y estilos compartidos |
| `src-tauri/src/main.rs` | Comandos, estado compartido, cola, eventos, ventanas, bandeja y atajo |
| `db.rs` | Persistencia, esquema, historial, prompts, ajustes y recuperación de trabajos |
| `clipboard.rs`, `media.rs` | Integración Windows, exclusiones, escritura, imágenes PNG y limpieza |
| `ai.rs`, `delivery.rs` | HTTP y credenciales; entrega, copia protegida y notificaciones |
| `mappings.rs` | Lectura, validación y aplicación del diccionario TSV |
| `startup.rs`, `updates.rs` | Inicio con Windows y actualizaciones verificadas |

Los nombres Rust de la tabla corresponden a `src-tauri/src/`.

## Ciclo de vida y concurrencia

Rust mantiene la captura y la cola sin una ventana web residente. Las ventanas se crean bajo demanda y se destruyen al cerrar; el widget también se libera al perder el foco. Reabrir recupera el historial persistente, sin conservar la búsqueda o selección temporal.

Reutilizar los puntos existentes de apertura de ventanas y emisión de cambios. Mantener el trabajo lento fuera de callbacks nativos y del hilo de interfaz. Conservar el procesamiento serial de IA y evitar mantener el bloqueo de SQLite durante operaciones de red. Los trabajos guardan snapshots de su entrada, prompt, URL y modelo; obtienen la credencial al ejecutarse.

## Compatibilidad y seguridad

- Mantener alineados los contratos Rust serializados, `src/types.ts`, valores iniciales de la UI y mocks de pruebas cuando el CHG permita modificarlos. Si exige archivos adicionales, registrar la desviación antes de ampliar el alcance.
- Los ajustes Rust usan `#[serde(default)]`: añadir preferencias con valores compatibles para instalaciones anteriores y probar su lectura.
- Preservar `local.clipia.desktop`, la base `clipia.sqlite3` y los identificadores de credenciales y firma. Son contratos de compatibilidad, aunque la marca visible sea Clipboard Manager.
- Mantener credenciales y acceso HTTP en Rust. No ampliar CSP ni capacidades Tauri sin una necesidad aprobada. Usar errores que no expongan cuerpos HTTP sensibles.
- El historial reside en el directorio de datos de la aplicación, con imágenes en `media`. Las pruebas deben usar datos temporales e identidad aislada.
- Los cambios de dependencias, migraciones destructivas y operaciones de publicación requieren autorización explícita. Conservar los lockfiles y la firma de actualización.

Reutilizar módulos y componentes antes de introducir infraestructura nueva. El diseño específico del CHG determina los cambios permitidos; cualquier incompatibilidad con estos lineamientos se consulta antes de implementar.
