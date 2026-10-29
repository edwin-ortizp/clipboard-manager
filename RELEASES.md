# Distribuir y actualizar Clipia

## Canal preparado

El actualizador consulta `https://github.com/edwin-ortizp/clipia-releases/releases/latest/download/latest.json` al pulsar **Buscar actualizaciones**. No se creó ese repositorio ni se publicó una release durante esta implementación. Hasta publicar los archivos, la consulta mostrará que no puede contactar el canal.

El repositorio propuesto es público y se destina exclusivamente a instaladores y metadatos. Publicar allí los paquetes no requiere publicar este código fuente ni el historial del usuario. La creación del repositorio y la publicación requieren una instrucción explícita adicional.

## Primera actualización desde 0.1

La versión 0.1 no contiene el actualizador. Instala una vez `Clipia_0.2.2_x64-setup.exe` sobre la instalación existente, sin desinstalar ni borrar los datos. El identificador y la carpeta de datos se mantienen. La primera apertura respalda la base antigua con un nombre `clipia-before-v2-<fecha>.sqlite3`, migra las entradas y conserva ajustes, prompts y trabajos. La clave de IA continúa en el almacén de credenciales de Windows.

Después de instalar 0.2, las siguientes versiones publicadas se podrán descargar desde Ajustes con **Actualizar y reiniciar**. No hace falta desinstalar ni configurar de nuevo la aplicación. El actualizador de Windows muestra el progreso de instalación.

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

4. Comprueba la firma y el rechazo de modificaciones con el ejemplo de verificación. Desde PowerShell se puede usar `& ./scripts/native.ps1 -NativeArgs @('run','--example','verify-update','--','<instalador>','<firma>','src-tauri/tauri.conf.json')`. El comando verifica el paquete real y rechaza una copia alterada y otra truncada.
5. Tras autorizar la publicación, crea una release estable con etiqueta `v<versión>` en `edwin-ortizp/clipia-releases`. Adjunta el `.exe`, `.sig` y `latest.json` de la misma compilación. No modifiques un paquete después de firmarlo.

GitHub debe marcar la versión estable como la última release para que funcione el endpoint `/releases/latest/download/latest.json`. Las URLs del manifiesto apuntan al instalador de su etiqueta concreta.

## Antes de instalar desde Ajustes

La UI exige guardar o descartar cambios pendientes. El backend vuelve a comprobar que no haya trabajos de IA activos, pausa la cola y bloquea nuevas ejecuciones durante la actualización. Si la descarga o la firma fallan, la aplicación actual permanece instalada y se restablece el estado anterior de la cola.

Las migraciones son locales. El instalador no contiene ni reemplaza el historial, las imágenes, los prompts o las credenciales de cada usuario.
