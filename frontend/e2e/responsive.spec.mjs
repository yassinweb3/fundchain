import { test, expect } from "@playwright/test";
import { Interface } from "ethers";
import { readFileSync } from "node:fs";

const artifact = JSON.parse(readFileSync(new URL("../../out/Crowdfunding.sol/Crowdfunding.json", import.meta.url), "utf8"));
const abi = new Interface(artifact.abi);
const account = "0x1111111111111111111111111111111111111111";
const now = 1800000000;
test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
});
const replies = {};
replies[abi.encodeFunctionData("campaignCount")] = abi.encodeFunctionResult("campaignCount", [3]);
for (let id = 1; id <= 3; id++) {
  replies[abi.encodeFunctionData("campaigns", [id])] = abi.encodeFunctionResult("campaigns", [account, 10n ** 40n, id === 2 ? 10n ** 40n : 10n ** 38n, id === 3 ? now + 86400 : now - 86400, false]);
  replies[abi.encodeFunctionData("contributions", [id, account])] = abi.encodeFunctionResult("contributions", [10n ** 18n]);
}
async function mockWallet(page, mode = "connected") {
  const fixtureReplies = { ...replies };
  if (mode === "normal") for (let id = 1; id <= 3; id++) {
    fixtureReplies[abi.encodeFunctionData("campaigns", [id])] = abi.encodeFunctionResult("campaigns", [account, 5n * 10n ** 18n, (id === 2 ? 5n : 1n) * 10n ** 18n, id === 3 ? now + 86400 : now - 86400, false]);
  }
  await page.addInitScript(({ account, code, replies, now, mode }) => {
    const calls = [];
    window.__walletCalls = calls;
    window.ethereum = {
      on() {}, removeListener() {},
      async request({ method, params }) {
        calls.push(method);
        if (/^(eth_send|eth_sign|personal_sign|wallet_send)/.test(method)) throw new Error("Transactions forbidden in responsive tests");
        if (method === "eth_chainId") return "0xaa36a7";
        if (method === "eth_accounts" || method === "eth_requestAccounts") return [account];
        if (method === "eth_getCode") return code;
        if (method === "eth_getBlockByNumber") return {
          number: "0x1", timestamp: "0x" + now.toString(16), hash: "0x" + "11".repeat(32),
          parentHash: "0x" + "00".repeat(32), nonce: "0x0000000000000000", difficulty: "0x0",
          gasLimit: "0x1c9c380", gasUsed: "0x0", miner: account, extraData: "0x", transactions: [], baseFeePerGas: "0x1"
        };
        if (method === "eth_call") {
          if (mode === "error") throw new Error("Campaign RPC temporarily unavailable");
          if (mode === "loading") await new Promise(() => {});
          const data = params[0].data;
          if (mode === "empty") return "0x" + "0".repeat(64);
          if (replies[data] !== undefined) return replies[data];
        }
        throw new Error("Unexpected test RPC: " + method);
      }
    };
  }, { account, code: artifact.deployedBytecode.object, replies: fixtureReplies, now, mode });
}
async function checkLayout(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const failures = await page.locator(".brand, .wallet-button, .hero-content, .stat-card, .campaign-card, .create-panel, .pagination, .notice").evaluateAll(elements => elements.flatMap(el => {
    const rect = el.getBoundingClientRect();
    return rect.width && (rect.left < -1 || rect.right > innerWidth + 1 || el.scrollWidth > el.clientWidth + 1) ? [el.className] : [];
  }));
  expect(failures).toEqual([]);
  for (const button of await page.locator("button:visible, input:visible, .primary-link").all()) {
    const box = await button.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => window.__walletCalls?.filter(m => /^(eth_send|eth_sign|personal_sign|wallet_send)/.test(m)) ?? [])).toEqual([]);
}
async function screenshot(page, testInfo, name) {
  const path = testInfo.outputPath(name + ".png");
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  await testInfo.attach(name, { path, contentType: "image/png" });
}
for (const width of [320, 375, 430, 768, 1024, 1440, 1920]) {
  test(`${width}px disconnected and connected dashboard`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await mockWallet(page);
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(page.getByText("Skip to content", { exact: true })).toBeFocused();
    await checkLayout(page);
    await page.locator("h1").click();
    await screenshot(page, testInfo, "disconnected");
    await page.locator(".wallet-button").click();
    await expect(page.locator(".campaign-card")).toHaveCount(3);
    await expect(page.locator(".testnet")).toBeVisible();
    await page.locator("#recipient-2").fill("0x2222222222222222222222222222222222222222");
    const header = await page.locator(".header").boundingBox();
    const brand = await page.locator(".brand").boundingBox();
    const wallet = await page.locator(".wallet-button").boundingBox();
    expect(brand.x + brand.width <= wallet.x || brand.y + brand.height <= wallet.y).toBe(true);
    expect(header.height).toBeLessThanOrEqual(110);
    if (width <= 430) expect((await page.locator(".hero").boundingBox()).height).toBeLessThanOrEqual(420);
    await checkLayout(page);
    const size = await page.locator("h1").evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(32);
    expect(size).toBeLessThanOrEqual(60);
    const columns = await page.locator(".campaign-grid").evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    expect(columns).toBe(width >= 768 ? 2 : 1);
    await screenshot(page, testInfo, "connected-long-values");
    expect(errors).toEqual([]);
  });
}
for (const mode of ["empty", "error", "loading"]) {
  test(`${mode} state at 320px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await mockWallet(page, mode);
    await page.goto("/");
    await page.locator(".wallet-button").click();
    await expect(page.getByText(mode === "empty" ? "No campaigns yet" : mode === "error" ? "Campaigns could not be loaded" : "Loading campaigns...", { exact: true })).toBeVisible();
    await checkLayout(page);
    await screenshot(page, testInfo, mode);
  });
}
test("200% text reflows without clipping", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await mockWallet(page);
  await page.goto("/");
  await page.addStyleTag({ content: "html { font-size: 200%; }" });
  await page.locator(".wallet-button").click();
  await expect(page.locator(".campaign-card")).toHaveCount(3);
  await checkLayout(page);
  await screenshot(page, testInfo, "large-text");
});

for (const width of [375, 1440]) {
  test(`${width}px portfolio screenshot with simulated campaign data`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await mockWallet(page, "normal");
    await page.goto("/");
    await page.locator(".wallet-button").click();
    await expect(page.locator(".campaign-card")).toHaveCount(3);
    await checkLayout(page);
    await screenshot(page, testInfo, "portfolio");
  });
}
