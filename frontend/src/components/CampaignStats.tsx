import { formatEther } from "ethers";
import { CHAIN_ID_TEXT, NETWORK_NAME } from "../contract";
export default function CampaignStats({ count, totalRaised }: {
  count: number | null;
  totalRaised: bigint | null;
}) {
  return (<section className="stats">
    <div className="stat-card">
      <span>Total Campaigns</span>

      <strong>{count ?? "Not loaded"}</strong>

      <small>On-chain campaigns</small>
    </div>

    <div className="stat-card">
      <span>Campaign totals on this page</span>

      <strong>
        {totalRaised === null ? "Not loaded" : formatEther(totalRaised)}{" "}
        ETH
      </strong>

      <small>Includes withdrawn funds</small>
    </div>

    <div className="stat-card">
      <span>Network</span>

      <strong>{NETWORK_NAME}</strong>

      <small>Chain ID: {CHAIN_ID_TEXT}</small>
    </div>
  </section>);
}
