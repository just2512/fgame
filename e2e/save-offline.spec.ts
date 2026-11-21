import { chromium, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("save survives browser restart and the game resumes after going offline", async () => {
  const profileDirectory = await mkdtemp(path.join(os.tmpdir(), "fgame-persistent-profile-"));
  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | null = null;

  try {
    context = await chromium.launchPersistentContext(profileDirectory, {
      headless: true,
      viewport: { width: 1280, height: 900 }
    });

    const page = await context.newPage();
    await page.goto("/", { waitUntil: "networkidle" });

    await page.getByRole("button", { name: "开始新故事" }).click();
    await expect(page.getByRole("heading", { name: "遗嘱宣读后的第三天" })).toBeVisible();

    await page.getByRole("button", { name: /亲自接管企业/ }).click();
    await expect(page.getByRole("heading", { name: "叔叔重新评估你" })).toBeVisible();

    await page.waitForFunction(async () => {
      if (!navigator.serviceWorker.controller) return false;
      const cache = await caches.open("fgame-shell-v1");
      const keys = await cache.keys();
      return keys.some((request) => /\/assets\/index-[^/]+\.js(?:\?|$)/.test(request.url));
    }, { timeout: 30_000 });

    // Close the whole persistent browser context, then reopen Chromium against
    // the same user-data directory. This verifies browser-profile storage,
    // not just a second page in the same in-memory context.
    await context.close();
    context = null;

    context = await chromium.launchPersistentContext(profileDirectory, {
      headless: true,
      viewport: { width: 1280, height: 900 }
    });
    const reopenedPage = await context.newPage();
    const runtimeErrors: string[] = [];
    reopenedPage.on("pageerror", (error) => runtimeErrors.push(error.message));
    reopenedPage.on("console", (message) => {
      if (message.type() === "error") runtimeErrors.push(message.text());
    });
    await reopenedPage.goto("/", { waitUntil: "networkidle" });

    await expect(
      reopenedPage.getByRole("button", { name: "继续上次的人生" })
    ).toBeVisible();
    await reopenedPage.getByRole("button", { name: "继续上次的人生" }).click();
    await expect(reopenedPage.getByRole("heading", { name: "叔叔重新评估你" })).toBeVisible();
    const onlineWorkerState = await reopenedPage.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      const scriptUrl = document.querySelector<HTMLScriptElement>('script[type="module"]')?.src ?? "";
      const cssUrl = document.querySelector<HTMLLinkElement>('link[rel="stylesheet"]')?.href ?? "";
      return {
        controlled: Boolean(navigator.serviceWorker.controller),
        workerState: registration?.active?.state ?? "missing",
        scriptUrl,
        cssUrl,
        scriptCached: Boolean(scriptUrl && await caches.match(scriptUrl, { ignoreVary: true })),
        cssCached: Boolean(cssUrl && await caches.match(cssUrl, { ignoreVary: true }))
      };
    });
    expect(onlineWorkerState.controlled).toBe(true);
    expect(onlineWorkerState.workerState).toBe("activated");
    expect(onlineWorkerState.scriptCached).toBe(true);
    expect(onlineWorkerState.cssCached).toBe(true);

    // Disable browser networking. The PWA should boot from cache and expose
    // the normal continue action; choosing it must restore the saved event.
    await context.setOffline(true);
    const offlineResponse = await reopenedPage.reload({ waitUntil: "domcontentloaded" });
    expect(offlineResponse?.ok()).toBe(true);
    await expect(reopenedPage.getByRole("button", { name: "继续上次的人生" })).toBeVisible();
    await reopenedPage.getByRole("button", { name: "继续上次的人生" }).click();
    await expect(reopenedPage.getByRole("heading", { name: "叔叔重新评估你" })).toBeVisible();

    await reopenedPage.getByRole("button", { name: /明确分工和信息权限/ }).click();
    await expect(reopenedPage.getByRole("heading", { name: "一份不太好看的报表" })).toBeVisible();

    await context.close();
    context = null;

    context = await chromium.launchPersistentContext(profileDirectory, {
      headless: true,
      viewport: { width: 1280, height: 900 }
    });
    await context.setOffline(true);
    const finalPage = await context.newPage();
    const finalResponse = await finalPage.goto("/", { waitUntil: "domcontentloaded" });
    expect(finalResponse?.ok()).toBe(true);
    await expect(finalPage.getByRole("button", { name: "继续上次的人生" })).toBeVisible();
    await finalPage.getByRole("button", { name: "继续上次的人生" }).click();
    await expect(finalPage.getByRole("heading", { name: "一份不太好看的报表" })).toBeVisible();
  } finally {
    if (context) await context.close();
    await rm(profileDirectory, { recursive: true, force: true });
  }
});
