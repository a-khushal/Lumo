import { expect, test, type Page } from "@playwright/test";

const createEmail = () => `e2e-${Date.now()}-${Math.random()}@docs.local`;

const signIn = async (page: Page) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(createEmail());
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("heading", { name: "My documents" }),
  ).toBeVisible();
};

const createDocument = async (page: Page) => {
  const response = await page.request.post("/api/docs", {
    data: {
      title: "E2E Document",
    },
  });

  expect(response.ok()).toBeTruthy();

  const body = (await response.json()) as {
    document: { id: string };
  };

  await page.goto(`/docs/${body.document.id}`);
  await expect(page).toHaveURL(/\/docs\//);
};

test("core docs flow supports comments and suggestions", async ({ page }) => {
  await signIn(page);
  await createDocument(page);

  await page.getByPlaceholder("Untitled document").fill("E2E Document");

  await page.getByRole("button", { name: "Comments" }).click();
  await page.getByPlaceholder("Add a comment").fill("Looks good");
  await page.getByRole("button", { name: "Post comment" }).click();
  await expect(page.getByText("Looks good")).toBeVisible();

  await page.getByRole("button", { name: "Suggest", exact: true }).click();
  await page.getByRole("button", { name: "Suggestions" }).click();
  await page
    .getByPlaceholder("Describe the suggested text update")
    .fill("Prefer shorter intro");
  await page.getByRole("button", { name: "Submit suggestion" }).click();

  await expect(page.getByText("OPEN").first()).toBeVisible();
});

test("share and member role management works", async ({ page }) => {
  await signIn(page);
  await createDocument(page);

  await page.getByRole("button", { name: "Share" }).click();
  await page
    .getByPlaceholder("teammate@company.com")
    .fill("collab-user@docs.local");
  await page.getByRole("button", { name: "Invite" }).click();

  const memberRow = page.locator("li", { hasText: "collab-user@docs.local" });
  await expect(memberRow).toBeVisible();

  const memberRoleSelect = memberRow.getByRole("combobox").first();
  await memberRoleSelect.selectOption("VIEWER");
  await expect(memberRoleSelect).toHaveValue("VIEWER");

  await memberRow.getByRole("button", { name: "Remove" }).click();
  await expect(memberRow).toHaveCount(0);
});

test("version history can save snapshots", async ({ page }) => {
  await signIn(page);
  await createDocument(page);

  await page.getByRole("button", { name: "History" }).click();
  await page.getByRole("button", { name: "Save version" }).click();

  await expect(page.getByText("Version 1")).toBeVisible();
});

test("realtime editor syncs between two tabs", async ({ browser }) => {
  const context = await browser.newContext();
  const firstPage = await context.newPage();
  const secondPage = await context.newPage();

  await signIn(firstPage);
  await createDocument(firstPage);

  const documentUrl = firstPage.url();
  await secondPage.goto(documentUrl);

  const marker = `sync-${Date.now()}`;

  await firstPage.locator(".ProseMirror").click();
  await firstPage.keyboard.type(marker);

  await expect(secondPage.locator(".ProseMirror")).toContainText(marker);

  await context.close();
});
