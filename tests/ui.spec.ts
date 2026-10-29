import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const clips = [
      {
        id: 1,
        text: 'Hola, nesecito corregir este texto. Árbol 🦀',
        favorite: false,
        created: Date.now(),
      },
      {
        id: 2,
        text: 'Segunda idea para unir al texto anterior.',
        favorite: true,
        created: Date.now(),
      },
    ];
    const prompts = [
      {
        id: 1,
        name: 'Corregir escritura',
        instructions: 'Corrige este texto: {{text}}',
        favorite: true,
        position: 0,
      },
    ];
    if (new URL(location.href).searchParams.has('images'))
      clips.push({
        id: 3,
        text: '',
        kind: 'image',
        width: 80,
        height: 60,
        favorite: false,
        created: Date.now(),
      } as any);
    if (new URL(location.href).searchParams.has('ai'))
      clips.push({
        id: 3,
        text: new URL(location.href).searchParams.has('unchanged')
          ? clips[0].text
          : 'Hola, necesito corregir este texto. Árbol 🦀',
        favorite: false,
        origin: 'ai',
        kind: 'text',
        created: Date.now(),
      } as any);
    const state = {
      settings: {
        base_url: 'http://127.0.0.1:1234/v1',
        model: 'local',
        limit: 1000,
        shortcut: 'Ctrl+Alt+V',
        paused: false,
        autostart: false,
        auto_copy: true,
        notifications: true,
        mappings_path: '',
      },
      prompts,
      jobs: [] as any[],
      queue_paused: false,
      has_key: false,
      startup_error: null,
    };
    const callbacks = new Map<number, Function>();
    let count = 0;
    (window as any).__TAURI_INTERNALS__ = {
      transformCallback(fn: Function) {
        const id = ++count;
        callbacks.set(id, fn);
        return id;
      },
      unregisterCallback(id: number) {
        callbacks.delete(id);
      },
      async invoke(command: string, args: any = {}) {
        args = JSON.parse(JSON.stringify(args));
        if (command.startsWith('plugin:event|')) return ++count;
        if (command === 'snapshot') return structuredClone(state);
        if (command === 'list_clips')
          return clips
            .filter(
              (c) =>
                (!args.favorite || c.favorite) &&
                c.text.toLowerCase().includes(args.query.toLowerCase()),
            )
            .slice(args.offset, args.offset + 50);
        if (command === 'clip_text') return clips.find((c) => c.id === args.id)?.text;
        if (command === 'clip_comparison')
          return {
            original: clips[0].text,
            result: clips.find((c) => c.id === args.id)?.text,
            prompt_name: 'Corregir escritura',
          };
        if (command === 'copy_text') {
          (window as any).__copied = args.text;
          return;
        }
        if (command === 'clip_image')
          return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
        if (command === 'copy_clip') {
          (window as any).__copied = clips.find((c) => c.id === args.id)?.text;
          return;
        }
        if (command === 'choose_mappings') return 'C:\\diccionarios\\rules.tsv';
        if (command === 'check_mappings') {
          if (args.path.includes('invalid')) throw 'Línea 2: se requieren cuatro columnas';
          return { rules: 334 };
        }
        if (command === 'apply_mappings') {
          if (!state.settings.mappings_path) throw 'Configura el archivo TSV en Ajustes';
          const clip = clips.find((c) => c.id === args.id)!;
          const next = clip.text.replace('nesecito', 'necesito');
          const changes = next === clip.text ? 0 : 1;
          if (changes) {
            clip.text = next;
            (clip as any).origin = 'dictionary';
          }
          return {
            id: clip.id,
            changes,
            message: changes
              ? '1 reemplazos aplicados y texto copiado'
              : 'No se encontraron cambios',
          };
        }
        if (command === 'check_update') return { version: '0.2.1', notes: 'Mejoras de prueba' };
        if (command === 'update_clip') {
          if (args.action === 'favorite') {
            const c = clips.find((c) => c.id === args.id)!;
            c.favorite = !c.favorite;
          } else {
            for (let i = clips.length - 1; i >= 0; i--)
              if (args.action === 'clear' ? !clips[i].favorite : clips[i].id === args.id)
                clips.splice(i, 1);
          }
          return;
        }
        if (command === 'enqueue') {
          (window as any).__enqueued = args;
          state.jobs.unshift({
            id: 1,
            input: args.ids.map((id: number) => clips.find((c) => c.id === id)!.text).join('\n\n'),
            prompt_name: 'Corregir escritura',
            status: 'completed',
            output: 'Hola, necesito corregir este texto. Árbol 🦀',
            error: null,
            created: Date.now(),
          });
          return;
        }
        if (command === 'save_prompt') {
          if (!args.prompt.name.trim() || !args.prompt.instructions.includes('{{text}}'))
            throw 'Escribe un nombre e incluye {{text}} en las instrucciones';
          if (args.prompt.id)
            Object.assign(
              prompts.find((p) => p.id === args.prompt.id)!,
              args.prompt,
            );
          else prompts.push({ ...args.prompt, id: 2 });
          return;
        }
        if (command === 'save_settings') {
          state.settings = args.settings;
          return;
        }
        if (command === 'queue_control') {
          state.queue_paused = args.paused;
          return;
        }
        if (command === 'models') return ['local'];
        if (command === 'test_provider') return 'Conexión y generación verificadas';
      },
    };
  });
});

test('historial: búsqueda, texto íntegro, favorito y limpieza conservadora', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.clip-card')).toHaveCount(2);
  await page.screenshot({ path: 'artifacts/manager.png' });
  await page.getByRole('button', { name: 'Hola, nesecito', exact: false }).click();
  await expect(page.getByRole('dialog')).toContainText('Árbol 🦀');
  await page.getByRole('button', { name: 'Copiar texto', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__copied)).toContain('Árbol 🦀');
  await page.keyboard.press('Escape');
  await page.getByRole('textbox', { name: 'Buscar en el historial' }).fill('Segunda');
  await expect(page.locator('.clip-card')).toHaveCount(1);
  await page.getByRole('textbox', { name: 'Buscar en el historial' }).fill('');
  await page.getByRole('button', { name: 'Limpiar historial', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Limpiar historial' }).click();
  await expect(page.locator('.clip-card')).toHaveCount(1);
  await expect(page.locator('.clip-card')).toContainText('Segunda');
});

test('unión ordenada, resultado revisable y copia explícita', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('checkbox', { name: 'Seleccionar texto' }).nth(0).check();
  await page.getByRole('checkbox', { name: 'Seleccionar texto' }).nth(1).check();
  await page.getByRole('button', { name: 'Unir…' }).click();
  await page.getByRole('button', { name: 'Mover abajo' }).first().click();
  await page.getByRole('button', { name: 'Unir y encolar', exact: false }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__enqueued))
    .toEqual({ ids: [2, 1], promptId: 1, join: true });
  expect(await page.evaluate(() => (window as any).__copied)).toBeUndefined();
  await page.getByRole('button', { name: 'Cola de IA', exact: false }).click();
  await expect(page.locator('.job-card')).toContainText('Completado');
  await page.getByRole('button', { name: 'Copiar resultado' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__copied)).toContain('necesito');
});

test('administración de prompts y configuración', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Biblioteca de prompts' }).click();
  await page.getByRole('button', { name: 'Nuevo prompt' }).click();
  await page.getByLabel('Nombre', { exact: true }).fill('Mi resumen');
  await page.getByLabel('Instrucciones', { exact: true }).fill('Resume: {{text}}');
  await page.getByRole('button', { name: 'Guardar prompt' }).click();
  await expect(page.locator('.prompt-card')).toHaveCount(2);
  await page.getByRole('button', { name: 'Ajustes', exact: false }).click();
  await page.getByLabel('Entradas normales conservadas').fill('250');
  await page.getByRole('button', { name: 'Guardar ajustes' }).click();
  await expect(page.getByRole('status')).toContainText('Ajustes guardados');
});

test('widget 380×540: teclado, selección y unión sin desbordamiento', async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 540 });
  await page.goto('/?widget', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.clip-card')).toHaveCount(2);
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.clip-open').first()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('checkbox', { name: 'Seleccionar texto' }).first().check();
  await expect(page.getByRole('button', { name: 'Aplicar prompt', exact: false })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'artifacts/widget.png' });
});

test('administración compacta oscura: modal accesible y validación visible', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 520 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Biblioteca de prompts' }).click();
  await page.getByRole('button', { name: 'Nuevo prompt' }).click();
  const dialog = page.getByRole('dialog');
  await page.getByLabel('Nombre', { exact: true }).fill('Validación');
  await page.getByLabel('Instrucciones', { exact: true }).fill('Instrucciones sin variable');
  await page.getByRole('button', { name: 'Guardar prompt' }).click();
  await expect(dialog.getByRole('alert')).toContainText('incluye {{text}}');
  await expect(dialog.getByRole('button', { name: 'Cerrar', exact: true })).toBeInViewport();
  await expect(dialog.getByRole('button', { name: 'Guardar prompt' })).toBeInViewport();
  await dialog.getByRole('button', { name: 'Guardar prompt' }).focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Cerrar', exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'artifacts/compact-dark-dialog.png' });
});

test('imágenes sin IA, Nunito local y selección alineada al contenido', async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 540 });
  await page.goto('/?widget&images', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.clip-card')).toHaveCount(3);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('12px Nunito'))).toBe(true);
  const first = page.locator('.clip-card').first();
  const check = await first.locator('input[type=checkbox]').boundingBox();
  const content = await first.locator('.clip-open').boundingBox();
  expect(Math.abs(check!.y - content!.y)).toBeLessThanOrEqual(4);
  const image = page.locator('.clip-card').last();
  await expect(image.locator('input[type=checkbox]')).toHaveCount(0);
  await expect(image.getByRole('button', { name: 'Transformar', exact: false })).toHaveCount(0);
  await image.locator('.clip-open').click();
  await expect(page.getByRole('dialog').getByRole('img')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copiar imagen', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'artifacts/widget-v2-images.png' });
});

test('actualización disponible y bloqueo con cambios sin guardar', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Ajustes', exact: false }).click();
  await page.getByRole('button', { name: 'Buscar actualizaciones' }).click();
  await expect(page.getByText('Versión 0.2.1 disponible')).toBeVisible();
  await expect(page.getByText('Mejoras de prueba')).toBeVisible();
  await page.getByLabel('Entradas normales conservadas').fill('200');
  await page.getByRole('button', { name: 'Actualizar y reiniciar' }).click();
  await expect(page.getByRole('alert')).toContainText('cambios pendientes');
});

test('chip IA y comparación: marcas, vistas y copia del resultado limpio', async ({ page }) => {
  await page.goto('/?ai', { waitUntil: 'domcontentloaded' });
  const card = page.locator('.clip-card').last();
  await expect(card.locator('.ai-chip')).toHaveText('✧ IA');
  await card.getByRole('button', { name: 'Ver cambios' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.ai-chip')).toBeVisible();
  await expect(dialog.locator('del')).toHaveText('nesecito');
  await expect(dialog.locator('ins')).toHaveText('necesito');
  await dialog.getByRole('button', { name: 'Original', exact: true }).click();
  await expect(dialog.locator('.comparison-plain')).toContainText('nesecito');
  await dialog.getByRole('button', { name: 'Copiar resultado' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__copied))
    .toBe('Hola, necesito corregir este texto. Árbol 🦀');
  await dialog.getByRole('button', { name: 'Resultado', exact: true }).click();
  await expect(dialog.locator('.comparison-plain')).toHaveText(
    'Hola, necesito corregir este texto. Árbol 🦀',
  );
  await dialog.getByRole('button', { name: 'Dos columnas' }).click();
  await expect(dialog.locator('.diff-columns section')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Cambios', exact: true }).click();
  await page.screenshot({ path: 'artifacts/comparison-manager.png' });
});

test('comparación compacta oscura y textos idénticos', async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 540 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/?widget&ai&unchanged', { waitUntil: 'domcontentloaded' });
  await page.locator('.clip-card').last().getByRole('button', { name: 'Ver cambios' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('No hay diferencias:', { exact: false })).toBeVisible();
  await expect(dialog.locator('ins,del')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Dos columnas' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Copiar resultado' })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/comparison-widget.png' });
});

test('configurar TSV y aplicar equivalencias manuales sin guardar el original', async ({
  page,
}) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Ajustes', exact: false }).click();
  await page.getByRole('button', { name: 'Seleccionar archivo…' }).click();
  await expect(page.getByLabel('Archivo TSV')).toHaveValue('C:\\diccionarios\\rules.tsv');
  await expect(page.getByText('Archivo válido · 334 equivalencias')).toBeVisible();
  await page.screenshot({ path: 'artifacts/mappings-settings.png' });
  await page.getByRole('button', { name: 'Guardar ajustes' }).click();
  await page.getByRole('button', { name: 'Portapapeles', exact: false }).click();
  const card = page.locator('.clip-card').first();
  await card.getByRole('button', { name: 'Opciones de la entrada' }).click();
  await page.getByRole('menuitem', { name: 'Aplicar equivalencias' }).click();
  await expect(card).toContainText('necesito');
  await expect(card.locator('.dictionary-chip')).toHaveText('Diccionario');
  await expect(page.locator('.clip-card')).toHaveCount(2);
  await expect(card).not.toContainText('nesecito');
  await page.screenshot({ path: 'artifacts/mappings-history.png' });
  await card.locator('.clip-open').click();
  await expect(page.getByRole('dialog')).toHaveAccessibleName('Texto corregido');
  await page.keyboard.press('Escape');
  await card.getByRole('button', { name: 'Opciones de la entrada' }).click();
  await page.getByRole('menuitem', { name: 'Aplicar equivalencias' }).click();
  await expect(page.getByRole('status')).toContainText('No se encontraron cambios');
});

test('menú compacto accesible y sin equivalencias para imágenes', async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 540 });
  await page.goto('/?widget&images', { waitUntil: 'domcontentloaded' });
  const button = page
    .locator('.clip-card')
    .first()
    .getByRole('button', { name: 'Opciones de la entrada' });
  await button.click();
  await expect(page.getByRole('menuitem', { name: 'Aplicar equivalencias' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Eliminar entrada' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(button).toBeFocused();
  await expect(page.getByRole('menu')).not.toBeVisible();
  await page
    .locator('.clip-card')
    .last()
    .getByRole('button', { name: 'Opciones de la entrada' })
    .click();
  await expect(page.getByRole('menuitem', { name: 'Aplicar equivalencias' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Eliminar entrada' })).toBeInViewport();
  await page.screenshot({ path: 'artifacts/mappings-widget-menu.png' });
});

test('TSV inválido muestra línea de error sin modificar el historial', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Ajustes', exact: false }).click();
  await page.getByLabel('Archivo TSV').fill('C:\\invalid.tsv');
  await page.getByRole('button', { name: 'Comprobar diccionario' }).click();
  await expect(page.getByRole('alert')).toContainText('Línea 2');
  await page.getByRole('button', { name: 'Portapapeles', exact: false }).click();
  await expect(page.locator('.clip-card').first()).toContainText('nesecito');
});
