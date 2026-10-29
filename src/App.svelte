<script lang="ts">
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import type { Clip, Prompt, Settings, Job, Snapshot } from './types';
  import Thumbnail from './Thumbnail.svelte';
  import AiChip from './AiChip.svelte';
  import ClipMenu from './ClipMenu.svelte';
  import TextComparison from './TextComparison.svelte';
  import { version } from '../package.json';
  const widget = new URLSearchParams(location.search).has('widget');
  const desktop = '__TAURI_INTERNALS__' in window;
  let page = $state('history');
  let clips = $state<Clip[]>([]);
  let prompts = $state<Prompt[]>([]);
  let jobs = $state<Job[]>([]);
  let settings = $state<Settings>({
    base_url: 'http://127.0.0.1:1234/v1',
    model: '',
    limit: 1000,
    shortcut: 'Ctrl+Alt+V',
    paused: false,
    autostart: false,
    auto_copy: true,
    notifications: true,
    mappings_path: '',
  });
  let draft = $state<Settings>({
    base_url: 'http://127.0.0.1:1234/v1',
    model: '',
    limit: 1000,
    shortcut: 'Ctrl+Alt+V',
    paused: false,
    autostart: false,
    auto_copy: true,
    notifications: true,
    mappings_path: '',
  });
  let key = $state('');
  let changeKey = $state(false);
  let hasKey = $state(false);
  let queuePaused = $state(false);
  let query = $state('');
  let favorites = $state(false);
  let selection = $state<number[]>([]);
  let detail = $state<{
    text: string;
    title: string;
    image?: string;
    id?: number;
    original?: string;
    ai?: boolean;
    missingOriginal?: boolean;
  } | null>(null);
  let editor = $state<Prompt | null>(null);
  let promptId = $state(0);
  let joining = $state(false);
  let joined = $state<{ id: number; text: string }[]>([]);
  let error = $state('');
  let notice = $state('');
  let startupError = $state('');
  let busy = $state(false);
  let more = $state(false);
  let mappingsStatus = $state('');
  let mappingsBusy = $state(false);
  async function checkMappings() {
    mappingsBusy = true;
    mappingsStatus = 'Comprobando archivo…';
    try {
      const s = await invoke<{ rules: number }>('check_mappings', { path: draft.mappings_path });
      mappingsStatus = `Archivo válido · ${s.rules} equivalencias`;
    } catch (e) {
      mappingsStatus = String(e);
      throw e;
    } finally {
      mappingsBusy = false;
    }
  }
  async function chooseMappings() {
    const path = await invoke<string | null>('choose_mappings');
    if (path) {
      draft.mappings_path = path;
      await checkMappings();
    }
  }
  async function applyMappings(id: number) {
    const result = await invoke<{ id: number; changes: number; message: string }>(
      'apply_mappings',
      { id },
    );
    selection = selection.filter((n) => n !== id);
    await refresh();
    message(result.message);
  }
  let models = $state<string[]>([]);
  let clearConfirm = $state(false);
  let deletePromptConfirm = $state(false);
  let historyList = $state<HTMLDivElement>();
  let searchInput = $state<HTMLInputElement>();
  let requestVersion = 0;
  let noticeTimer: ReturnType<typeof setTimeout>;
  let lastDelivery = $state('');
  let availableUpdate = $state<{ version: string; notes: string } | null>(null);
  let updateBusy = $state(false);
  let updateStatus = $state('');
  let updateProgress = $state(0);
  async function checkUpdates() {
    updateBusy = true;
    updateStatus = 'Buscando actualizaciones…';
    try {
      availableUpdate = await invoke('check_update');
      updateStatus = availableUpdate
        ? `Versión ${availableUpdate.version} disponible`
        : 'Tienes la última versión';
    } finally {
      updateBusy = false;
    }
  }
  async function installUpdate() {
    if (!availableUpdate) return;
    if (editor || joining || JSON.stringify(draft) !== JSON.stringify(settings) || changeKey) {
      throw 'Guarda o descarta los cambios pendientes antes de actualizar';
    }
    if (jobs.some((j) => j.status === 'running'))
      throw 'Espera a que termine el trabajo activo o cancélalo antes de actualizar';
    updateBusy = true;
    updateProgress = 0;
    updateStatus = 'Descargando y verificando firma…';
    try {
      await invoke('install_update', { expectedVersion: availableUpdate.version });
    } finally {
      updateBusy = false;
    }
  }
  function focusDialog(node: HTMLElement) {
    const previous = document.activeElement as HTMLElement | null;
    node.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = [
        ...node.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input, textarea, select, [tabindex="0"]',
        ),
      ];
      const first = items[0],
        last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === node)) {
        e.preventDefault();
        last?.focus();
      } else if (
        !e.shiftKey &&
        (document.activeElement === last || document.activeElement === node)
      ) {
        e.preventDefault();
        first?.focus();
      }
    };
    node.addEventListener('keydown', trap);
    return {
      destroy() {
        node.removeEventListener('keydown', trap);
        previous?.focus();
      },
    };
  }
  const states: Record<string, string> = {
    pending: 'Pendiente',
    running: 'Procesando',
    completed: 'Completado',
    failed: 'Fallido',
    cancelled: 'Cancelado',
  };
  const pending = $derived(jobs.filter((j) => ['pending', 'running'].includes(j.status)).length);
  const chosen = $derived(prompts.find((p) => p.id === Number(promptId)));
  function message(text: string) {
    notice = text;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice = ''), 3500);
  }
  async function run(fn: () => Promise<void>) {
    error = '';
    try {
      await fn();
    } catch (e) {
      error = String(e);
    }
  }
  async function refresh() {
    if (!desktop) return;
    const s = await invoke<Snapshot>('snapshot');
    settings = s.settings;
    prompts = s.prompts;
    jobs = s.jobs;
    queuePaused = s.queue_paused;
    hasKey = s.has_key;
    startupError = s.startup_error ?? '';
    lastDelivery = s.last_delivery ?? '';
    if (!prompts.some((p) => p.id === Number(promptId)))
      promptId = prompts.find((p) => p.favorite)?.id ?? prompts[0]?.id ?? 0;
    await load();
  }
  async function load(append = false) {
    if (!desktop) return;
    const version = ++requestVersion;
    const rows = await invoke<Clip[]>('list_clips', {
      query,
      favorite: favorites,
      offset: append ? clips.length : 0,
    });
    if (version !== requestVersion) return;
    clips = append ? [...clips, ...rows] : rows;
    more = rows.length === 50;
  }
  function navigate(next: string) {
    page = next;
    error = '';
    if (next === 'settings') {
      draft = { ...settings };
      key = '';
      changeKey = false;
    }
  }
  async function text(id: number) {
    return invoke<string>('clip_text', { id });
  }
  async function copy(value: string) {
    await invoke('copy_text', { text: value });
    message('Copiado al portapapeles');
  }
  function toggle(id: number) {
    selection = selection.includes(id) ? selection.filter((n) => n !== id) : [...selection, id];
  }
  async function preview(c: Clip) {
    if (c.origin === 'ai') {
      await compareClip(c.id);
      return;
    }
    detail =
      c.kind === 'image'
        ? {
            text: '',
            title: `Imagen · ${c.width} × ${c.height}`,
            image: await invoke<string>('clip_image', { id: c.id, thumbnail: false }),
            id: c.id,
          }
        : {
            text: await text(c.id),
            title: c.origin === 'dictionary' ? 'Texto corregido' : 'Texto original',
          };
  }
  async function compareClip(id: number) {
    const value = await invoke<{
      original: string | null;
      result: string;
      prompt_name: string | null;
    }>('clip_comparison', { id });
    detail = {
      text: value.result,
      title: 'Comparar cambios',
      original: value.original ?? undefined,
      ai: true,
      missingOriginal: value.original === null,
    };
  }
  function compareJob(job: Job) {
    detail = { text: job.output ?? '', original: job.input, title: 'Comparar cambios', ai: true };
  }
  async function copyClip(id: number) {
    await invoke('copy_clip', { id });
    message('Copiado al portapapeles');
  }
  async function action(id: number, action: string) {
    await invoke('update_clip', { id, action });
    if (action === 'delete') selection = selection.filter((n) => n !== id);
    await refresh();
  }
  async function prepareJoin() {
    joined = await Promise.all(selection.map(async (id) => ({ id, text: await text(id) })));
    joining = true;
  }
  function move(index: number, direction: number) {
    const other = index + direction;
    if (other < 0 || other >= joined.length) return;
    const list = [...joined];
    [list[index], list[other]] = [list[other], list[index]];
    joined = list;
  }
  async function enqueue(join = false) {
    await invoke('enqueue', {
      ids: join ? joined.map((c) => c.id) : selection,
      promptId: Number(promptId),
      join,
    });
    joining = false;
    selection = [];
    await refresh();
    message(queuePaused ? 'Añadido. Reanuda la cola para procesar.' : 'Añadido a la cola');
  }
  async function saveSettings() {
    busy = true;
    try {
      await invoke('save_settings', { settings: draft, key: changeKey ? key : null });
      key = '';
      changeKey = false;
      await refresh();
      draft = { ...settings };
      message('Ajustes guardados');
    } finally {
      busy = false;
    }
  }
  async function providerTest() {
    busy = true;
    try {
      message(
        await invoke<string>('test_provider', { baseUrl: draft.base_url, model: draft.model }),
      );
    } finally {
      busy = false;
    }
  }
  async function getModels() {
    busy = true;
    try {
      models = await invoke<string[]>('models', { baseUrl: draft.base_url });
      message(`${models.length} modelos disponibles`);
    } finally {
      busy = false;
    }
  }
  async function savePrompt() {
    if (!editor) return;
    await invoke('save_prompt', { prompt: editor });
    editor = null;
    await refresh();
    message('Prompt guardado');
  }
  async function queueAction(job: Job, action: string) {
    await invoke('job_action', { id: job.id, action });
    await refresh();
  }
  function keyboard(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (document.querySelector('[popover]:popover-open')) return;
      if (detail) detail = null;
      else if (editor) editor = null;
      else if (joining) joining = false;
      else if (clearConfirm) clearConfirm = false;
      else if (widget) void invoke('hide_widget');
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      searchInput?.focus();
    }
    if (
      (e.key === 'ArrowDown' || e.key === 'ArrowUp') &&
      !detail &&
      !editor &&
      !joining &&
      page === 'history' &&
      !(e.target instanceof HTMLSelectElement) &&
      !(e.target instanceof HTMLTextAreaElement)
    ) {
      const nodes = [...(historyList?.querySelectorAll<HTMLButtonElement>('.clip-open') ?? [])];
      if (!nodes.length) return;
      const index = nodes.indexOf(document.activeElement as HTMLButtonElement);
      e.preventDefault();
      nodes[
        Math.max(0, Math.min(nodes.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)))
      ]?.focus();
    }
  }
  onMount(() => {
    if (!desktop) {
      error = 'Esta vista requiere la aplicación de escritorio. Inicia con npm run tauri dev.';
      return;
    }
    let disposed = false;
    let stops: (() => void)[] = [];
    void run(async () => {
      await refresh();
      draft = { ...settings };
      const subscriptions = await Promise.all([
        listen('changed', () => void run(refresh)),
        listen<string>('delivery', (event) => {
          lastDelivery = event.payload;
          message(event.payload);
        }),
        listen<{ received: number; total?: number }>('update-progress', (event) => {
          updateProgress = event.payload.total
            ? Math.round((event.payload.received / event.payload.total) * 100)
            : 0;
        }),
        listen('update-installing', () => {
          updateStatus = 'Instalando actualización…';
        }),
        listen('opened', () => {
          searchInput?.focus();
          if (widget) void invoke('widget_ready');
          void run(refresh);
        }),
      ]);
      if (disposed) subscriptions.forEach((stop) => stop());
      else stops = subscriptions;
      if (widget) {
        searchInput?.focus();
        await invoke('widget_ready');
      }
    });
    return () => {
      disposed = true;
      stops.forEach((stop) => stop());
      clearTimeout(noticeTimer);
    };
  });
</script>

<svelte:window onkeydown={keyboard} />

<div class:widget class="app-shell">
  {#if !widget}
    <aside class="sidebar">
      <a class="brand" href="#history" onclick={() => navigate('history')}
        ><span class="brand-icon">▤</span> Clipia<span class="version">v{version}</span></a
      >
      <div class="sidebar-caption">TU ESPACIO DE TEXTO</div>
      <nav aria-label="Principal">
        <button class:active={page === 'history'} onclick={() => navigate('history')}
          ><span>▤</span> Portapapeles</button
        >
        <button class:active={page === 'prompts'} onclick={() => navigate('prompts')}
          ><span>✧</span> Biblioteca de prompts</button
        >
        <button class:active={page === 'queue'} onclick={() => navigate('queue')}
          ><span>≋</span> Cola de IA {#if pending}<b class="badge">{pending}</b>{/if}</button
        >
        <button class:active={page === 'settings'} onclick={() => navigate('settings')}
          ><span>⚙</span> Ajustes</button
        >
      </nav>
      <div class="sidebar-bottom">
        <span class:paused={settings.paused} class="capture-dot"></span>{settings.paused
          ? 'Captura pausada'
          : 'Capturando en este equipo'}<kbd>{settings.shortcut}</kbd><small
          >Local. A tu ritmo.</small
        >
      </div>
    </aside>
  {/if}
  <main>
    <header class="page-header">
      <div>
        <div class="eyebrow">{widget ? 'CLIPIA' : 'PORTAPAPELES + IA LOCAL'}</div>
        <h1>
          {page === 'history'
            ? 'Tu portapapeles'
            : page === 'prompts'
              ? 'Biblioteca de prompts'
              : page === 'queue'
                ? 'Cola de IA'
                : 'Ajustes'}
        </h1>
        {#if !widget}<p>
            {page === 'history'
              ? 'Recupera una idea. Dale una nueva forma.'
              : page === 'prompts'
                ? 'Tus instrucciones, listas para cada texto.'
                : page === 'queue'
                  ? 'Cada texto tiene su turno. Tú eliges qué copiar.'
                  : 'Una conexión local, a tu medida.'}
          </p>{/if}
      </div>
      {#if widget}<div class="header-actions">
          <button
            class="icon"
            title="Cola de IA"
            aria-label="Cola de IA"
            onclick={() => navigate(page === 'queue' ? 'history' : 'queue')}
            >≋{#if pending}<span class="tiny-dot"></span>{/if}</button
          ><button
            class="icon"
            title="Abrir administración"
            aria-label="Abrir administración"
            onclick={() =>
              run(async () => {
                await invoke('open_manager');
              })}>↗</button
          >
        </div>
      {:else if page === 'history'}<button
          class="secondary"
          onclick={() =>
            run(async () => {
              await invoke('save_settings', {
                settings: { ...settings, paused: !settings.paused },
                key: null,
              });
              await refresh();
            })}>{settings.paused ? '▶ Reanudar captura' : 'Ⅱ Pausar captura'}</button
        >
      {:else if page === 'prompts'}<button
          class="primary"
          onclick={() => {
            editor = {
              id: 0,
              name: '',
              instructions: 'Devuelve únicamente el texto resultante.\n\n{{text}}',
              favorite: false,
              position: prompts.length,
            };
          }}>+ Nuevo prompt</button
        >{/if}
    </header>
    {#if !desktop}<div class="banner">
        Vista de navegador · sin acceso al portapapeles del sistema
      </div>{/if}
    {#if startupError}<div class="banner error">{startupError}</div>{/if}
    {#if error}<div role="alert" class="banner error">
        <span>{error}</span><button
          aria-label="Cerrar error"
          class="icon"
          onclick={() => (error = '')}>×</button
        >
      </div>{/if}
    {#if notice}<div role="status" class="toast">✓ {notice}</div>{/if}

    {#if page === 'history'}
      <div class="history-tools">
        <label class="search"
          ><span>⌕</span><input
            bind:this={searchInput}
            bind:value={query}
            oninput={() => run(() => load())}
            placeholder="Buscar en tu historial…"
            aria-label="Buscar en el historial"
          /><kbd>Ctrl F</kbd></label
        >
        <div class="filter-row">
          <div class="tabs">
            <button
              class:active={!favorites}
              onclick={() => {
                favorites = false;
                void run(() => load());
              }}>Historial</button
            ><button
              class:active={favorites}
              onclick={() => {
                favorites = true;
                void run(() => load());
              }}>☆ Favoritos</button
            >
          </div>
          <button
            class="quiet"
            title="Limpiar historial excepto favoritos"
            onclick={() => (clearConfirm = true)}>{widget ? 'Limpiar' : 'Limpiar historial'}</button
          >
        </div>
      </div>
      {#if lastDelivery}<div class="delivery-summary" role="status">✧ {lastDelivery}</div>{/if}
      <div class="history-list" bind:this={historyList}>
        {#if clips.length === 0}<div class="empty">
            <span class="empty-icon">▤</span>
            <h2>
              {query
                ? 'Sin coincidencias'
                : favorites
                  ? 'Tus textos de siempre'
                  : 'Todo empieza con una copia'}
            </h2>
            <p>
              {query
                ? 'Prueba con otra palabra.'
                : favorites
                  ? 'Marca un texto con la estrella para tenerlo a mano.'
                  : 'Copia un texto o una imagen. Aparecerá aquí.'}
            </p>
            {#if settings.paused}<small>La captura está pausada.</small>{/if}
          </div>{/if}
        {#each clips as clip (clip.id)}
          <article class:selected={selection.includes(clip.id)} class="clip-card">
            <div class="clip-content">
              {#if clip.kind !== 'image'}
                <input
                  class="clip-select"
                  type="checkbox"
                  checked={selection.includes(clip.id)}
                  onchange={() => toggle(clip.id)}
                  aria-label="Seleccionar texto"
                />
              {/if}
              <button
                class="clip-open"
                class:image-open={clip.kind === 'image'}
                onclick={() => run(() => preview(clip))}
              >
                {#if clip.kind === 'image'}<Thumbnail id={clip.id} />{:else}{clip.text}{/if}
              </button>
            </div>
            <div class="clip-footer">
              <time title={new Date(clip.created).toLocaleString('es')}
                >{new Date(clip.created).toLocaleTimeString('es', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}</time
              >
              {#if clip.origin === 'ai'}<AiChip />{:else if clip.kind === 'image'}<span
                  class="image-size">{clip.width} × {clip.height}</span
                >{:else if clip.origin === 'dictionary'}<span class="dictionary-chip"
                  >Diccionario</span
                >{/if}
              <button
                class:starred={clip.favorite}
                class="icon star"
                title={clip.favorite ? 'Quitar favorito' : 'Marcar favorito'}
                aria-label={clip.favorite ? 'Quitar favorito' : 'Marcar favorito'}
                onclick={() => run(() => action(clip.id, 'favorite'))}
                >{clip.favorite ? '★' : '☆'}</button
              >
              <button class="quiet" onclick={() => run(() => copyClip(clip.id))}>Copiar</button>
              {#if clip.origin === 'ai'}<button
                  class="quiet ai-action"
                  onclick={() => run(() => compareClip(clip.id))}>Ver cambios</button
                >
              {:else if clip.kind !== 'image'}<button
                  class="quiet ai-action"
                  onclick={() => {
                    selection = [clip.id];
                  }}>✧ Transformar</button
                >{/if}
              <ClipMenu
                textEntry={clip.kind !== 'image'}
                ondictionary={() => {
                  void run(() => applyMappings(clip.id));
                }}
                ondelete={() => {
                  void run(() => action(clip.id, 'delete'));
                }}
              />
            </div>
          </article>
        {/each}
        {#if more}<button class="secondary load-more" onclick={() => run(() => load(true))}
            >Cargar más</button
          >{/if}
      </div>
      {#if selection.length}<div class="selection-bar">
          <div class="selection-title">
            <strong
              >{selection.length}
              {selection.length === 1 ? 'texto seleccionado' : 'textos seleccionados'}</strong
            ><button class="quiet" onclick={() => (selection = [])}>Cancelar</button>
          </div>
          <select bind:value={promptId} aria-label="Prompt para los textos seleccionados"
            >{#each prompts as p}<option value={p.id}>{p.favorite ? '★ ' : ''}{p.name}</option
              >{/each}</select
          >
          <div class="selection-buttons">
            <button class="primary" disabled={!promptId} onclick={() => run(() => enqueue())}
              >✧ {selection.length > 1 ? 'Procesar por separado' : 'Aplicar prompt'}</button
            >{#if selection.length > 1}<button class="secondary" onclick={() => run(prepareJoin)}
                >Unir…</button
              >{/if}
          </div>
        </div>{:else}<footer class="history-hint">
          <span class:paused={settings.paused} class="capture-dot"></span>{settings.paused
            ? 'Captura pausada'
            : 'Solo en este equipo'}<span>↑ ↓ navegar · Enter abrir</span>
        </footer>{/if}
    {:else if page === 'prompts'}
      <div class="content-scroll">
        <div class="info-line">✧ Selecciona un texto en el historial para aplicar un prompt.</div>
        <div class="prompt-grid">
          {#each prompts as p}<button
              class="prompt-card"
              onclick={() => {
                editor = { ...p };
                deletePromptConfirm = false;
              }}
              ><div class="prompt-top">
                <span class="prompt-symbol">✧</span><span
                  >{p.favorite ? '★ Favorito' : `Orden ${p.position}`}</span
                >
              </div>
              <h2>{p.name}</h2>
              <p>{p.instructions.replace('{{text}}', '[Tu texto]')}</p>
              <span class="edit-link">Editar instrucciones ↗</span></button
            >{/each}
        </div>
      </div>
    {:else if page === 'queue'}
      <div class="queue-toolbar">
        <span
          ><span class:paused={queuePaused} class="capture-dot"></span>{queuePaused
            ? 'Cola pausada'
            : 'Un trabajo a la vez'} · {pending} pendientes</span
        ><button
          class="secondary"
          onclick={() =>
            run(async () => {
              await invoke('queue_control', { paused: !queuePaused });
              await refresh();
            })}>{queuePaused ? '▶ Reanudar' : 'Ⅱ Pausar'}</button
        >
      </div>
      <div class="content-scroll queue-list">
        {#if !jobs.length}<div class="empty">
            <span class="empty-icon">✧</span>
            <h2>Una nueva forma para tus ideas</h2>
            <p>
              Selecciona un texto del historial y aplica un prompt. Podrás revisar el resultado
              aquí.
            </p>
          </div>{/if}{#each jobs as job}<article class="job-card">
            <div class="job-top">
              <h2>
                {job.prompt_name}
                {#if job.output !== null}<AiChip />{/if}
              </h2>
              <span class="status {job.status}">{states[job.status]}</span>
            </div>
            <div class="comparison">
              <div>
                <span class="field-caption">ORIGINAL</span>
                <p>{job.input}</p>
              </div>
              {#if job.output !== null}<div class="result">
                  <span class="field-caption">RESULTADO</span>
                  <p>{job.output}</p>
                </div>{/if}
            </div>
            {#if job.error}<div class="job-error">{job.error}</div>{/if}
            <div class="job-actions">
              <time>{new Date(job.created).toLocaleString('es')}</time
              >{#if job.status === 'completed'}<button
                  class="secondary"
                  onclick={() => compareJob(job)}>Ver cambios</button
                ><button
                  class="secondary"
                  onclick={() => (detail = { text: job.input, title: 'Texto original' })}
                  >Ver original</button
                ><button
                  class="secondary"
                  onclick={() =>
                    (detail = { text: job.output ?? '', title: 'Resultado de IA', ai: true })}
                  >Ver resultado</button
                ><button class="primary" onclick={() => run(() => copy(job.output ?? ''))}
                  >Copiar resultado</button
                >{:else if ['pending', 'running'].includes(job.status)}<button
                  class="quiet"
                  onclick={() => run(() => queueAction(job, 'cancel'))}>Cancelar</button
                >{:else}<button
                  class="secondary"
                  onclick={() => run(() => queueAction(job, 'retry'))}>Reintentar</button
                >{/if}
            </div>
          </article>{/each}{#if jobs.length === 200}<p class="muted">
            Mostrando los últimos 200 trabajos.
          </p>{/if}
      </div>
    {:else}
      <div class="content-scroll settings-content">
        <section class="settings-section">
          <div class="section-heading">
            <span class="prompt-symbol">✧</span>
            <div>
              <h2>Proveedor de IA</h2>
              <p>Conecta tu servidor compatible con OpenAI.</p>
            </div>
            <span class="local-tag">LOCAL / PERSONALIZADO</span>
          </div>
          <label
            >URL base<input
              bind:value={draft.base_url}
              placeholder="http://127.0.0.1:1234/v1"
            /></label
          ><small
            >Incluye /v1 si tu servidor lo requiere. Las peticiones salen únicamente al ejecutar una
            acción o probar la conexión.</small
          ><label
            >Modelo
            <div class="inline">
              <input
                bind:value={draft.model}
                list="model-list"
                placeholder="Identificador del modelo"
              /><button class="secondary" disabled={busy} onclick={() => run(getModels)}
                >Consultar modelos</button
              >
            </div></label
          ><datalist id="model-list"
            >{#each models as model}<option value={model}></option>{/each}</datalist
          ><label class="checkbox-label"
            ><input type="checkbox" bind:checked={changeKey} />{hasKey
              ? 'Cambiar o eliminar la clave guardada'
              : 'Configurar una clave API (opcional)'}</label
          >{#if changeKey}<label
              >Clave API<input
                type="password"
                bind:value={key}
                autocomplete="new-password"
                placeholder="Vacío para eliminar la clave"
              /></label
            >{/if}<small
            >La clave se guarda en el almacén de credenciales de Windows. Guarda los ajustes antes
            de probar una clave nueva.</small
          >
          <div class="section-actions">
            <button class="secondary" disabled={busy} onclick={() => run(providerTest)}
              >{busy ? 'Conectando…' : 'Probar conexión y generación'}</button
            >
          </div>
        </section>
        <section class="settings-section">
          <h2>Historial y escritorio</h2>
          <div class="settings-grid">
            <label
              >Entradas normales conservadas<input
                type="number"
                min="1"
                max="100000"
                bind:value={draft.limit}
              /></label
            ><label
              >Atajo del widget<input bind:value={draft.shortcut} placeholder="Ctrl+Alt+V" /></label
            >
          </div>
          <small
            >Los favoritos nunca se eliminan por el límite. Win+V sigue perteneciendo a Windows.</small
          ><label class="checkbox-label"
            ><input type="checkbox" bind:checked={draft.autostart} />Iniciar con Windows en segundo
            plano</label
          ><label class="checkbox-label"
            ><input type="checkbox" bind:checked={draft.paused} />Pausar la captura del portapapeles</label
          >
        </section>
        <section class="settings-section">
          <h2>Diccionario de equivalencias</h2>
          <label
            >Archivo TSV
            <div class="inline">
              <input
                bind:value={draft.mappings_path}
                oninput={() => (mappingsStatus = '')}
                placeholder="C:\\diccionarios\\equivalencias.tsv"
              /><button
                class="secondary"
                disabled={mappingsBusy}
                onclick={() => run(chooseMappings)}>Seleccionar archivo…</button
              >
            </div></label
          >
          <small
            >Solo se aplica cuando eliges «Aplicar equivalencias» en un texto. El archivo externo no
            se modifica y se vuelve a leer en cada ejecución.</small
          >
          <div class="section-actions">
            <button
              class="secondary"
              disabled={mappingsBusy || !draft.mappings_path}
              onclick={() => run(checkMappings)}>Comprobar diccionario</button
            >{#if draft.mappings_path}<button
                class="quiet"
                onclick={() => {
                  draft.mappings_path = '';
                  mappingsStatus = '';
                }}>Quitar ruta</button
              >{/if}
          </div>
          {#if mappingsStatus}<p class="muted" role="status">
              {mappingsStatus}
            </p>{:else if draft.mappings_path}<small
              >Ruta configurada. Pulsa Comprobar para validar su estado actual.</small
            >{/if}
          <small
            >Columnas: origen · reemplazo · word|any · case|nocase. Guarda los ajustes para utilizar
            esta ruta.</small
          >
        </section>
        <section class="settings-section">
          <h2>Resultados de IA</h2>
          <label class="checkbox-label"
            ><input type="checkbox" bind:checked={draft.auto_copy} />Copiar el último resultado al
            finalizar</label
          >
          <small
            >Si copias otra cosa durante la espera, conservamos tu última copia. Todos los
            resultados quedan en el historial.</small
          >
          <label class="checkbox-label"
            ><input type="checkbox" bind:checked={draft.notifications} />Notificar al terminar
            cuando Clipia esté en segundo plano</label
          >
        </section>
        <section class="settings-section">
          <div class="section-heading">
            <div>
              <h2>Actualizaciones</h2>
              <p>Versión instalada: {version}</p>
            </div>
            <span class="local-tag">CANAL ESTABLE</span>
          </div>
          <small
            >Los paquetes se descargan de GitHub Releases y se verifica su firma. Se conservarán tu
            historial, prompts y configuración.</small
          >
          <div class="section-actions">
            <button class="secondary" disabled={updateBusy} onclick={() => run(checkUpdates)}
              >Buscar actualizaciones</button
            >
            {#if availableUpdate}<button
                class="primary"
                disabled={updateBusy || jobs.some((j) => j.status === 'running')}
                onclick={() => run(installUpdate)}>Actualizar y reiniciar</button
              >{/if}
          </div>
          {#if updateStatus}<p class="muted" role="status">{updateStatus}</p>{/if}
          {#if availableUpdate?.notes}<pre class="release-notes">{availableUpdate.notes}</pre>{/if}
          {#if updateBusy && availableUpdate}<progress
              max="100"
              value={updateProgress}
              aria-label="Progreso de actualización"
            ></progress>{/if}
        </section>
        <div class="settings-save">
          <span>Historial local · sin sincronización</span>
          {#if JSON.stringify(draft) !== JSON.stringify(settings) || changeKey}<button
              class="quiet"
              onclick={() => {
                draft = { ...settings };
                key = '';
                changeKey = false;
              }}>Descartar cambios</button
            >{/if}
          <button class="primary" disabled={busy} onclick={() => run(saveSettings)}
            >Guardar ajustes</button
          >
        </div>
      </div>
    {/if}
  </main>
</div>

{#if detail || editor || joining || clearConfirm}
  <div class="modal-backdrop" role="presentation">
    <div
      class="dialog"
      class:compare-dialog={detail?.original !== undefined}
      use:focusDialog
      role="dialog"
      aria-modal="true"
      aria-label={detail?.title ??
        (editor ? 'Editar prompt' : joining ? 'Unir textos' : 'Limpiar historial')}
      tabindex="-1"
    >
      <header>
        <h2>
          {detail?.title ??
            (editor
              ? editor.id
                ? 'Editar prompt'
                : 'Nuevo prompt'
              : joining
                ? 'Unir textos'
                : 'Limpiar historial')}
          {#if detail?.ai}<AiChip />{/if}
        </h2>
        <button
          class="icon"
          aria-label="Cerrar"
          onclick={() => {
            detail = null;
            editor = null;
            joining = false;
            clearConfirm = false;
          }}>×</button
        >
      </header>
      <div class="dialog-body">
        {#if error}<div role="alert" class="banner error">{error}</div>{/if}
        {#if detail}{#if detail.original !== undefined}<TextComparison
              original={detail.original}
              result={detail.text}
              compact={widget}
            />
          {:else if detail.image}<img
              class="image-detail"
              src={detail.image}
              alt="Imagen completa del historial"
            />{:else}{#if detail.missingOriginal}<p class="muted">
                El texto original ya no está disponible. Puedes copiar el resultado completo.
              </p>{/if}
            <pre>{detail.text}</pre>{/if}
        {:else if editor}<label>Nombre<input bind:value={editor.name} maxlength="120" /></label
          ><label
            >Instrucciones<textarea bind:value={editor.instructions} rows="10"></textarea></label
          ><small
            >Incluye {'{{text}}'} donde deba aparecer el texto. El resultado nunca reemplaza el original.</small
          >
          <div class="inline">
            <label>Orden<input type="number" bind:value={editor.position} /></label><label
              class="checkbox-label"
              ><input type="checkbox" bind:checked={editor.favorite} />Favorito</label
            >
          </div>
          {#if deletePromptConfirm}<div class="banner error">
              ¿Eliminar este prompt? Los trabajos existentes conservan sus instrucciones.<button
                class="danger"
                onclick={() =>
                  run(async () => {
                    await invoke('delete_prompt', { id: editor!.id });
                    editor = null;
                    deletePromptConfirm = false;
                    await refresh();
                  })}>Eliminar</button
              >
            </div>{/if}
        {:else if joining}<p class="muted">Ajusta el orden. Se unirán con una línea en blanco.</p>
          {#each joined as item, i}<div class="join-item">
              <span>{i + 1}</span>
              <p>{item.text}</p>
              <div>
                <button
                  class="icon"
                  aria-label="Mover arriba"
                  disabled={i === 0}
                  onclick={() => move(i, -1)}>↑</button
                ><button
                  class="icon"
                  aria-label="Mover abajo"
                  disabled={i === joined.length - 1}
                  onclick={() => move(i, 1)}>↓</button
                >
              </div>
            </div>{/each}<label
            >Prompt<select bind:value={promptId}
              >{#each prompts as p}<option value={p.id}>{p.name}</option>{/each}</select
            ></label
          ><small>{chosen?.name}: un único resultado para todos los textos.</small>
        {:else}<p>
            Se eliminarán todas las entradas normales del historial. Los favoritos y los trabajos de
            IA se conservarán.
          </p>{/if}
      </div>
      <footer>
        {#if detail}<button
            class="primary"
            onclick={() => run(() => (detail!.id ? copyClip(detail!.id) : copy(detail!.text)))}
            >{detail.image
              ? 'Copiar imagen'
              : detail.ai
                ? 'Copiar resultado'
                : 'Copiar texto'}</button
          >{:else if editor}{#if editor.id}<button
              class="quiet danger-text"
              onclick={() => (deletePromptConfirm = true)}>Eliminar prompt</button
            >{/if}<button class="primary" onclick={() => run(savePrompt)}>Guardar prompt</button
          >{:else if joining}<button
            class="primary"
            disabled={!promptId}
            onclick={() => run(() => enqueue(true))}>✧ Unir y encolar</button
          >{:else}<button
            class="danger"
            onclick={() =>
              run(async () => {
                await action(0, 'clear');
                selection = [];
                clearConfirm = false;
              })}>Limpiar historial</button
          >{/if}
      </footer>
    </div>
  </div>
{/if}
