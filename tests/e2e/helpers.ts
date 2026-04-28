import { Page } from 'playwright/test';

export const TEST_USER = {
  name: 'E2E Test User',
  email: `e2e-test-${Date.now()}@opencognit.local`,
  password: 'TestPassword123!',
};

export async function clearSession(page: Page) {
  await page.context().clearCookies();
  // Must navigate to app origin before accessing localStorage
  await page.goto('/login');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
}

export async function registerUser(page: Page, user = TEST_USER) {
  await page.goto('/login');

  // Switch to register tab (page may default to sign-in)
  await page.getByTestId('tab-signup').click();

  // Fill form
  await page.getByTestId('register-name').fill(user.name);
  await page.getByTestId('login-email').fill(user.email);
  await page.getByTestId('login-password').fill(user.password);

  // Submit and wait for navigation
  await Promise.all([
    page.waitForURL('/', { timeout: 15000 }),
    page.getByTestId('login-submit').click(),
  ]);
}

export async function loginUser(page: Page, user = TEST_USER) {
  await page.goto('/login');

  // Ensure sign-in tab is active
  await page.getByTestId('tab-signin').click();

  await page.getByTestId('login-email').fill(user.email);
  await page.getByTestId('login-password').fill(user.password);

  await Promise.all([
    page.waitForURL('/', { timeout: 15000 }),
    page.getByTestId('login-submit').click(),
  ]);
}
