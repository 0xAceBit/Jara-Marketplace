/**
 * Arc Network Open-Source Utility Primitives
 * 
 * These lightweight, zero-dependency functions can be reused or imported by any 
 * builder deploying micro-payments, escrow locks, or on-device location validation 
 * on the Arc L2 network.
 */

/**
 * Encodes standard ERC-20 transfer(address,uint256) data payload
 * for gasless execution / raw EVM bytecode transfer.
 * 
 * @param {string} toAddress - Destination EVM wallet address
 * @param {number} amountUSD - Dollar value to transfer
 * @returns {string} 32-byte padded hex string payload ready to send
 */
function encodeERC20Transfer(toAddress, amountUSD) {
  const selector = 'a9059cbb'; // transfer(address,uint256) method ID
  const cleanAddress = toAddress.toLowerCase().replace(/^0x/, '');
  const paddedAddress = cleanAddress.padStart(64, '0');
  const amountUnits = Math.round(amountUSD * 1000000); // USDC has 6 decimals on Arc
  const amountHex = amountUnits.toString(16);
  const paddedAmount = amountHex.padStart(64, '0');
  return '0x' + selector + paddedAddress + paddedAmount;
}

/**
 * Polls the Web3 provider recursively until a transaction receipt is mined.
 * Throws an error if the transaction reverts.
 * 
 * @param {string} txHash - Transaction hash to query
 * @returns {Promise<object>} Minereceipt object containing receipt status
 */
async function waitForTxReceipt(txHash) {
  const maxAttempts = 30; // Timeout after 30 seconds
  const provider = window.activeProvider || window.ethereum;
  for (let i = 0; i < maxAttempts; i++) {
    const receipt = await provider.request({
      method: 'eth_getTransactionReceipt',
      params: [txHash],
    });
    if (receipt) {
      const statusInt = parseInt(receipt.status, 16);
      if (statusInt === 1 || receipt.status === '0x1' || receipt.status === true) {
        return receipt;
      } else {
        throw new Error("Transaction reverted on-chain");
      }
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error("Transaction timeout waiting for confirmation");
}

/**
 * Calculates distance between two GPS coordinates using the Haversine formula.
 * Run on-device without external lookup API calls.
 * 
 * @param {number} lat1 - Origin Latitude
 * @param {number} lon1 - Origin Longitude
 * @param {number} lat2 - Target Latitude
 * @param {number} lon2 - Target Longitude
 * @returns {number} Distance in meters rounded to nearest integer
 */
function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth's radius in meters
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const deltaPhi = (lat2 - lat1) * Math.PI / 180;
  const deltaLambda = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) *
    Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

// Bind primitives to global window object
window.ArcUtils = {
  encodeERC20Transfer,
  waitForTxReceipt,
  calculateHaversineDistance
};
