import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import App from "../App";
import { loadWorkspace } from "../loadWorkspace";
import { deferred, services } from "./fixtures";
vi.mock("../loadWorkspace", () => ({ loadWorkspace: vi.fn() }));

it("loads no wallet module before intent, deduplicates clicks and retries load failures", async () => {
 const api = services();
 const first = deferred<Awaited<ReturnType<typeof loadWorkspace>>>();
 vi.mocked(loadWorkspace).mockReturnValueOnce(first.promise);
 const module = await vi.importActual<typeof import("../WalletWorkspace")>("../WalletWorkspace");
 vi.mocked(loadWorkspace).mockResolvedValueOnce(module);
 render(<App services={api} />);
 expect(loadWorkspace).not.toHaveBeenCalled();
 expect(api.connect).not.toHaveBeenCalled();
 fireEvent.click(screen.getAllByRole("button", { name: "Connect Wallet" })[0]);
 expect(screen.getByRole("status").textContent).toMatch(/Preparing/);
 expect(loadWorkspace).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole("button", { name: /Connecting/ }));
 expect(loadWorkspace).toHaveBeenCalledTimes(1);
 await act(async () => { first.reject(Error("chunk unavailable")); });
 expect(screen.getByRole("alert").textContent).toMatch(/could not be loaded/);
 fireEvent.click(screen.getByRole("button", { name: "Retry wallet tools" }));
 await screen.findByText(/install MetaMask/);
 expect(loadWorkspace).toHaveBeenCalledTimes(2);
});
it("does not mount a late workspace after the shell unmounts", async () => {
 const pending = deferred<Awaited<ReturnType<typeof loadWorkspace>>>();
 const renderWorkspace = vi.fn(() => <p>Workspace</p>);
 vi.mocked(loadWorkspace).mockReturnValueOnce(pending.promise);
 const { unmount } = render(<App />);
 fireEvent.click(screen.getAllByRole("button", { name: "Connect Wallet" })[0]);
 unmount();
 await act(async () => { pending.resolve({ default: renderWorkspace }); });
 expect(renderWorkspace).not.toHaveBeenCalled();
});
