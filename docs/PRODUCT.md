# Producto

## Propósito

Clipboard Manager es una aplicación de escritorio para Windows 11 que conserva texto e imágenes del portapapeles y permite recuperar contenido y transformar textos mediante un proveedor compatible con OpenAI. Usa una ventana de administración y un widget compacto, con acceso desde la bandeja y un atajo configurable.

## Comportamientos que se deben conservar

- La captura y la cola siguen funcionando al cerrar las ventanas. Salir desde la bandeja termina la aplicación. El inicio con Windows es opcional y está desactivado por defecto.
- El historial permite búsqueda, favoritos, copia y eliminación. El límite predeterminado es de 1000 entradas normales; los favoritos quedan fuera de la purga.
- Las imágenes tienen vista ampliada, copia y favoritos; no se envían a IA. No se importan el historial anterior de Windows, archivos ni formato enriquecido.
- Los prompts incluyen `{{text}}`. La cola procesa un trabajo a la vez y conserva sus originales, resultados y configuración de ejecución. Permite unión ordenada de textos, pausa, cancelación y reintento explícito.
- Los resultados de IA se identifican y pueden compararse con el original. La copia automática respeta cambios posteriores del portapapeles; los resultados permanecen disponibles aunque no se copien.
- El diccionario TSV se aplica manualmente, sin IA, y sustituye el texto de la entrada según las reglas documentadas en el README.

## Datos y privacidad

El historial, los prompts, los ajustes y los trabajos son locales. SQLite y las imágenes no están cifrados. La clave del proveedor se guarda separadamente en el almacén de credenciales de Windows y no se entrega al frontend. No hay cuentas, sincronización ni telemetría propia.

Solo se envía texto a IA por una acción del usuario, al destino configurado. Una URL remota implica envío a ese proveedor. No registrar contenidos, teclas ni credenciales. Respetar las marcas de exclusión del portapapeles y permitir pausar la captura; esas marcas no garantizan excluir todas las contraseñas.

## Alcance y cambios

El comportamiento actual y las instrucciones de uso se describen en [README](../README.md). Las funciones aprobadas pero pendientes se describen en sus CHG, sin presentarlas como entregadas. Actualmente Ctrl+Alt+V abre el widget; Win+V pertenece a Windows. CHG-001 propone una alternativa opcional, todavía pendiente de implementación y validación.

Todo cambio de código requiere un CHG aprobado y en desarrollo, con alcance y criterios de aceptación definidos. No ampliar el producto ni cambiar comportamientos ajenos a ese CHG. Preparar una versión local no autoriza publicarla ni modificar una instalación personal.
