import { test, expect } from '@playwright/test';
import { login, createProject, cleanupProject } from './e2e-helpers.js';

const PROJECT_NAME = `Layout Visual ${Date.now()}`;

/**
 * Visual assertion: "two terminal panes are displayed side by side with labels,
 * on a dark solarized background"
 *
 * Verifies:
 *   1. Two pane containers are visible in a horizontal flex row
 *   2. Each pane has a label header (CLI, Claude)
 *   3. The background is Solarized Dark (#002b36)
 *   4. The panes are positioned side by side (non-overlapping, similar widths)
 */
test.describe('Layout visual', () => {
  let token;
  const created = [];

  test.afterEach(async ({ request }) => {
    for (const { slug, projectPath } of created) {
      await cleanupProject(request, slug, token, projectPath);
    }
  });

  test('visual: two terminal panes displayed side by side with labels on dark solarized background', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });

    token = await login(page);

    const proj = await createProject(page, PROJECT_NAME);
    created.push(proj);

    // Wait for both terminal panes to render with xterm
    const pane0 = page.getByTestId('terminal-pane-0');
    const pane1 = page.getByTestId('terminal-pane-1');
    await expect(pane0).toBeVisible({ timeout: 10000 });
    await expect(pane1).toBeVisible({ timeout: 10000 });
    await expect(pane0.locator('.xterm')).toBeVisible({ timeout: 10000 });
    await expect(pane1.locator('.xterm')).toBeVisible({ timeout: 10000 });

    // 1. Verify two visible panes positioned side by side
    const layout = await page.evaluate(() => {
      const panes = [
        document.querySelector('[data-testid="terminal-pane-0"]'),
        document.querySelector('[data-testid="terminal-pane-1"]'),
      ];
      const rects = panes.map((p) => p.getBoundingClientRect());

      return {
        pane0: { left: rects[0].left, right: rects[0].right, width: rects[0].width, top: rects[0].top, bottom: rects[0].bottom },
        pane1: { left: rects[1].left, right: rects[1].right, width: rects[1].width, top: rects[1].top, bottom: rects[1].bottom },
        viewportWidth: window.innerWidth,
      };
    });

    // Panes are side by side: pane1 starts at or after where pane0 ends
    expect(layout.pane1.left).toBeGreaterThanOrEqual(layout.pane0.right - 2);

    // Panes are on the same row (similar top positions)
    expect(Math.abs(layout.pane0.top - layout.pane1.top)).toBeLessThanOrEqual(2);

    // Each pane occupies a significant portion of the viewport width
    const widthRatio0 = layout.pane0.width / layout.viewportWidth;
    const widthRatio1 = layout.pane1.width / layout.viewportWidth;
    expect(widthRatio0).toBeGreaterThanOrEqual(0.3);
    expect(widthRatio1).toBeGreaterThanOrEqual(0.3);

    // 2. Verify labels are present
    const labels = await page.evaluate(() => {
      const pane0Label = document.querySelector('[data-testid="terminal-pane-0"]')
        ?.querySelector('div')?.textContent?.trim();
      const pane1Label = document.querySelector('[data-testid="terminal-pane-1"]')
        ?.querySelector('div')?.textContent?.trim();
      return { pane0Label, pane1Label };
    });

    expect(labels.pane0Label.toLowerCase()).toBe('cli');
    expect(labels.pane1Label.toLowerCase()).toBe('claude');

    // 3. Verify Solarized Dark background (#002b36) via screenshot pixel analysis
    const screenshot = await page.screenshot({ type: 'png' });
    const base64 = screenshot.toString('base64');

    const pane0Center = {
      x: Math.round((layout.pane0.left + layout.pane0.right) / 2),
      y: Math.round((layout.pane0.top + layout.pane0.bottom) / 2),
    };

    const bgColor = await page.evaluate(async ({ imgBase64, sampleX, sampleY }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${imgBase64}`;
      await new Promise((resolve) => { img.onload = resolve; });

      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      const [r, g, b] = ctx.getImageData(sampleX, sampleY, 1, 1).data;
      return { r, g, b };
    }, { imgBase64: base64, sampleX: pane0Center.x, sampleY: pane0Center.y });

    // Solarized Dark base03 = #002b36 = RGB(0, 43, 54)
    // base02 = #073642 = RGB(7, 54, 66) (used for highlights)
    // Allow ±10 tolerance for either shade
    expect(bgColor.r).toBeLessThanOrEqual(17);
    expect(bgColor.g).toBeGreaterThanOrEqual(33);
    expect(bgColor.g).toBeLessThanOrEqual(64);
    expect(bgColor.b).toBeGreaterThanOrEqual(44);
    expect(bgColor.b).toBeLessThanOrEqual(76);
  });
});
