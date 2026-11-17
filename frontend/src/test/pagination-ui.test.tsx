import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { parseEther } from "ethers";
import App from "../App";
import type { CampaignSnapshot, Receipt } from "../web3";
import { ALICE, HASH, WalletStub, deferred, services, submitted } from "./fixtures";

it("renders twelve campaigns, preserves pending tracking across pages, and keeps new campaigns discoverable", async () => {
 window.ethereum = new WalletStub();
 const api = services();
 let total = 30;
 vi.mocked(api.readCampaigns).mockImplementation(async (_session, boundary) => {
   const start = Math.min(boundary ?? total, total);
   return { total, start, now: 2000, campaigns: Array.from({length: Math.min(12, start)}, (_, i) => ({
     id: start - i, owner: ALICE, goal: parseEther("1"), raised: parseEther("1"), deadline: 1, withdrawn: false, contribution: 0n
   })) };
 });
 const receipt = deferred<Receipt | null>();
 vi.mocked(api.prepare).mockImplementation(async (current, intent) => {
   const expected = { from: current.account, to: current.config.address, chainId: current.chainId,
     data: (await import("../contract")).contractInterface.encodeFunctionData(intent.method, intent.args), value: intent.value ?? 0n };
   return { expected, send: async () => submitted({ ...expected, wait: () => receipt.promise }) };
 });
 render(<App services={api} />);
 fireEvent.click(screen.getAllByRole("button", { name: "Connect Wallet" })[0]);
 await screen.findByText("Campaign #30");
 expect(screen.getAllByRole("article")).toHaveLength(12);
 expect(screen.getByRole("button", { name: "Previous page" }).hasAttribute("disabled")).toBe(true);
 fireEvent.click(screen.getAllByRole("button", { name: "Withdraw Funds" })[0]);
 await screen.findByText(/: pending/);
 fireEvent.click(screen.getByRole("button", { name: "Next page" }));
 await screen.findByText("Campaign #18");
 expect(screen.getByText(/: pending/)).toBeTruthy();
 expect(screen.getAllByRole("button", { name: "Withdraw Funds" }).every(button => button.hasAttribute("disabled"))).toBe(true);
 total = 31;
 await act(async () => { receipt.resolve({ hash: HASH, status: 1 }); });
 await screen.findByText(/: confirmed/);
 await waitFor(() => expect(screen.getByText("31")).toBeTruthy());
 expect(screen.getByText("Campaign #18")).toBeTruthy();
 expect(api.prepare).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
 await screen.findByText("Campaign #30");
 expect(screen.queryByText("Campaign #31")).toBeNull();
 fireEvent.click(screen.getByRole("button", { name: "View newest campaigns" }));
 await screen.findByText("Campaign #31");
});

it("offers retry for initial read failure, then shows a genuine empty state", async () => {
 window.ethereum = new WalletStub();
 const api = services();
 vi.mocked(api.readCampaigns).mockRejectedValueOnce(Error("RPC down")).mockResolvedValue({ total: 0, start: 0, now: 2000, campaigns: [] } satisfies CampaignSnapshot);
 render(<App services={api} />);
 fireEvent.click(screen.getAllByRole("button", { name: "Connect Wallet" })[0]);
 await screen.findByText("Campaigns could not be loaded");
 expect(screen.queryByText("No campaigns yet")).toBeNull();
 fireEvent.click(screen.getByRole("button", { name: "Retry campaign load" }));
 await screen.findByText("No campaigns yet");
 expect(screen.getAllByRole("button", { name: /^(Next|Previous) page$/ }).every(button => button.hasAttribute("disabled"))).toBe(true);
});
