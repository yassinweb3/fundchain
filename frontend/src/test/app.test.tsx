import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { parseEther, ZeroAddress } from "ethers";
import App from "../App";
import { CONTRACT_ADDRESS } from "../contract";
import { ALICE, BOB, HASH, connection, deferred, identity, services, submitted, WalletStub } from "./fixtures";
import type { Campaign, Receipt } from "../web3";

const campaign: Campaign = { id: 1, owner: ALICE, goal: parseEther("1"), raised: parseEther("1"), deadline: 1, withdrawn: false, contribution: parseEther("1") };

async function connected(successful = true) {
  const injected = new WalletStub(); window.ethereum = injected;
  const api = services();
  vi.mocked(api.readCampaigns).mockResolvedValue({ total: 1, start: 1, campaigns: [{ ...campaign, goal: parseEther(successful ? "1" : "2") }], now: 2000 });
  render(<App services={api} />);
  fireEvent.click(screen.getAllByRole("button", { name: "Connect Wallet" })[0]);
  await screen.findByText("Campaign #1");
  return { api, injected };
}

describe("recovery UI", () => {
  it.each([true, false])("submits a redirected %s settlement with its full recipient", async successful => {
    const { api } = await connected(successful);
    fireEvent.change(screen.getByLabelText("Optional payout recipient"), { target: { value: BOB } });
    expect(screen.getByText(`Send 1.0 ETH to ${BOB}`)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: successful ? "Withdraw Funds" : /Claim Refund/ }));
    await waitFor(() => expect(api.prepare).toHaveBeenCalled());
    expect(vi.mocked(api.prepare).mock.calls[0][1]).toMatchObject({ method: successful ? "withdrawTo" : "refundTo", args: [1, BOB] });
    await screen.findByText(/: confirmed/);
  });

  it.each([true, false])("keeps ordinary %s settlement calls when the recipient is empty", async successful => {
    const { api } = await connected(successful);
    fireEvent.click(screen.getByRole("button", { name: successful ? "Withdraw Funds" : /Claim Refund/ }));
    await waitFor(() => expect(api.prepare).toHaveBeenCalled());
    expect(vi.mocked(api.prepare).mock.calls[0][1]).toMatchObject({ method: successful ? "withdraw" : "refund", args: [1] });
  });

  it.each([ZeroAddress, CONTRACT_ADDRESS, "invalid"])("blocks invalid destination %s before requesting a signature", async recipient => {
    const { api } = await connected();
    fireEvent.change(screen.getByLabelText("Optional payout recipient"), { target: { value: recipient } });
    fireEvent.click(screen.getByRole("button", { name: "Withdraw Funds" }));
    expect(screen.getByRole("alert").textContent).toMatch(/recipient|address/i);
    expect(api.prepare).not.toHaveBeenCalled();
  });

  it("clears recipient drafts on account switching", async () => {
    const { api, injected } = await connected();
    fireEvent.change(screen.getByLabelText("Optional payout recipient"), { target: { value: BOB } });
    act(() => injected.emit("accountsChanged", [ALICE]));
    fireEvent.click(screen.getAllByRole("button", { name: "Connect Wallet" })[0]);
    await screen.findByText("Campaign #1");
    expect((screen.getByLabelText("Optional payout recipient") as HTMLInputElement).value).toBe("");
    expect(api.connect).toHaveBeenCalledTimes(2);
  });
});

it("keeps a pending old-account transaction separate from new-account form drafts", async () => {
  const { api, injected } = await connected();
  const receipt = deferred<Receipt | null>();
  vi.mocked(api.prepare).mockResolvedValue({ expected: identity, send: async () => submitted({ wait: () => receipt.promise }) });
  fireEvent.click(screen.getByRole("button", { name: "Withdraw Funds" }));
  await screen.findByText(/: pending/);
  act(() => injected.emit("accountsChanged", [BOB]));
  vi.mocked(api.connect).mockResolvedValue(connection({ account: BOB, injected }));
  fireEvent.click(screen.getAllByRole("button", { name: "Connect Wallet" })[0]);
  await screen.findByText("Campaign #1");
  fireEvent.change(screen.getByLabelText("Funding Goal (ETH)"), { target: { value: "9" } });
  await act(async () => { receipt.resolve({ hash: HASH, status: 1 }); });
  await screen.findByText(/: confirmed/);
  expect((screen.getByLabelText("Funding Goal (ETH)") as HTMLInputElement).value).toBe("9");
  expect(screen.getByText(`Account: ${ALICE} · Chain ID: 31337`)).toBeTruthy();
});

it("clears confirmed form input even when the campaign refresh fails", async () => {
  const { api } = await connected();
  vi.mocked(api.readCampaigns).mockRejectedValue(new Error("RPC unavailable"));
  fireEvent.change(screen.getByLabelText("Funding Goal (ETH)"), { target: { value: "5" } });
  fireEvent.change(screen.getByLabelText("Duration (Days)"), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: /^Create Campaign/ }));
  await screen.findByText(/Transaction confirmed, but campaign refresh failed/);
  expect((screen.getByLabelText("Funding Goal (ETH)") as HTMLInputElement).value).toBe("");
  expect(screen.getByText(/Create campaign: confirmed/)).toBeTruthy();
});

it("keeps stale-data warnings visible alongside independent form errors", async () => {
 const { api } = await connected();
 vi.mocked(api.readCampaigns).mockRejectedValue(new Error("RPC unavailable"));
 fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));
 await screen.findByText(/Campaign data may be out of date/);
 fireEvent.change(screen.getByLabelText("Optional payout recipient"), { target: { value: "invalid" } });
 fireEvent.click(screen.getByRole("button", { name: "Withdraw Funds" }));
 expect(screen.getAllByRole("alert")).toHaveLength(2);
 expect(screen.getByText("Campaign #1")).toBeTruthy();
 expect(document.activeElement).toBe(screen.getByLabelText("Optional payout recipient"));
 expect(screen.getByLabelText("Optional payout recipient").getAttribute("aria-invalid")).toBe("true");
});

it("connects once when a lazy workspace mounts under Strict Mode", async () => {
 window.ethereum = new WalletStub();
 const api = services();
 render(<StrictMode><App services={api} /></StrictMode>);
 fireEvent.click(screen.getAllByRole("button", { name: "Connect Wallet" })[0]);
 await screen.findByText("No campaigns yet");
 expect(api.connect).toHaveBeenCalledTimes(1);
});
