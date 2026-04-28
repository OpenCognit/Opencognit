import { test, expect } from 'playwright/test';
import { registerUser, loginUser, clearSession, TEST_USER } from './helpers.js';

test.describe('Authentication', () => {
  const user = {
    ...TEST_USER,
    email: `auth-${Date.now()}@opencognit.local`,
  };

  test.beforeEach(async ({ page }) => {
    await clearSession(page);
  });

  test('user can register a new account', async ({ page }) => {
    await registerUser(page, user);

    // Should be redirected to dashboard
    await expect(page).toHaveURL('/');

    // Dashboard page loaded — skip welcome tour if shown
    await page.getByText('Skip tour').click().catch(() => {});

    // Sidebar should show Dashboard nav item
    await expect(page.locator('[data-tour-step="dashboard"]')).toBeVisible();
  });

  test('user can log in with existing account', async ({ page }) => {
    // Use a unique user for this test
    const loginUserData = {
      ...TEST_USER,
      email: `login-${Date.now()}@opencognit.local`,
    };

    // Register first (creates the account)
    await registerUser(page, loginUserData);
    await clearSession(page);

    // Now log in
    await loginUser(page, loginUserData);

    await expect(page).toHaveURL('/');
    await page.getByText('Skip tour').click().catch(() => {});
    await expect(page.locator('[data-tour-step="dashboard"]')).toBeVisible();
  });

  test('shows error for invalid credentials', async ({ page }) => {
    await page.goto('/login');

    // Ensure we're on sign-in tab (page may default to sign-up on fresh DB)
    await page.getByTestId('tab-signin').click();

    await page.getByTestId('login-email').fill('wrong@example.com');
    await page.getByTestId('login-password').fill('wrongpassword');
    await page.getByTestId('login-submit').click();

    // Should stay on login page and show error
    await expect(page).toHaveURL(/.*login.*/);
    await expect(page.getByText(/Fehler|Error|Invalid|falsch|wrong/i)).toBeVisible();
  });

  test('register tab switches form mode', async ({ page }) => {
    await page.goto('/login');

    // Click sign-in tab first (page may default to sign-up on fresh DB)
    await page.getByTestId('tab-signin').click();

    // No name field in sign-in mode
    await expect(page.getByTestId('register-name')).not.toBeVisible();

    // Click register tab
    await page.getByTestId('tab-signup').click();

    // Name field should appear
    await expect(page.getByTestId('register-name')).toBeVisible();
  });
});
