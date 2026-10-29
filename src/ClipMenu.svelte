<script lang="ts">
  let {
    textEntry,
    ondictionary,
    ondelete,
  }: { textEntry: boolean; ondictionary: () => void; ondelete: () => void } = $props();
  let panel: HTMLDivElement;
  let trigger: HTMLButtonElement;
  let opened = $state(false);
  function close() {
    panel.hidePopover();
  }
  function toggle() {
    if (panel.matches(':popover-open')) {
      close();
      return;
    }
    panel.showPopover();
    const box = trigger.getBoundingClientRect();
    const height = panel.offsetHeight;
    panel.style.left = `${Math.max(8, Math.min(innerWidth - 218, box.right - 210))}px`;
    panel.style.top = `${Math.max(8, box.bottom + height + 8 < innerHeight ? box.bottom + 4 : box.top - height - 4)}px`;
    panel.querySelector<HTMLButtonElement>('button')?.focus();
  }
  function keys(e: KeyboardEvent) {
    const items = [...panel.querySelectorAll<HTMLButtonElement>('button')];
    let index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      trigger.focus();
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      index =
        e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? items.length - 1
            : (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[index]?.focus();
    } else if (e.key === 'Tab') close();
  }
</script>

<button
  bind:this={trigger}
  class="icon"
  aria-label="Opciones de la entrada"
  title="Opciones"
  aria-haspopup="menu"
  aria-expanded={opened}
  onclick={toggle}>⋯</button
>
<div
  bind:this={panel}
  popover="auto"
  class="clip-menu"
  role="menu"
  aria-label="Acciones de la entrada"
  ontoggle={() => (opened = panel.matches(':popover-open'))}
  onkeydown={keys}
  tabindex="-1"
>
  {#if textEntry}<button
      role="menuitem"
      onclick={() => {
        close();
        ondictionary();
      }}>Aplicar equivalencias</button
    >{/if}
  <button
    role="menuitem"
    class="danger-text"
    onclick={() => {
      close();
      ondelete();
    }}>Eliminar entrada</button
  >
</div>
