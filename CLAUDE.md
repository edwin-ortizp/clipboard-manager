<!-- team:start -->
## Cómo trabaja este repo (equipo de skills)
- Lineamientos: `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/UX-DESIGN.md`, `docs/UI-DESIGN.md`, `docs/UX-WRITING.md`, `docs/TESTING.md`, `docs/DOCUMENTATION.md`. Respétalos siempre.
- Hallazgos por rol: `docs/backlog/*.md`. Cambios a implementar: `docs/backlog/{to-do,in-progress,done,archived}/CHG-NNN-*/CHANGE.md`.
- Punto de entrada para el usuario: la skill `team` (Claude Code: `/team` · Codex: `$team`) elige el rol.
- Todo cambio de código pasa por un CHG aprobado: la skill `team` lo especifica y `developer` lo implementa (Claude Code: `/nombre` · Codex: `$nombre` · Gemini: pide usar la skill por su nombre).
- Estados y numeración SOLO con `node .claude/team.mjs` (`help` para ver todo). `loop` y `critique` son opcionales y solo los inicia el usuario. Modelos por perfil: `docs/TEAM_MODELS.md`.
- Regla para cualquier agente: no edites archivos fuera de `docs/` si no hay un CHG "En desarrollo" (`node .claude/team.mjs status`). En Claude Code lo impone un hook (`.claude/hooks/team-guard.mjs`); donde no hay hook (Cowork, Codex, Gemini) ejecuta `node .claude/team.mjs status` antes de editar fuera de `docs/` y, sin un CHG En desarrollo, no edites. Nunca la desactives sin permiso del usuario.
- Si el perfil dice `workspace: cowork` (`node .claude/team.mjs profile --json`), la persona no tiene terminal: nunca le pidas ejecutar comandos; hazlo tú o indícale el botón del panel (`team ui`).
<!-- team:end -->
