import { isHexString } from "ethers";
import { contractInterface } from "./contract";

export const contractErrors: Record<string, string> = {
  CampaignDoesNotExist: "This campaign does not exist.",
  CampaignEnded: "This campaign has already ended.",
  MustSendETH: "Send an ETH amount greater than zero.",
  NotOwner: "Only the campaign owner can withdraw.",
  GoalNotReached: "The funding goal has not been reached.",
  AlreadyWithdrawn: "This campaign has already been withdrawn.",
  TransferFailed: "The recipient rejected the withdrawal. Try another recipient address.",
  CampaignNotEnded: "The campaign has not ended yet.",
  GoalWasReached: "This campaign reached its goal, so refunds are unavailable.",
  NothingToRefund: "You have nothing to refund.",
  RefundFailed: "The recipient rejected the refund. Try another recipient address.",
  InvalidGoal: "The funding goal must be greater than zero.",
  InvalidDuration: "The campaign duration must be greater than zero.",
  InvalidRecipient: "Choose a recipient other than the zero address or the FundChain contract.",
};

function objects(error: unknown, depth = 0, seen = new Set<unknown>()): Record<string, unknown>[] {
  if (!error || typeof error !== "object" || depth > 5 || seen.has(error)) return [];
  seen.add(error);
  const object = error as Record<string, unknown>;
  return [object, ...["error", "info", "data", "cause", "originalError"].flatMap(key => objects(object[key], depth + 1, seen))];
}

export function errorCode(error: unknown, code: string | number): boolean {
  return objects(error).some(object => object.code === code);
}

export function getError(error: unknown): string {
  if (errorCode(error, 4001) || errorCode(error, "ACTION_REJECTED")) return "You cancelled the wallet request.";
  if (errorCode(error, -32002)) return "A wallet request is already open. Check MetaMask.";
  if (errorCode(error, "INSUFFICIENT_FUNDS")) return "Your wallet has insufficient ETH for the payment and network fee.";
  if (errorCode(error, 4900) || errorCode(error, 4901) || errorCode(error, "NETWORK_ERROR")) {
    return "The wallet network connection changed or is unavailable. Check your network and reconnect.";
  }
  for (const object of objects(error)) {
    const data = object.data;
    if (typeof data === "string" && isHexString(data) && data.length >= 10) {
      try {
        const decoded = contractInterface.parseError(data);
        if (decoded && contractErrors[decoded.name]) return contractErrors[decoded.name];
      } catch { /* Unknown or malformed revert data uses the safe fallback below. */ }
    }
  }
  if (errorCode(error, "CALL_EXCEPTION")) return "The contract rejected this request. Refresh the campaign and try again.";
  if (error instanceof Error && error.message.length <= 240) return error.message;
  return "The request could not be completed. Check your wallet and network, then retry.";
}
