# Diagnóstico de Win+V instalado — 2026-11-03

## Evidencia confirmada

- Windows 11 build 26300; aplicación y ventana de prueba con integridad media. Ajuste `win_v=true` persistido.
- El usuario informó funcionamiento en una prueba inicial y fallos posteriores, incluidos el instalador y las candidatas aisladas. No se considera aceptado el comportamiento instalado.
- Una V sintética llega al hook. Al escribir físicamente `vvv` en el buscador, el campo contiene las tres letras y la sonda confirma recepción de V.
- En pruebas de Win+V, nuestra sonda no recibió V. En la comparación independiente, dos hooks Win32 de paso, uno con módulo nulo y otro con módulo EXE, recibieron eventos físicos de Win pero tampoco V. Ambos terminaron con flags `523`; nuestra sonda, con `11`. No son registros de texto ni de secuencias de teclas.
- La comparación independiente no usa Rust, Tauri, sus ventanas ni su lógica de reconocimiento. Su código solo observa y llama al siguiente hook. Evidencia: `artifacts/winv-native-baseline.json`.
- El usuario reportó el mismo resultado durante las pruebas de pausa de PowerToys y del agente principal de Options+. No permiten excluir todos los componentes: CmdPal MSIX y el broker de Logitech permanecieron activos. No hay causa única confirmada.

## Estado tras las pruebas

PowerToys y el agente de Logitech están restaurados, sin edición de preferencias. Las sondas Win32 retiraron sus hooks automáticamente y se cerraron nuestras instancias aisladas. Se retiraron del código el comando temporal `win_v_probe` y los flags de instrumentación. Se conservan los artefactos de diagnóstico; no se publicaron ni instalaron nuevas candidatas.

La suite interna puede comprobar decisiones y persistencia, pero no demuestra que Windows entregue esta combinación al callback. El fallo real permanece abierto. No atribuirlo definitivamente al sistema operativo, Logitech, PowerToys o una conexión remota.

## Cambio de estrategia que requiere aprobación

El §4 aprobado intercepta únicamente V después de recibirla con Win activo. La evidencia muestra que esa suposición no se cumple de forma fiable en las pruebas del equipo.

1. **Prototipo de captura del prefijo Win:** interceptar Win antes de entregar su pulsación al sistema y comprobar si entonces llega V. Si funciona, diseñar y probar la reproducción de las demás combinaciones y de Win solo. Mantener el retorno al comportamiento nativo al salir. Primero demostrar viabilidad; no dar por garantizado el resultado ni convertir el prototipo en un remapeador general sin revisar el CHG.
2. **Liberar Win+V de Explorer:** revisar el alcance para modificar la reserva por usuario (`DisabledHotkeys`) y registrar el atajo normalmente. Requiere preservar los valores existentes y refrescar Explorer. Cambia el requisito de retorno automático: si la aplicación no está ejecutándose, Win+V no abre el panel nativo mientras la reserva siga liberada. Esta opción había sido descartada por el usuario y no se ejecutará sin nueva aprobación.

Ctrl+Alt+V se mantiene como alternativa existente. Ninguna de estas propuestas se ha implementado ni autorizado todavía.
