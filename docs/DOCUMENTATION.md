# Documentación y trazabilidad

## Fuentes y responsabilidades

| Documento | Contenido |
| --- | --- |
| [PRODUCT.md](PRODUCT.md) | Propósito, flujos y límites del producto |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Responsabilidades técnicas y contratos que se deben preservar |
| [UX-DESIGN.md](UX-DESIGN.md) | Patrones de interacción y verificación visual |
| [TESTING.md](TESTING.md) | Comandos, aislamiento, aceptación y evidencia |
| [README](../README.md) | Uso, configuración, privacidad y desarrollo |
| [VALIDACION.md](../VALIDACION.md) | Resultados de una entrega concreta y comprobaciones pendientes |
| [RELEASES.md](../RELEASES.md), [CHANGELOG.md](../CHANGELOG.md) | Distribución y actualizaciones; cambios por versión |
| `docs/backlog/` | Hallazgos por rol y especificaciones, tareas y decisiones de cada CHG |

Estos lineamientos se han establecido a partir del código y documentación disponibles el 2026-11-03. No constituyen una nueva ejecución de las pruebas ni una confirmación del estado público del canal de actualizaciones.

## Cómo escribir y mantener

Escribir en español, con lenguaje simple y rutas y comandos exactos. Explicar primero el efecto para el usuario y después el detalle técnico necesario. Usar enlaces relativos y evitar duplicar instrucciones extensas: enlazar a su fuente y actualizarla cuando cambie el comportamiento.

Distinguir comportamiento implementado, propuesta aprobada, evidencia histórica y comprobación pendiente. No presentar una compilación como validación funcional, una prueba simulada como validación nativa ni un artefacto local como una publicación. No registrar secretos ni contenido personal en ejemplos, capturas o bitácoras.

Actualizar la documentación afectada dentro del alcance del CHG. Si necesita archivos no previstos, registrar la desviación y resolverla antes de ampliar la implementación. Una corrección documental no debe cambiar por sí sola el alcance o aceptación de un CHG aprobado.

## Flujo del equipo

- Seguir `AGENTS.md` y la skill invocada. Código solo con un CHG aprobado y en desarrollo; las instrucciones explícitas del usuario rigen las excepciones autorizadas.
- Localizar el cambio por ID en `docs/backlog/to-do/` o `in-progress/`. Implementar las tareas aprobadas, sin incluir mejoras ajenas.
- Cambiar estados y numeración únicamente con `node .claude/team.mjs`; consultar `help` para el uso. No mover carpetas ni editar estados manualmente. `TEAM_PLAN.md` es generado y no se edita a mano.
- En §7 marcar tareas realmente completadas; en §8 registrar cambios y verificaciones; en §9 registrar decisiones, dudas y desviaciones. No marcar criterios que requieran validación pendiente.
- Respetar los responsables del CHG. La implementación, la verificación QA y el cierre son etapas distintas; no atribuir revisiones a roles que no participaron.
- `loop` y `critique` solo se inician por instrucción del usuario. Consultar `TEAM_MODELS.md` para los perfiles, sin inventar un proveedor cuando la tabla esté vacía.

La preparación local no autoriza commits, push, publicación, despliegues ni cambios en instalaciones personales. La publicación requiere autorización explícita y el procedimiento de `RELEASES.md`.
