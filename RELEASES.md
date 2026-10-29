# Distribuir y actualizar Clipboard Manager

## Canal de actualizaciones

El actualizador consulta `https://github.com/edwin-ortizp/clipboard-manager/releases/latest/download/latest.json` al pulsar **Buscar actualizaciones**. Se completó la release pública v0.2.3 añadiendo únicamente el manifiesto faltante, después de descargar y verificar el instalador y su firma. Ambos archivos, la etiqueta y las notas existentes permanecen intactos.

El instalador de esa release se llama `Clipboard.Manager_0.2.3_x64-setup.exe`; su manifiesto utiliza exactamente ese nombre. La aplicación 0.2.3 ya pudo consultar el canal y mostrar «Tienes la última versión» en una instancia aislada. La 0.2.4 se prepara localmente y no se publica en esta entrega.

## Transición inicial a 0.2.3

Instala manualmente `Clipboard-Manager_0.2.3_x64-setup.exe` sobre la instalación existente. La versión 0.2.2 consulta el repositorio anterior y no puede descubrir este cambio. No desinstales ni borres los datos. Las siguientes actualizaciones usarán el canal corregido cuando se publiquen instalador, firma y manifiesto.

El instalador mantiene internamente la clave de desinstalación `Clipia` y la ubicación existente, actualizando su nombre visible y ejecutable. Retira accesos directos antiguos únicamente cuando apuntan a esta instalación y migra el inicio con Windows, conservando su estado. Si detecta otra instalación o accesos nuevos ajenos, se detiene sin eliminarlos.

Se mantienen `local.clipia.desktop`, `clipia.sqlite3`, los archivos de imágenes, las credenciales y la clave de firma. Son identificadores de compatibilidad. El cambio de nombre no requiere migrar el esquema ni restablecer preferencias, proveedor, prompts o ruta TSV.

## Claves de firma

- Clave privada de este entorno: `%LOCALAPPDATA%\Clipia\signing\updater.key`.
- Clave pública: archivo adyacente `.pub`; su contenido también está en `src-tauri/tauri.conf.json`.
- La carpeta de firma está restringida a la cuenta de Windows actual y queda fuera del proyecto y de los artefactos de distribución.
- La clave privada no tiene contraseña de firma; su protección local depende de esos permisos de Windows. Respáldala en un lugar seguro, preferiblemente cifrado, junto con la pública. Nunca la publiques ni la incluyas en un ZIP del proyecto.
- Conserva la misma clave para futuras releases. Si se pierde, las instalaciones que confían en ella no podrán aceptar paquetes firmados con una nueva clave sin un procedimiento de transición.

`scripts/native.ps1 build` toma esa clave local automáticamente. Otro equipo puede proporcionar `TAURI_SIGNING_PRIVATE_KEY` y, si corresponde, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` mediante su almacén de secretos; estos valores no deben incorporarse al código ni imprimirse en logs.

La firma del actualizador verifica la autenticidad del paquete. Esta entrega no incluye un certificado Authenticode de Windows ni elimina por sí misma los avisos de SmartScreen.

## Preparar una nueva versión

1. Actualiza la misma versión SemVer en `package.json`, `src-tauri/Cargo.toml` y `src-tauri/tauri.conf.json`. Actualiza los lockfiles y `CHANGELOG.md`.
2. Ejecuta las comprobaciones de código e interfaz y valida la migración desde la versión anterior.
3. Ejecuta:

```powershell
npm run release:prepare
```

El comando compila y firma. Deja en `artifacts/release/<versión>/` el instalador `.exe`, su `.sig`, `latest.json` sin BOM y `sha256.json`. Falla si las versiones no coinciden o falta la firma. No sube archivos a Internet. Con un build ya comprobado se puede utilizar `powershell -File scripts/release.ps1 -SkipBuild`.

Publica los tres archivos desde esa carpeta: instalador, firma y `latest.json`. No subas directamente los archivos de `target/release/bundle/nsis`: sus nombres contienen espacios, que GitHub puede convertir en puntos. El preparador utiliza guiones para mantener nombres y URLs estables. No renombres los archivos después de generar el manifiesto.

4. Comprueba la firma y el rechazo de modificaciones con el ejemplo de verificación. Desde PowerShell se puede usar `& ./scripts/native.ps1 -NativeArgs @('run','--example','verify-update','--','<instalador>','<firma>','src-tauri/tauri.conf.json')`. El comando verifica el paquete real y rechaza una copia alterada y otra truncada.
5. Tras autorizar la publicación, crea una release estable con etiqueta `v<versión>` en `edwin-ortizp/clipboard-manager`. Adjunta el `.exe`, `.sig` y `latest.json` de la misma compilación. No modifiques un paquete después de firmarlo.

GitHub debe marcar la versión estable como la última release para que funcione el endpoint `/releases/latest/download/latest.json`. Las URLs del manifiesto apuntan al instalador de su etiqueta concreta.

## Antes de instalar desde Ajustes

La UI exige guardar o descartar cambios pendientes. El backend vuelve a comprobar que no haya trabajos de IA activos, pausa la cola y bloquea nuevas ejecuciones durante la actualización. Si la descarga o la firma fallan, la aplicación actual permanece instalada y se restablece el estado anterior de la cola.

Las migraciones son locales. El instalador no contiene ni reemplaza el historial, las imágenes, los prompts o las credenciales de cada usuario.
