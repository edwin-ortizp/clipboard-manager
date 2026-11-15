# Diseño de experiencia e interfaz

## Superficies y lenguaje

La administración permite trabajar con historial, prompts, cola y ajustes. El widget prioriza recuperar y pegar contenido rápidamente. Mantener textos en español, breves y orientados a la acción, con la marca visible Clipboard Manager.

La administración parte de 1100 × 760, con mínimo configurado de 700 × 520. El widget parte de 380 × 540 y ajusta su tamaño al área de trabajo disponible. Verificar los cambios en administración compacta y widget, sin desbordamientos ni acciones inaccesibles.

## Componentes y estilo

- Reutilizar `Thumbnail`, `AiChip`, `ClipMenu` y `TextComparison`, y los patrones existentes de tarjetas, ajustes, avisos y modales.
- Usar la tipografía Nunito incluida localmente y las variables de `src/style.css` para superficies, líneas, texto secundario y acento violeta. Conservar el soporte de temas claro y oscuro.
- Mantener la densidad y jerarquía actuales. Las tarjetas muestran resúmenes; el detalle debe permitir acceder al contenido completo.
- Los controles necesitan etiquetas comprensibles, foco visible y operación por teclado. Los botones de icono deben tener nombre accesible; los estados no deben depender solo del color.

## Interacción y confianza

Cerrar el widget con × o Escape no debe detener la aplicación. Conservar navegación por teclado, selección y unión ordenada, y el destino de pegado en la aplicación de origen. Las modificaciones de atajos deben explicar su efecto y sus límites.

Separar ajustes guardados del borrador. Mostrar validaciones y errores cerca del flujo afectado, conservar la entrada cuando falle una acción y reflejar operaciones en curso para evitar activaciones duplicadas. No anunciar éxito antes de la confirmación del backend.

Las acciones destructivas conservan sus confirmaciones y el tratamiento de favoritos. Los resultados de IA se identifican con su chip y permiten revisar el original y el resultado; copiar siempre entrega el texto final limpio. Las imágenes no ofrecen acciones de IA ni equivalencias de texto.

Explicar las consecuencias relevantes de privacidad, copia automática, inicio con Windows y actualizaciones con lenguaje de usuario. No introducir detalles internos que no ayuden a decidir. Las funciones previstas por un CHG solo se presentan como disponibles después de implementarse.

## Verificación visual

Para cambios de interfaz, comprobar tema claro y oscuro, teclado, foco, cierre de modales, textos largos y dimensiones compactas. Las pruebas de navegador verifican el frontend simulado; foco entre aplicaciones, pegado y atajos de Windows requieren validación nativa adicional.
