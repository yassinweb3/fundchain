import { useEffect } from "react";
import AppFrame from "./components/AppFrame";
import CampaignStats from "./components/CampaignStats";
import CampaignList from "./components/CampaignList";
import CreateCampaignForm from "./components/CreateCampaignForm";
import TransactionStatus from "./components/TransactionStatus";
import { useWalletSession } from "./useWalletSession";
import { useCampaigns } from "./useCampaigns";
import { useTransaction } from "./useTransaction";
import type { WalletServices } from "./web3";
import { walletServices } from "./web3";
function WalletWorkspace({ services = walletServices }: {
  services?: WalletServices;
}) {
  const wallet = useWalletSession(services);
  const connectWallet = wallet.connectWallet;
  useEffect(() => {
    // Strict Mode may replay mount effects; cancel the first scheduled attempt.
    const timer = setTimeout(() => { void connectWallet(); }, 0);
    return () => clearTimeout(timer);
  }, [connectWallet]);
  const data = useCampaigns(wallet.session, wallet.isCurrent, services);
  const transactions = useTransaction(wallet, data.refreshAfterTransaction, services);
  // Changing sessions remounts only the form/page drafts; transaction history stays above this key.
  return <FundChainPage key={wallet.revision} wallet={wallet} data={data} transactions={transactions} />;
}
type PageProps = {
  wallet: ReturnType<typeof useWalletSession>;
  data: ReturnType<typeof useCampaigns>;
  transactions: ReturnType<typeof useTransaction>;
};
function FundChainPage({ wallet, data, transactions }: PageProps) {
  const account = wallet.session?.account ?? "";
  const campaigns = data.snapshot?.campaigns ?? [];
  const loading = wallet.connecting || transactions.busy;
  const error = wallet.error;
  const notice = wallet.notice;
  const connectWallet = wallet.connectWallet;
  const refreshCampaigns = () => { void data.refresh(); };
  const totalRaised = campaigns.reduce((sum, campaign) => sum + campaign.raised, 0n);
  return (<AppFrame account={account} connecting={wallet.connecting} onConnect={connectWallet}>
    <TransactionStatus transactions={transactions} />

    {notice && (<div className={`notice ${account ? "success" : "transaction"}`} role="status">
      {notice}
    </div>)}

    {error && (<div className="notice error" role="alert">
      {error}
    </div>)}

    <CampaignStats count={data.snapshot?.total ?? null} totalRaised={data.snapshot ? totalRaised : null} />

    {data.error && <div className="notice error" role="alert">
      {data.snapshot ? "Campaign data may be out of date. " : ""}{data.error}
      <button className="secondary-button" disabled={data.refreshing} onClick={refreshCampaigns}>Retry campaign load</button>
    </div>}
    {data.snapshot && <p className="data-freshness">Data at block time {new Date(data.snapshot.now).toLocaleTimeString()}{data.refreshing ? " - Refreshing..." : ""}</p>}
    <section className="content-layout">
      <div className="campaign-section" id="campaigns" aria-busy={data.refreshing}>
        <div className="section-heading">
          <div>
            <span className="section-label">DISCOVER</span>

            <h2>Explore Campaigns</h2>

            <p>Support projects powered by Ethereum.</p>
          </div>

          {account && (<button className="secondary-button" disabled={loading || data.refreshing} onClick={refreshCampaigns}>
            {data.refreshing ? "↻ Refreshing..." : "↻ Refresh"}
          </button>)}
        </div>

        <CampaignList wallet={wallet} data={data} transactions={transactions} />
      </div>

      <CreateCampaignForm account={account} loading={loading} execute={transactions.execute} />
    </section>
  </AppFrame>);
}
export default WalletWorkspace;
