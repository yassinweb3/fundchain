import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import CreateCampaignForm from "../components/CreateCampaignForm";
import CampaignStats from "../components/CampaignStats";
import CampaignCard from "../components/CampaignCard";
import { ALICE } from "./fixtures";
import { CONTRACT_ADDRESS } from "../contract";
it("keeps campaign drafts and validation errors independent", () => {
 const execute = vi.fn(async () => true);
 const campaign = { owner: ALICE, goal: 10n, raised: 0n, deadline: 100, withdrawn: false, contribution: 0n };
 render(<>{[1, 2].map(id => <CampaignCard key={id} campaign={{ ...campaign, id }} now={0} account={ALICE} contractAddress={CONTRACT_ADDRESS} loading={false} execute={execute} />)}</>);
 fireEvent.change(screen.getByLabelText("Contribution for campaign 1"), { target: { value: "2" } });
 expect((screen.getByLabelText("Contribution for campaign 2") as HTMLInputElement).value).toBe("");
 fireEvent.click(screen.getAllByRole("button", { name: /Contribute/ })[1]);
 expect(screen.getByRole("alert").textContent).toMatch(/valid contribution/);
 expect((screen.getByLabelText("Contribution for campaign 1") as HTMLInputElement).value).toBe("2");
 expect(execute).not.toHaveBeenCalled();
});

it("focuses invalid fields and associates form errors", () => {
 const execute = vi.fn(async () => true);
 render(<CreateCampaignForm account={ALICE} loading={false} execute={execute} />);
 fireEvent.click(screen.getByRole("button", { name: /Create Campaign/ }));
 const input = screen.getByLabelText("Funding Goal (ETH)");
 expect(document.activeElement).toBe(input);
 expect(input.getAttribute("aria-invalid")).toBe("true");
 expect(input.getAttribute("aria-describedby")).toBe(screen.getByRole("alert").id);
 fireEvent.change(input, { target: { value: "1" } });
 fireEvent.change(screen.getByLabelText("Duration (Days)"), { target: { value: "0" } });
 fireEvent.click(screen.getByRole("button", { name: /Create Campaign/ }));
 expect(document.activeElement).toBe(screen.getByLabelText("Duration (Days)"));
 expect(execute).not.toHaveBeenCalled();
});
it("exposes capped funding progress and exact bigint page totals", () => {
 const value = 123456789012345678901234567890123456n;
 render(<><CampaignStats count={500} totalRaised={value} /><CampaignCard campaign={{ id: 1, owner: ALICE, goal: 10n, raised: 20n, deadline: 100, withdrawn: false, contribution: 0n }} now={0} account={ALICE} contractAddress={CONTRACT_ADDRESS} loading={false} execute={vi.fn()} /></>);
 expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
 expect(screen.getByText(/123456789012345678.901234567890123456/)).toBeTruthy();
 expect(screen.getByText("Current funds on this page")).toBeTruthy();
});
