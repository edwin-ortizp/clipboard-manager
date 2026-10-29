# Instalador y compatibilidad

`installer.nsi` deriva de la plantilla oficial de Tauri CLI **2.12.4**:
https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.12.4/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi

Licencia upstream: MIT OR Apache-2.0. El CLI está fijado a esa versión en npm. Al actualizarlo, comparar la plantilla upstream e incorporar sus correcciones antes de cambiar la versión.

Cambios locales: conservar las claves internas de instalación anteriores y ejecutar la validación de identidad/directorio en `.onInit`. `brand-migration.nsh` contiene la transición de nombre, accesos directos e inicio automático. La actualización conserva la ubicación anterior, omite el desinstalador antiguo y reemplaza el ejecutable.

Los accesos antiguos solo se retiran si su destino coincide con esta instalación. Un acceso nuevo, registro de desinstalación o inicio automático de otra instalación bloquea el proceso. El inicio automático conserva sus bytes `StartupApproved`, incluido el estado deshabilitado por Windows.

`powershell -File scripts/test-brand-migration.ps1` compila y ejecuta siete instaladores mínimos con las mismas funciones NSIS. Con `-FullInstaller`, comprueba esos escenarios usando la plantilla completa generada por Tauri y el ejecutable real. Usa una rama de registro temporal, carpetas y accesos dentro de `.tools`; nunca instala sobre la aplicación personal. Requiere el caché NSIS de una compilación Tauri previa. Verifica activación/desactivación, aprobación de Windows, datos sin cambios, referencias ajenas y conflictos. Esta prueba no sustituye una actualización interactiva completa en una VM de Windows.
