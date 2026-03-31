import { expect, test } from "@playwright/test";
import { stubStudioRoute } from "./helpers/studioRoute";

test("loads office shell from root", async ({ page }) => {
  await stubStudioRoute(page);
  await page.goto("/");

  await expect
    .poll(() => new URL(page.url()).pathname)
    .toBe("/office");
  await expect(page.getByText("Loading...")).toBeHidden({ timeout: 15000 });
  await expect(
    page.getByRole("button", { name: "Open headquarters sidebar" }),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("button", { name: "CHAT" })).toBeVisible({ timeout: 15000 });
});
