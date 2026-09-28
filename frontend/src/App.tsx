import { useCallback, useEffect, useState } from "react";
import { BrowserProvider, Contract, formatEther, parseEther } from "ethers";

import { CONTRACT_ADDRESS, CONTRACT_ABI } from "./contract";
import "./App.css";
import heroImage from "./assets/hero.png";

declare global {
  interface Window {
    ethereum?: any;
  }
}

type Campaign = {
  id: number;
  owner: string;
  goal: bigint;
  raised: bigint;
  deadline: number;
  withdrawn: boolean;
  contribution: bigint;
};

const CHAIN_ID = 31337n;

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function getError(error: any): string {
  const message = String(
    error?.shortMessage || error?.reason || error?.message || error,
  );

  const lowerMessage = message.toLowerCase();

  if (
    lowerMessage.includes("user rejected") ||
    lowerMessage.includes("user denied")
  ) {
    return "You cancelled the transaction.";
  }

  if (message.includes("CampaignNotEnded")) {
    return "The campaign has not ended yet.";
  }

  if (message.includes("GoalNotReached")) {
    return "The funding goal has not been reached.";
  }

  if (message.includes("CampaignEnded")) {
    return "This campaign has already ended.";
  }

  if (message.includes("NothingToRefund")) {
    return "You have nothing to refund.";
  }

  if (message.includes("GoalWasReached")) {
    return "This campaign reached its goal.";
  }

  if (message.includes("NotOwner")) {
    return "Only the campaign owner can withdraw.";
  }

  return message;
}

function App() {
  const [account, setAccount] = useState("");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [goal, setGoal] = useState("");
  const [days, setDays] = useState("");
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [now, setNow] = useState<number | null>(null);

  const getProvider = useCallback(async () => {
    if (!window.ethereum) {
      throw new Error("Please install MetaMask.");
    }

    const provider = new BrowserProvider(window.ethereum);

    const network = await provider.getNetwork();

    if (network.chainId !== CHAIN_ID) {
      throw new Error("Switch MetaMask to Anvil Local (31337).");
    }

    return provider;
  }, []);

  const loadCampaigns = useCallback(
    async (walletAddress: string) => {
      const provider = await getProvider();

      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);

      const count = Number(await contract.campaignCount());

      const results = await Promise.all(
        Array.from({ length: count }, async (_, index) => {
          const id = index + 1;

          const data = await contract.campaigns(id);

          const contribution = await contract.contributions(id, walletAddress);

          return {
            id,
            owner: data.owner as string,
            goal: data.goal as bigint,
            raised: data.amountRaised as bigint,
            deadline: Number(data.deadline),
            withdrawn: data.withdrawn as boolean,
            contribution: contribution as bigint,
          };
        }),
      );

      setCampaigns(results.reverse());

      const latestBlock = await provider.getBlock("latest");

      if (!latestBlock) {
        throw new Error("Cannot read latest Anvil block.");
      }

      setNow(latestBlock.timestamp * 1000);
    },
    [getProvider],
  );

  async function refreshCampaigns() {
    if (!account || loading) return;

    setLoading(true);
    setError("");
    setNotice("Refreshing campaigns...");

    try {
      await loadCampaigns(account);

      setNotice("Campaigns refreshed successfully.");
    } catch (err) {
      setNotice("");
      setError(getError(err));
    } finally {
      setLoading(false);
    }
  }

  async function connectWallet() {
    if (loading) return;

    setError("");
    setNotice("");

    try {
      setLoading(true);

      const provider = await getProvider();

      const signer = await provider.getSigner();

      const address = await signer.getAddress();

      await loadCampaigns(address);

      setAccount(address);

      setNotice("Wallet connected successfully.");
    } catch (err) {
      setError(getError(err));
    } finally {
      setLoading(false);
    }
  }

  async function execute(
    action: (contract: Contract) => Promise<any>,
    successMessage: string,
  ): Promise<boolean> {
    if (!account || loading) return false;

    setLoading(true);
    setError("");
    setNotice("Waiting for MetaMask confirmation...");

    try {
      const provider = await getProvider();

      const signer = await provider.getSigner();

      const address = await signer.getAddress();

      if (address.toLowerCase() !== account.toLowerCase()) {
        throw new Error(
          "Wallet account changed. Please reconnect your wallet.",
        );
      }

      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);

      const tx = await action(contract);

      setNotice("Transaction submitted. Waiting for confirmation...");

      const receipt = await tx.wait();

      if (!receipt || receipt.status !== 1) {
        throw new Error("Transaction failed.");
      }

      await loadCampaigns(address);

      setNotice(successMessage);

      return true;
    } catch (err) {
      setNotice("");
      setError(getError(err));

      return false;
    } finally {
      setLoading(false);
    }
  }

  async function createCampaign(event: React.FormEvent) {
    event.preventDefault();

    const duration = Number(days);

    if (!goal || !/^\d+(\.\d+)?$/.test(goal)) {
      setError("Enter a valid funding goal.");
      return;
    }

    let goalWei: bigint;

    try {
      goalWei = parseEther(goal);
    } catch {
      setError("Enter a valid ETH amount.");
      return;
    }

    if (goalWei <= 0n) {
      setError("Funding goal must be greater than zero.");
      return;
    }

    if (!Number.isSafeInteger(duration) || duration < 1 || duration > 3650) {
      setError("Enter a duration between 1 and 3650 days.");
      return;
    }

    const success = await execute(
      (contract) => contract.createCampaign(goalWei, BigInt(duration) * 86400n),
      "Campaign created successfully!",
    );

    if (success) {
      setGoal("");
      setDays("");
    }
  }

  async function contribute(id: number) {
    const value = amounts[id] || "";

    let wei: bigint;

    try {
      wei = parseEther(value);
    } catch {
      setError("Enter a valid contribution amount.");
      return;
    }

    if (wei <= 0n) {
      setError("Contribution must be greater than zero.");
      return;
    }

    const success = await execute(
      (contract) =>
        contract.contribute(id, {
          value: wei,
        }),
      `Contribution to campaign #${id} confirmed!`,
    );

    if (success) {
      setAmounts((previous) => ({
        ...previous,
        [id]: "",
      }));
    }
  }

  async function withdraw(id: number) {
    await execute(
      (contract) => contract.withdraw(id),
      `Campaign #${id} funds withdrawn successfully!`,
    );
  }

  async function refund(id: number) {
    await execute(
      (contract) => contract.refund(id),
      `Refund for campaign #${id} completed!`,
    );
  }

  useEffect(() => {
    if (!account || loading) return;

    const interval = setInterval(() => {
      loadCampaigns(account).catch((err) => {
        setError(getError(err));
      });
    }, 10000);

    return () => clearInterval(interval);
  }, [account, loading, loadCampaigns]);

  useEffect(() => {
    if (!window.ethereum?.on) return;

    const handleChange = () => {
      setAccount("");
      setCampaigns([]);
      setNow(null);
      setError("");
      setNotice("Wallet changed. Please reconnect.");
    };

    window.ethereum.on("accountsChanged", handleChange);
    window.ethereum.on("chainChanged", handleChange);

    return () => {
      window.ethereum?.removeListener?.("accountsChanged", handleChange);

      window.ethereum?.removeListener?.("chainChanged", handleChange);
    };
  }, []);

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
          disabled={loading}
        >
          {account ? (
            <>● {shortAddress(account)}</>
          ) : loading ? (
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

        {notice && (
          <div className="notice success" role="status">
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

            <strong>Anvil Local</strong>

            <small>Chain ID: 31337</small>
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
                  disabled={loading}
                  onClick={refreshCampaigns}
                >
                  {loading ? "↻ Refreshing..." : "↻ Refresh"}
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
                  disabled={loading}
                >
                  {loading ? "Connecting..." : "Connect Wallet"}
                </button>
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
                              : `Ends ${new Date(
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

                        {canWithdraw && (
                          <button
                            className="primary-button full-width"
                            disabled={loading}
                            onClick={() => withdraw(campaign.id)}
                          >
                            Withdraw Funds
                          </button>
                        )}

                        {canRefund && (
                          <button
                            className="secondary-button full-width"
                            disabled={loading}
                            onClick={() => refund(campaign.id)}
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

                <p>Transactions are executed on your local Anvil blockchain.</p>
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
