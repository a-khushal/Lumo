import { expect, test, type Page } from "@playwright/test";

const createEmail = () => `e2e-${Date.now()}-${Math.random()}@docs.local`;

const signIn = async (page: Page, email = createEmail()) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("heading", { name: "My documents" }),
  ).toBeVisible();

  return email;
};

const createDocument = async (
  page: Page,
  title = "E2E Document",
  folderId?: string,
) => {
  const payload: { title: string; folderId?: string } = { title };

  if (folderId) {
    payload.folderId = folderId;
  }

  const response = await page.request.post("/api/docs", {
    data: payload,
  });

  expect(response.ok()).toBeTruthy();

  const body = (await response.json()) as {
    document: { id: string; title: string };
  };

  return body.document;
};

const openDocument = async (page: Page, documentId: string) => {
  await page.goto(`/docs/${documentId}`);
  await expect(page).toHaveURL(new RegExp(`/docs/${documentId}$`));
};

const createAndOpenDocument = async (page: Page, title = "E2E Document") => {
  const document = await createDocument(page, title);
  await openDocument(page, document.id);

  return document;
};

test("core docs flow supports comments and suggestions", async ({ page }) => {
  await signIn(page);
  await createAndOpenDocument(page);

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
  await createAndOpenDocument(page);

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
  await createAndOpenDocument(page);

  await page.getByRole("button", { name: "History" }).click();
  await page.getByRole("button", { name: "Save version" }).click();

  await expect(page.getByText("Version 1")).toBeVisible();
});

test("realtime editor syncs between two tabs", async ({ browser }) => {
  const context = await browser.newContext();
  const firstPage = await context.newPage();
  const secondPage = await context.newPage();

  await signIn(firstPage);
  const document = await createAndOpenDocument(firstPage);

  await secondPage.goto(`/docs/${document.id}`);

  const marker = `sync-${Date.now()}`;

  await firstPage.locator(".ProseMirror").click();
  await firstPage.keyboard.type(marker);

  await expect(secondPage.locator(".ProseMirror")).toContainText(marker);

  await context.close();
});

test("folder rename and delete moves docs to unfiled", async ({ page }) => {
  await signIn(page);

  const originalFolderName = `Roadmap ${Date.now()}`;
  const renamedFolderName = `${originalFolderName} Updated`;

  await page.getByPlaceholder("Folder name").fill(originalFolderName);
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText(originalFolderName).first()).toBeVisible();

  const folderHref = await page
    .getByRole("link", { name: originalFolderName })
    .getAttribute("href");
  const scopeParam =
    folderHref !== null
      ? new URL(folderHref, "http://127.0.0.1:3000").searchParams.get("scope")
      : "";
  const folderId =
    scopeParam && scopeParam.startsWith("folder:")
      ? scopeParam.slice("folder:".length)
      : "";

  expect(folderId.length).toBeGreaterThan(0);

  await createDocument(page, "Folder lifecycle doc", folderId);
  await page.goto(page.url());
  await expect(
    page.getByRole("link", { name: "Folder lifecycle doc" }),
  ).toBeVisible();

  await expect(page.getByText(originalFolderName).first()).toBeVisible();

  const renameRow = page
    .locator("li", {
      has: page.locator(`input[value="${originalFolderName}"]`),
    })
    .first();
  await renameRow
    .locator(`input[value="${originalFolderName}"]`)
    .fill(renamedFolderName);
  await renameRow.getByRole("button", { name: "Rename" }).click();

  await expect(page.getByText(renamedFolderName).first()).toBeVisible();

  const deleteRow = page
    .locator("li", { has: page.locator(`input[value="${renamedFolderName}"]`) })
    .first();
  await deleteRow.getByRole("button", { name: "Delete" }).click();

  await page.getByRole("link", { name: "Unfiled" }).click();
  await expect(
    page.getByRole("heading", { name: "Unfiled documents" }),
  ).toBeVisible();
  await expect(page.getByText("Folder lifecycle doc")).toBeVisible();
  await expect(page.getByText("Unfiled").first()).toBeVisible();
});

test("shared-with-me scope shows owner and role context", async ({
  browser,
}) => {
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const collaboratorContext = await browser.newContext();
  const collaboratorPage = await collaboratorContext.newPage();

  const ownerEmail = createEmail();
  const collaboratorEmail = createEmail();

  await signIn(ownerPage, ownerEmail);
  const document = await createDocument(
    ownerPage,
    `Shared Scope ${Date.now()}`,
  );

  const shareResponse = await ownerPage.request.post(
    `/api/docs/${document.id}/members`,
    {
      data: {
        email: collaboratorEmail,
        role: "COMMENTER",
      },
    },
  );

  expect(shareResponse.ok()).toBeTruthy();

  await signIn(collaboratorPage, collaboratorEmail);
  await collaboratorPage.goto("/?scope=shared");

  await expect(
    collaboratorPage.getByRole("heading", { name: "Shared with me" }),
  ).toBeVisible();
  await expect(collaboratorPage.getByText(document.title)).toBeVisible();
  await expect(collaboratorPage.getByText("Shared by").first()).toBeVisible();
  await expect(
    collaboratorPage.getByText("Your role COMMENTER").first(),
  ).toBeVisible();

  await ownerContext.close();
  await collaboratorContext.close();
});

test("dashboard search and quick open support fast navigation", async ({
  page,
}) => {
  await signIn(page);

  const uniquePrefix = `finder-${Date.now()}`;
  const alphaDocument = await createDocument(page, `${uniquePrefix} alpha`);
  const betaDocument = await createDocument(page, `${uniquePrefix} beta`);

  await page.goto("/");
  await page
    .getByPlaceholder("Search documents by title")
    .fill(`${uniquePrefix} alpha`);
  await page.getByRole("button", { name: "Search" }).click();

  await expect(
    page.getByRole("link", { name: alphaDocument.title }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: betaDocument.title }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: /Quick open/i }).click();
  await expect(page.getByRole("dialog", { name: "Quick open" })).toBeVisible();
  await page
    .getByPlaceholder("Search documents", { exact: true })
    .fill(`${uniquePrefix} beta`);
  await page.getByRole("button", { name: betaDocument.title }).click();

  await expect(page).toHaveURL(new RegExp(`/docs/${betaDocument.id}$`));

  await page.getByRole("button", { name: /Quick open/i }).click();
  await expect(page.getByRole("dialog", { name: "Quick open" })).toBeVisible();
  await page
    .getByPlaceholder("Search documents", { exact: true })
    .fill(`${uniquePrefix} alpha`);
  await page.getByRole("button", { name: alphaDocument.title }).click();

  await expect(page).toHaveURL(new RegExp(`/docs/${alphaDocument.id}$`));
});
