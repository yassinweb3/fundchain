import { useState } from "react";
import type { FormEvent } from "react";
import { formatEther, parseEther } from "ethers";
import { CHAIN_ID_TEXT, NETWORK_NAME, payoutRecipient } from "./contract";
import { getError } from "./errors";
import { useWalletSession } from "./useWalletSession";
import { useCampaigns } from "./useCampaigns";
import { useTransaction } from "./useTransaction";
import type { WalletServices } from "./web3";
import { walletServices } from "./web3";
import "./App.css";
import heroImage from "./assets/hero.png";

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function App({ services = walletServices }: { services?: WalletServices }) {
  const wallet = useWalletSession(services);
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
  const now = data.snapshot?.now ?? null;
  const [goal, setGoal] = useState("");
  const [days, setDays] = useState("");
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [recipients, setRecipients] = useState<Record<number, string>>({});
  const [formError, setError] = useState("");
  const loading = wallet.connecting || transactions.busy;
  const error = formError || wallet.error || data.error;
  const notice = wallet.notice;
  const connectWallet = wallet.connectWallet;
  const refreshCampaigns = () => { void data.refresh(); };
  const tx = transactions.transaction;

  async function createCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const duration = Number(days);
    if (!goal || !/^\d+(\.\d+)?$/.test(goal)) { setError("Enter a valid funding goal."); return; }
    let goalWei: bigint;
    try { goalWei = parseEther(goal); }
    catch { setError("Enter a valid ETH amount."); return; }
    if (goalWei <= 0n) { setError("Funding goal must be greater than zero."); return; }
    if (!Number.isSafeInteger(duration) || duration < 1 || duration > 3650) {
      setError("Enter a duration between 1 and 3650 days."); return;
    }
    if (await transactions.execute({ method: "createCampaign", args: [goalWei, BigInt(duration) * 86400n], label: "Create campaign" })) {
      setGoal(""); setDays("");
    }
  }

  async function contribute(id: number) {
    setError("");
    let wei: bigint;
    try { wei = parseEther(amounts[id] || ""); }
    catch { setError("Enter a valid contribution amount."); return; }
    if (wei <= 0n) { setError("Contribution must be greater than zero."); return; }
    if (await transactions.execute({ method: "contribute", args: [id], value: wei, label: `Contribute to campaign #${id}` })) {
      setAmounts(previous => ({ ...previous, [id]: "" }));
    }
  }

  async function settle(id: number, refund: boolean) {
    setError("");
    try {
      const recipient = payoutRecipient(recipients[id] || "", wallet.session?.config.address);
      const method = refund ? (recipient ? "refundTo" : "refund") : (recipient ? "withdrawTo" : "withdraw");
      await transactions.execute({ method, args: recipient ? [id, recipient] : [id],
        label: `${refund ? "Refund" : "Withdraw"} campaign #${id}${recipient ? ` to ${recipient}` : ""}` });
    } catch (error) { setError(getError(error)); }
  }

  const totalRaised = campaigns.reduce(
    (sum, campaign) => sum + campaign.raised,
    0n,
  );

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <div className="brand-icon">◆</div>

          <span>FundChain</span>

          <span className="testnet">LOCAL TESTNET</span>
        </div>

        <button
          className="wallet-button"
          onClick={connectWallet}
          disabled={wallet.connecting}
        >
          {account ? (
            <>● {shortAddress(account)}</>
          ) : wallet.connecting ? (
            "Connecting..."
          ) : (
            "Connect Wallet"
          )}
        </button>
      </header>

      <main className="container">
        <section className="hero">
          <div className="hero-content">
            <div className="eyebrow">DECENTRALIZED CROWDFUNDING</div>

            <h1>
              Fund ideas.
              <br />
              <span>Build the future.</span>
            </h1>

            <p>
              Create campaigns, support projects, and manage funding
              transparently on the blockchain.
            </p>

            <a className="primary-link" href="#campaigns">
              Explore Campaigns →
            </a>
          </div>

          <div className="hero-art" aria-hidden="true">
            <div className="hero-glow" />
            <div className="hero-orbit hero-orbit-one" />
            <div className="hero-orbit hero-orbit-two" />

            <img src={heroImage} alt="" className="hero-image" />

            <div className="hero-badge hero-badge-top">
              <span className="hero-badge-dot" />
              Smart Contract
            </div>

            <div className="hero-badge hero-badge-bottom">◆ On-chain</div>
          </div>
        </section>

        {tx && (
          <section className={`notice ${tx.status === "confirmed" ? "success" : "transaction"}`} aria-label="Latest transaction" role="status">
            <strong>{tx.label}: {tx.status.replaceAll("-", " ")}</strong>
            <p className="transaction-context">Account: {tx.account} · Chain ID: {tx.chainId.toString()}</p>
            {tx.hash && <p className="transaction-context">Transaction hash: {tx.hash}</p>}
            {tx.error && <p role="alert">{tx.error}</p>}
            {tx.refreshWarning && <p>{tx.refreshWarning}</p>}
            {tx.status === "tracking-unavailable" && !tx.manualReview && (
              <button className="secondary-button" disabled={transactions.working} onClick={() => transactions.retryTracking()}>Check transaction status</button>
            )}
            {tx.manualReview && (
              <>
                <p>Only continue after checking wallet history and confirming the requested action was not sent.</p>
                <button className="secondary-button" disabled={transactions.working} onClick={transactions.acknowledgeUnsent}>I verified the action was not sent</button>
              </>
            )}
          </section>
        )}

        {notice && (
          <div className={`notice ${account ? "success" : "transaction"}`} role="status">
            {notice}
          </div>
        )}

        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}

        <section className="stats">
          <div className="stat-card">
            <span>Total Campaigns</span>

            <strong>{campaigns.length}</strong>

            <small>On-chain campaigns</small>
          </div>

          <div className="stat-card">
            <span>Total Raised</span>

            <strong>
              {Number(formatEther(totalRaised)).toLocaleString(undefined, {
                maximumFractionDigits: 4,
              })}{" "}
              ETH
            </strong>

            <small>Recorded funding</small>
          </div>

          <div className="stat-card">
            <span>Network</span>

            <strong>{NETWORK_NAME}</strong>

            <small>Chain ID: {CHAIN_ID_TEXT}</small>
          </div>
        </section>

        <section className="content-layout">
          <div className="campaign-section" id="campaigns">
            <div className="section-heading">
              <div>
                <span className="section-label">DISCOVER</span>

                <h2>Explore Campaigns</h2>

                <p>Support projects powered by Ethereum.</p>
              </div>

              {account && (
                <button
                  className="secondary-button"
                  disabled={loading || data.refreshing}
                  onClick={refreshCampaigns}
                >
                  {data.refreshing ? "↻ Refreshing..." : "↻ Refresh"}
                </button>
              )}
            </div>

            {!account ? (
              <div className="empty-state">
                <div className="empty-icon">◇</div>

                <h3>Connect your wallet</h3>

                <p>
                  Connect MetaMask to explore campaigns on your local
                  blockchain.
                </p>

                <button
                  className="primary-button"
                  onClick={connectWallet}
                  disabled={wallet.connecting}
                >
                  {wallet.connecting ? "Connecting..." : "Connect Wallet"}
                </button>
              </div>
            ) : !data.snapshot ? (
              <div className="empty-state" role="status">
                <h3>{data.error ? "Campaigns could not be loaded" : "Loading campaigns..."}</h3>
                {data.error && <button className="secondary-button" disabled={data.refreshing} onClick={refreshCampaigns}>Retry campaign load</button>}
              </div>
            ) : campaigns.length === 0 ? (
              <div className="empty-state">
                <h3>No campaigns yet</h3>

                <p>Create the first campaign to get started.</p>
              </div>
            ) : (
              <div className="campaign-grid">
                {campaigns.map((campaign) => {
                  const ended = now !== null && now >= campaign.deadline * 1000;

                  const reached = campaign.raised >= campaign.goal;

                  const percent =
                    campaign.goal > 0n
                      ? Math.min(
                          100,
                          Number((campaign.raised * 10000n) / campaign.goal) /
                            100,
                        )
                      : 0;

                  const isOwner =
                    campaign.owner.toLowerCase() === account.toLowerCase();

                  const canWithdraw =
                    ended && reached && !campaign.withdrawn && isOwner;

                  const canRefund =
                    ended && !reached && campaign.contribution > 0n;

                  let status = "Active";

                  if (campaign.withdrawn) {
                    status = "Withdrawn";
                  } else if (ended && reached) {
                    status = "Successful";
                  } else if (ended) {
                    status = "Unsuccessful";
                  }

                  return (
                    <article className="campaign-card" key={campaign.id}>
                      <div className="campaign-cover">
                        <div className="cover-pattern">◆</div>

                        <span className="campaign-number">
                          CAMPAIGN #{campaign.id}
                        </span>
                      </div>

                      <div className="campaign-body">
                        <div className="campaign-top">
                          <span className={`status ${status.toLowerCase()}`}>
                            ● {status}
                          </span>

                          <span className="campaign-id">#{campaign.id}</span>
                        </div>

                        <h3>Campaign #{campaign.id}</h3>

                        <p className="owner">
                          Created by {shortAddress(campaign.owner)}
                        </p>

                        <div className="funding-row">
                          <strong>{formatEther(campaign.raised)} ETH</strong>

                          <span>of {formatEther(campaign.goal)} ETH</span>
                        </div>

                        <div className="progress-track">
                          <div
                            className="progress-fill"
                            style={{
                              width: `${percent}%`,
                            }}
                          />
                        </div>

                        <div className="campaign-details">
                          <span>{percent.toFixed(1)}% funded</span>

                          <span>
                            {ended
                              ? "Campaign ended"
                              : !Number.isFinite(campaign.deadline) ? "Deadline beyond display range" : `Ends ${new Date(
                                  campaign.deadline * 1000,
                                ).toLocaleDateString("en-GB", {
                                  day: "2-digit",
                                  month: "2-digit",
                                  year: "numeric",
                                })}`}
                          </span>
                        </div>

                        {!ended && (
                          <div className="contribute-box">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              placeholder="Amount in ETH"
                              aria-label={`Contribution for campaign ${campaign.id}`}
                              value={amounts[campaign.id] || ""}
                              onChange={(event) =>
                                setAmounts((previous) => ({
                                  ...previous,
                                  [campaign.id]: event.target.value,
                                }))
                              }
                              disabled={loading}
                            />

                            <button
                              className="primary-button"
                              disabled={loading}
                              onClick={() => contribute(campaign.id)}
                            >
                              Contribute →
                            </button>
                          </div>
                        )}

                        {(canWithdraw || canRefund) && (
                          <div className="recovery-recipient">
                            <label htmlFor={`recipient-${campaign.id}`}>Optional payout recipient</label>
                            <input id={`recipient-${campaign.id}`} type="text" placeholder="Leave empty to receive in your wallet"
                              value={recipients[campaign.id] || ""} disabled={loading}
                              onChange={event => setRecipients(previous => ({ ...previous, [campaign.id]: event.target.value }))} />
                            <p>Redirects only your own eligible funds. Contract wallets must be able to authorize the claim.</p>
                            {recipients[campaign.id]?.trim() && <p>Send {formatEther(canWithdraw ? campaign.raised : campaign.contribution)} ETH to {recipients[campaign.id].trim()}</p>}
                          </div>
                        )}

                        {canWithdraw && (
                          <button
                            className="primary-button full-width"
                            disabled={loading}
                            onClick={() => settle(campaign.id, false)}
                          >
                            Withdraw Funds
                          </button>
                        )}

                        {canRefund && (
                          <button
                            className="secondary-button full-width"
                            disabled={loading}
                            onClick={() => settle(campaign.id, true)}
                          >
                            Claim Refund ({formatEther(campaign.contribution)}{" "}
                            ETH)
                          </button>
                        )}

                        {campaign.contribution > 0n && (
                          <p className="contribution-note">
                            Your contribution:{" "}
                            {formatEther(campaign.contribution)} ETH
                          </p>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>

          <aside className="create-panel">
            <span className="section-label">GET STARTED</span>

            <h2>Create a Campaign</h2>

            <p>
              Turn your idea into reality. Set your funding goal and launch your
              project.
            </p>

            <form onSubmit={createCampaign}>
              <label htmlFor="goal">Funding Goal (ETH)</label>

              <input
                id="goal"
                type="number"
                step="any"
                min="0"
                placeholder="e.g. 5"
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                disabled={loading}
                required
              />

              <label htmlFor="duration">Duration (Days)</label>

              <input
                id="duration"
                type="number"
                step="1"
                min="1"
                max="3650"
                placeholder="e.g. 30"
                value={days}
                onChange={(event) => setDays(event.target.value)}
                disabled={loading}
                required
              />

              <button
                className="primary-button full-width"
                type="submit"
                disabled={!account || loading}
              >
                {loading ? "Processing..." : "Create Campaign →"}
              </button>
            </form>

            {!account && (
              <p className="hint">Connect your wallet to create a campaign.</p>
            )}

            <div className="security-note">
              <span>◇</span>

              <div>
                <strong>Powered by Smart Contracts</strong>

                <p>Transactions use your verified FundChain deployment.</p>
              </div>
            </div>
          </aside>
        </section>
      </main>

      <footer className="footer">
        <span>◆ FundChain</span>

        <span>Built with React, Solidity & Ethereum</span>

        <span>Local Development Network</span>
      </footer>
    </div>
  );
}

export default App;
