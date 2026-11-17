import type { useTransaction } from "../useTransaction";
export default function TransactionStatus({ transactions }: {
  transactions: ReturnType<typeof useTransaction>;
}) {
  const tx = transactions.transaction;
  return tx ? (<section className={`notice ${tx.status === "confirmed" ? "success" : "transaction"}`} aria-label="Latest transaction" role="status">
    <strong>{tx.label}: {tx.status.replaceAll("-", " ")}</strong>
    <p className="transaction-context">Account: {tx.account} · Chain ID: {tx.chainId.toString()}</p>
    {tx.hash && <p className="transaction-context">Transaction hash: {tx.hash}</p>}
    {tx.error && <p role="alert">{tx.error}</p>}
    {tx.refreshWarning && <p>{tx.refreshWarning}</p>}
    {tx.status === "tracking-unavailable" && !tx.manualReview && (<button className="secondary-button" disabled={transactions.working} onClick={() => transactions.retryTracking()}>Check transaction status</button>)}
    {tx.manualReview && (<>
      <p>Only continue after checking wallet history and confirming the requested action was not sent.</p>
      <button className="secondary-button" disabled={transactions.working} onClick={transactions.acknowledgeUnsent}>I verified the action was not sent</button>
    </>)}
  </section>) : null;
}
