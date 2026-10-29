<script lang="ts">
  import { onMount } from 'svelte';
  import { diffWordsWithSpace, type Change } from 'diff';
  let {
    original,
    result,
    compact = false,
  }: { original: string; result: string; compact?: boolean } = $props();
  let view = $state('changes');
  let changes = $state<Change[] | null>(null);
  let simplified = $state(false);
  onMount(() => {
    let disposed = false;
    diffWordsWithSpace(original, result, {
      timeout: 250,
      callback(value) {
        if (disposed) return;
        if (value) {
          changes = value;
        } else {
          simplified = true;
          changes = [
            { value: original, removed: true, added: false, count: 1 },
            { value: result, added: true, removed: false, count: 1 },
          ];
        }
      },
    });
    return () => {
      disposed = true;
    };
  });
</script>

<div class="comparison-controls" role="group" aria-label="Vista de comparación">
  {#each [['changes', 'Cambios'], ['original', 'Original'], ['result', 'Resultado'], ...(!compact ? [['columns', 'Dos columnas']] : [])] as [value, label]}
    <button
      class:active={view === value}
      aria-pressed={view === value}
      onclick={() => (view = value)}>{label}</button
    >
  {/each}
</div>
{#if view === 'changes'}
  <div class="diff-legend">
    <span class="legend-removed">− Eliminado</span><span class="legend-added">+ Añadido</span>
  </div>
  {#if original === result}<p class="muted">
      No hay diferencias: la IA devolvió el mismo texto.
    </p>{/if}
  {#if simplified}<p class="muted">
      Los textos tienen muchos cambios. Se muestra una comparación por bloques.
    </p>{/if}
  {#if changes}<div class="diff-text" aria-label="Diferencias entre original y resultado">
      {#each changes as part}{#if part.added}<ins aria-label="Texto añadido">{part.value}</ins
          >{:else if part.removed}<del aria-label="Texto eliminado">{part.value}</del
          >{:else}{part.value}{/if}{/each}
    </div>{:else}<p role="status" class="muted">Calculando diferencias…</p>{/if}
{:else if view === 'columns'}
  <div class="diff-columns">
    <section>
      <h3>Original</h3>
      <pre>{original}</pre>
    </section>
    <section>
      <h3>Resultado</h3>
      <pre>{result}</pre>
    </section>
  </div>
{:else}<pre class="comparison-plain">{view === 'original' ? original : result}</pre>{/if}
