import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import App from "../App";
import AppFrame from "../components/AppFrame";
import { ALICE, WalletStub, services } from "./fixtures";

it("keeps the original wallet control mounted through module load, rejection, and retry", async () => {
  window.ethereum = new WalletStub();
  const api = services();
  vi.mocked(api.connect).mockRejectedValueOnce({ code: 4001 });
  render(<App services={api} />);
  const button = screen.getAllByRole("button", { name: "Connect Wallet" })[0];
  fireEvent.click(button);
  await screen.findByText("You cancelled the wallet request.");
  expect(button.isConnected).toBe(true);
  expect(screen.getAllByRole("button", { name: "Connect Wallet" })[0]).toBe(button);
  fireEvent.click(button);
  await screen.findByText(/Wallet and FundChain deployment verified/);
  await waitFor(() => expect(button.textContent).toContain(ALICE.slice(0, 6)));
  expect(button.isConnected).toBe(true);
  expect(api.connect).toHaveBeenCalledTimes(2);
  expect(api.prepare).not.toHaveBeenCalled();
});

it("keeps a visible connect control and error when MetaMask is absent", async () => {
  render(<App />);
  const button = screen.getAllByRole("button", { name: "Connect Wallet" })[0];
  fireEvent.click(button);
  await screen.findByText(/install MetaMask/);
  expect(button.isConnected).toBe(true);
  expect(button.hasAttribute("disabled")).toBe(false);
  expect(screen.getByRole("alert").textContent).toMatch(/install MetaMask/);
});

it("never submits an enclosing form from the header wallet control", () => {
  const connect = vi.fn();
  const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
  render(<form onSubmit={submit}><AppFrame onConnect={connect}><p>Content</p></AppFrame></form>);
  fireEvent.click(screen.getByRole("button", { name: "Connect Wallet" }));
  expect(connect).toHaveBeenCalledOnce();
  expect(submit).not.toHaveBeenCalled();
});

it("detects a wallet injected after the first connection attempt without replacing the page", async () => {
  const api = services();
  render(<App services={api} />);
  const button = screen.getAllByRole("button", { name: "Connect Wallet" })[0];
  fireEvent.click(button);
  await screen.findByText(/install MetaMask/);
  expect(api.connect).not.toHaveBeenCalled();
  const injected = new WalletStub();
  window.ethereum = injected;
  fireEvent.click(button);
  await screen.findByText(/Wallet and FundChain deployment verified/);
  expect(api.connect).toHaveBeenCalledExactlyOnceWith(injected);
  expect(button.isConnected).toBe(true);
  expect(api.prepare).not.toHaveBeenCalled();
});

it("renders wallet RPC errors without an uncaught React runtime error or disappearing controls", async () => {
  window.ethereum = new WalletStub();
  const api = services();
  vi.mocked(api.connect).mockRejectedValue(new Error("RPC unavailable"));
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  render(<App services={api} />);
  const button = screen.getAllByRole("button", { name: "Connect Wallet" })[0];
  fireEvent.click(button);
  await screen.findByText("RPC unavailable");
  expect(screen.getByRole("alert").textContent).toBe("RPC unavailable");
  expect(button.isConnected).toBe(true);
  expect(button.getAttribute("type")).toBe("button");
  expect(errors).not.toHaveBeenCalled();
  expect(api.prepare).not.toHaveBeenCalled();
});
