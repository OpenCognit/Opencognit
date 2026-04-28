import { test, expect } from 'playwright/test';
import { registerUser, clearSession } from './helpers.js';

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await clearSession(page);
    const user = {
      name: 'Nav Test User',
      email: `nav-${Date.now()}@opencognit.local`,
      password: 'TestPassword123!',
    };
    await registerUser(page, user);
  });

  test('sidebar shows main navigation items', async ({ page }) => {
    // Skip welcome tour if shown
    await page.getByText('Skip tour').click().catch(() => {});

    // Dashboard should be visible by default
    await expect(page).toHaveURL('/');

    // Sidebar nav items should be visible
    await expect(page.locator('[data-tour-step="dashboard"]')).toBeVisible();
    await expect(page.locator('[data-tour-step="experts"]')).toBeVisible();
    await expect(page.locator('[data-tour-step="tasks"]')).toBeVisible();
  });

  test('can navigate to Agents page', async ({ page }) => {
    await page.getByText('Skip tour').click().catch(() => {});

    await page.locator('[data-tour-step="experts"]').click();

    await expect(page).toHaveURL('/experts');
  });

  test('can navigate to Tasks page', async ({ page }) => {
    await page.getByText('Skip tour').click().catch(() => {});

    await page.locator('[data-tour-step="tasks"]').click();

    await expect(page).toHaveURL('/tasks');
  });

  test('can navigate to Companies page', async ({ page }) => {
    await page.getByText('Skip tour').click().catch(() => {});

    await page.locator('[data-tour-step="companies"]').click();

    await expect(page).toHaveURL('/companies');
  });

  test('logout redirects to login', async ({ page }) => {
    await page.getByText('Skip tour').click().catch(() => {});

    // Click logout button
    await page.getByTitle(/Abmelden|Logout/i).click();

    // App renders login page on root URL when not authenticated
    await expect(page).toHaveURL('/');
    await expect(page.getByTestId('login-email')).toBeVisible();
  });
});
