import { PAGE_SIZE } from "../web3";
import CampaignCard from "./CampaignCard";
import type { useWalletSession } from "../useWalletSession";
import type { useCampaigns } from "../useCampaigns";
import type { useTransaction } from "../useTransaction";
type Props = {
  wallet: ReturnType<typeof useWalletSession>;
  data: ReturnType<typeof useCampaigns>;
  transactions: ReturnType<typeof useTransaction>;
};
export default function CampaignList({ wallet, data, transactions }: Props) {
  const account = wallet.session?.account ?? "";
  const campaigns = data.snapshot?.campaigns ?? [];
  const now = data.snapshot?.now ?? null;
  const loading = wallet.connecting || transactions.busy;
  const connectWallet = wallet.connectWallet;
  return (<>
    {!account ? (<div className="empty-state">
      <div className="empty-icon">◇</div>

      <h3>Connect your wallet</h3>

      <p>
        Connect MetaMask to explore campaigns on your configured blockchain.
      </p>

      <button className="primary-button" onClick={connectWallet} disabled={wallet.connecting}>
        {wallet.connecting ? "Connecting..." : "Connect Wallet"}
      </button>
    </div>) : !data.snapshot ? (<div className="empty-state" role="status">
      <h3>{data.error ? "Campaigns could not be loaded" : "Loading campaigns..."}</h3>

    </div>) : campaigns.length === 0 ? (<div className="empty-state">
      <h3>{data.snapshot.total === 0 ? "No campaigns yet" : "No campaigns on this page"}</h3>

      <p>{data.snapshot.total === 0 ? "Create the first campaign to get started." : "View newest campaigns to see available campaigns."}</p>
    </div>) : (<div className="campaign-grid">
      {campaigns.map(campaign => <CampaignCard key={campaign.id} campaign={campaign} now={now!} account={account} contractAddress={wallet.session!.config.address} loading={loading} execute={transactions.execute} />)}
    </div>)}
    {account && <nav aria-label="Campaign pages" className="pagination">
      <button className="secondary-button" disabled={!data.snapshot || data.refreshing || data.snapshot.start >= data.snapshot.total} onClick={data.newer}>Previous page</button>
      <span role="status">{campaigns.length ? `Campaigns #${campaigns[0].id} to #${campaigns[campaigns.length - 1].id}` : data.snapshot ? "No campaigns on this page" : "Loading campaign page..."}</span>
      <button className="secondary-button" disabled={!data.snapshot || data.refreshing || data.snapshot.start <= PAGE_SIZE} onClick={data.older}>Next page</button>
      <button className="secondary-button" disabled={!data.snapshot || data.refreshing || data.snapshot.start >= data.snapshot.total} onClick={data.newest}>View newest campaigns</button>
    </nav>}
  </>);
}
