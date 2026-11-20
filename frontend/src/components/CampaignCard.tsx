import { useRef, useState } from "react";
import { formatEther, parseEther } from "ethers";
import { payoutRecipient } from "../contract";
import { getError } from "../errors";
import type { Campaign, Intent } from "../web3";
type Props = {
  campaign: Campaign;
  now: number;
  account: string;
  contractAddress: string;
  loading: boolean;
  execute: (intent: Intent) => Promise<boolean>;
};
export default function CampaignCard({ campaign, now, account, contractAddress, loading, execute }: Props) {
  const id = campaign.id;
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [formError, setError] = useState("");
  const amountRef = useRef<HTMLInputElement>(null);
  const recipientRef = useRef<HTMLInputElement>(null);
  const [invalidField, setInvalidField] = useState<"amount" | "recipient" | null>(null);
  const errorId = `campaign-error-${id}`;
  function invalid(field: "amount" | "recipient", message: string) {
    setError(message);
    setInvalidField(field);
    (field === "amount" ? amountRef : recipientRef).current?.focus();
  }
  const transactions = { execute };
  async function contribute() {
    setError("");
    setInvalidField(null);
    let wei: bigint;
    try {
      wei = parseEther(amount);
    }
    catch {
      invalid("amount", "Enter a valid contribution amount.");
      return;
    }
    if (wei <= 0n) {
      invalid("amount", "Contribution must be greater than zero.");
      return;
    }
    if (await transactions.execute({ method: "contribute", args: [id], value: wei, label: `Contribute to campaign #${id}` })) {
      setAmount("");
    }
  }
  async function settle(refund: boolean) {
    setError("");
    setInvalidField(null);
    try {
      const destination = payoutRecipient(recipient, contractAddress);
      const method = refund ? (destination ? "refundTo" : "refund") : (destination ? "withdrawTo" : "withdraw");
      await transactions.execute({
        method, args: destination ? [id, destination] : [id],
        label: `${refund ? "Refund" : "Withdraw"} campaign #${id}${destination ? ` to ${destination}` : ""}`
      });
    }
    catch (error) {
      invalid("recipient", getError(error));
    }
  }
  const ended = now >= campaign.deadline * 1000;
  const reached = campaign.raised >= campaign.goal;
  const percent = campaign.goal > 0n
    ? Math.min(100, Number((campaign.raised * 10000n) / campaign.goal) /
      100)
    : 0;
  const isOwner = campaign.owner.toLowerCase() === account.toLowerCase();
  const canWithdraw = ended && reached && !campaign.withdrawn && isOwner;
  const canRefund = ended && !reached && campaign.contribution > 0n;
  let status = "Active";
  if (campaign.withdrawn) {
    status = "Withdrawn";
  }
  else if (ended && reached) {
    status = "Successful";
  }
  else if (ended) {
    status = "Unsuccessful";
  }
  return (<article className="campaign-card" key={campaign.id}>
    <div className="campaign-cover">
      <div className="cover-pattern">◆</div>

      <span className="campaign-number">
        CAMPAIGN #{campaign.id}
      </span>
    </div>

    <div className="campaign-body">
      {formError && <p id={errorId} role="alert">{formError}</p>}
      <div className="campaign-top">
        <span className={`status ${status.toLowerCase()}`}>
          ● {status}
        </span>

        <span className="campaign-id">#{campaign.id}</span>
      </div>

      <h3>Campaign #{campaign.id}</h3>

      <p className="owner">
        Created by {`${campaign.owner.slice(0, 6)}...${campaign.owner.slice(-4)}`}
      </p>

      <div className="funding-row">
        <strong>{formatEther(campaign.raised)} ETH</strong>

        <span>of {formatEther(campaign.goal)} ETH</span>
      </div>

      <div className="progress-track" role="progressbar" aria-label={`Funding for campaign ${id}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${percent.toFixed(1)}% funded`}>
        <div className="progress-fill" style={{
          width: `${percent}%`,
        }} />
      </div>

      <div className="campaign-details">
        <span>{percent.toFixed(1)}% funded</span>

        <span>
          {ended
            ? "Campaign ended"
            : !Number.isFinite(campaign.deadline) ? "Deadline beyond display range" : `Ends ${new Date(campaign.deadline * 1000).toLocaleDateString("en-GB", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
            })}`}
        </span>
      </div>

      {!ended && (<div className="contribute-box">
        <input type="number" min="0" step="any" placeholder="Amount in ETH" ref={amountRef} aria-invalid={invalidField === "amount"} aria-describedby={invalidField === "amount" ? errorId : undefined} aria-label={`Contribution for campaign ${campaign.id}`} value={amount} onChange={event => setAmount(event.target.value)} disabled={loading} />

        <button type="button" className="primary-button" disabled={loading} onClick={() => contribute()}>
          Contribute →
        </button>
      </div>)}

      {(canWithdraw || canRefund) && (<div className="recovery-recipient">
        <label htmlFor={`recipient-${campaign.id}`}>Optional payout recipient</label>
        <input ref={recipientRef} aria-invalid={invalidField === "recipient"} aria-describedby={invalidField === "recipient" ? errorId : `recipient-help-${id}`} id={`recipient-${campaign.id}`} type="text" placeholder="Leave empty to receive in your wallet" value={recipient} disabled={loading} onChange={event => setRecipient(event.target.value)} />
        <p id={`recipient-help-${id}`}>Redirects only your own eligible funds. Contract wallets must be able to authorize the claim.</p>
        {recipient.trim() && <p>Send {formatEther(canWithdraw ? campaign.raised : campaign.contribution)} ETH to {recipient.trim()}</p>}
      </div>)}

      {canWithdraw && (<button type="button" className="primary-button full-width" disabled={loading} onClick={() => settle(false)}>
        Withdraw Funds
      </button>)}

      {canRefund && (<button type="button" className="secondary-button full-width" disabled={loading} onClick={() => settle(true)}>
        Claim Refund ({formatEther(campaign.contribution)}{" "}
        ETH)
      </button>)}

      {campaign.contribution > 0n && (<p className="contribution-note">
        Your contribution:{" "}
        {formatEther(campaign.contribution)} ETH
      </p>)}
    </div>
  </article>);
}
