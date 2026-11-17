import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { parseEther } from "ethers";
import type { Intent } from "../web3";
export default function CreateCampaignForm({ account, loading, execute }: {
  account: string;
  loading: boolean;
  execute: (intent: Intent) => Promise<boolean>;
}) {
  const [goal, setGoal] = useState("");
  const [days, setDays] = useState("");
  const [formError, setError] = useState("");
  const goalRef = useRef<HTMLInputElement>(null);
  const durationRef = useRef<HTMLInputElement>(null);
  const [invalidField, setInvalidField] = useState<"goal" | "duration" | null>(null);
  function invalid(field: "goal" | "duration", message: string) {
    setInvalidField(field);
    setError(message);
    (field === "goal" ? goalRef : durationRef).current?.focus();
  }
  const transactions = { execute };
  async function createCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setInvalidField(null);
    const duration = Number(days);
    if (!goal || !/^\d+(\.\d+)?$/.test(goal)) {
      invalid("goal", "Enter a valid funding goal.");
      return;
    }
    let goalWei: bigint;
    try {
      goalWei = parseEther(goal);
    }
    catch {
      invalid("goal", "Enter a valid ETH amount.");
      return;
    }
    if (goalWei <= 0n) {
      invalid("goal", "Funding goal must be greater than zero.");
      return;
    }
    if (!Number.isSafeInteger(duration) || duration < 1 || duration > 3650) {
      invalid("duration", "Enter a duration between 1 and 3650 days.");
      return;
    }
    if (await transactions.execute({ method: "createCampaign", args: [goalWei, BigInt(duration) * 86400n], label: "Create campaign" })) {
      setGoal("");
      setDays("");
    }
  }
  return (<aside className="create-panel">
    <span className="section-label">GET STARTED</span>

    <h2>Create a Campaign</h2>

    <p>
      Turn your idea into reality. Set your funding goal and launch your
      project.
    </p>

    <form onSubmit={createCampaign} noValidate>
      {formError && <p id="create-error" role="alert">{formError}</p>}
      <label htmlFor="goal">Funding Goal (ETH)</label>

      <input id="goal" ref={goalRef} aria-invalid={invalidField === "goal"} aria-describedby={invalidField === "goal" ? "create-error" : undefined} type="number" step="any" min="0" placeholder="e.g. 5" value={goal} onChange={(event) => setGoal(event.target.value)} disabled={loading} required />

      <label htmlFor="duration">Duration (Days)</label>

      <input id="duration" ref={durationRef} aria-invalid={invalidField === "duration"} aria-describedby={invalidField === "duration" ? "create-error" : undefined} type="number" step="1" min="1" max="3650" placeholder="e.g. 30" value={days} onChange={(event) => setDays(event.target.value)} disabled={loading} required />

      <button className="primary-button full-width" type="submit" disabled={!account || loading}>
        {loading ? "Processing..." : "Create Campaign →"}
      </button>
    </form>

    {!account && (<p className="hint">Connect your wallet to create a campaign.</p>)}

    <div className="security-note">
      <span>◇</span>

      <div>
        <strong>Powered by Smart Contracts</strong>

        <p>Transactions use your verified FundChain deployment.</p>
      </div>
    </div>
  </aside>);
}
