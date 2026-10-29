<script lang="ts">
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  let { id }: { id: number } = $props();
  let host: HTMLSpanElement;
  let url = $state('');
  let failed = $state(false);
  onMount(() => {
    let disposed = false;
    const observer = new IntersectionObserver(
      async (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        try {
          const data = await invoke<string>('clip_image', { id, thumbnail: true });
          if (!disposed) url = data;
        } catch {
          if (!disposed) failed = true;
        }
      },
      { rootMargin: '120px' },
    );
    observer.observe(host);
    return () => {
      disposed = true;
      observer.disconnect();
    };
  });
</script>

<span bind:this={host} class="thumbnail">
  {#if url}<img src={url} alt="Vista previa de la imagen" />{:else}<span
      >{failed ? 'Imagen no disponible' : 'Cargando imagen…'}</span
    >{/if}
</span>
