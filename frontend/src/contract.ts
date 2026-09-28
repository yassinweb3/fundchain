export const CONTRACT_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

export const CONTRACT_ABI = [
  "function campaignCount() view returns (uint256)",
  "function campaigns(uint256) view returns (address owner, uint256 goal, uint256 amountRaised, uint256 deadline, bool withdrawn)",
  "function contributions(uint256,address) view returns (uint256)",
  "function createCampaign(uint256 _goal,uint256 _duration)",
  "function contribute(uint256 _campaignId) payable",
  "function withdraw(uint256 _campaignId)",
  "function refund(uint256 _campaignId)",
];
