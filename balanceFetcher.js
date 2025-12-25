import { ethers } from 'ethers';
import axios from 'axios';

// Network configurations
export const NETWORKS = {
  ethereum: {
    name: 'Ethereum',
    chainId: 1,
    rpc: 'https://eth.llamarpc.com',
    explorer: 'https://api.etherscan.io/api',
    nativeCurrency: 'ETH',
    coingeckoId: 'ethereum'
  },
  bsc: {
    name: 'BSC',
    chainId: 56,
    rpc: 'https://bsc-dataseed1.binance.org',
    explorer: 'https://api.bscscan.com/api',
    nativeCurrency: 'BNB',
    coingeckoId: 'binancecoin'
  },
  base: {
    name: 'Base',
    chainId: 8453,
    rpc: 'https://mainnet.base.org',
    explorer: 'https://api.basescan.org/api',
    nativeCurrency: 'ETH',
    coingeckoId: 'ethereum'
  },
  sei: {
    name: 'Sei',
    chainId: 1329,
    rpc: 'https://evm-rpc.sei-apis.com',
    nativeCurrency: 'SEI',
    coingeckoId: 'sei-network'
  }
};

// ERC-20 ABI (minimal for balance checking)
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)'
];

// ERC-721 ABI (minimal for NFT checking)
const ERC721_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function name() view returns (string)',
  'function symbol() view returns (string)'
];

// Cache for prices
let priceCache = {};
let priceCacheTime = 0;
const PRICE_CACHE_DURATION = 60000; // 1 minute

/**
 * Fetch current prices from CoinGecko
 */
async function fetchPrices() {
  const now = Date.now();

  if (now - priceCacheTime < PRICE_CACHE_DURATION && Object.keys(priceCache).length > 0) {
    return priceCache;
  }

  try {
    const ids = [...new Set(Object.values(NETWORKS).map(n => n.coingeckoId))].join(',');
    const response = await axios.get(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
      { timeout: 10000 }
    );

    priceCache = response.data;
    priceCacheTime = now;
    return priceCache;
  } catch (error) {
    console.error('Error fetching prices from CoinGecko:', error.message);
    // Return cached prices even if expired, or empty object
    return priceCache;
  }
}

/**
 * Get native balance for an address on a specific network
 */
export async function getNativeBalance(address, network) {
  try {
    const provider = new ethers.JsonRpcProvider(network.rpc);
    const balance = await provider.getBalance(address);
    const balanceInEther = ethers.formatEther(balance);

    return {
      symbol: network.nativeCurrency,
      balance: balanceInEther,
      raw: balance.toString()
    };
  } catch (error) {
    console.error(`Error fetching native balance on ${network.name}:`, error.message);
    return {
      symbol: network.nativeCurrency,
      balance: '0',
      raw: '0',
      error: error.message
    };
  }
}

/**
 * Get ERC-20 token balances using block explorer API
 */
export async function getERC20Balances(address, network) {
  if (!network.explorer) {
    return [];
  }

  try {
    // Get token list from block explorer
    const response = await axios.get(network.explorer, {
      params: {
        module: 'account',
        action: 'tokentx',
        address: address,
        startblock: 0,
        endblock: 99999999,
        sort: 'desc'
      },
      timeout: 15000
    });

    if (response.data.status !== '1' || !response.data.result) {
      return [];
    }

    // Get unique token contracts
    const tokenContracts = [...new Set(response.data.result.map(tx => tx.contractAddress))];

    // Fetch balances for each token
    const provider = new ethers.JsonRpcProvider(network.rpc);
    const balances = [];

    for (const contractAddress of tokenContracts.slice(0, 50)) { // Limit to 50 tokens
      try {
        const contract = new ethers.Contract(contractAddress, ERC20_ABI, provider);
        const [balance, decimals, symbol, name] = await Promise.all([
          contract.balanceOf(address),
          contract.decimals(),
          contract.symbol(),
          contract.name()
        ]);

        if (balance > 0n) {
          const balanceFormatted = ethers.formatUnits(balance, decimals);
          balances.push({
            contract: contractAddress,
            name,
            symbol,
            balance: balanceFormatted,
            decimals: Number(decimals),
            raw: balance.toString()
          });
        }
      } catch (error) {
        // Skip tokens that fail (might not be ERC20 compliant)
        continue;
      }
    }

    return balances;
  } catch (error) {
    console.error(`Error fetching ERC-20 balances on ${network.name}:`, error.message);
    return [];
  }
}

/**
 * Get NFT balances using block explorer API
 */
export async function getNFTBalances(address, network) {
  if (!network.explorer) {
    return [];
  }

  try {
    // Get NFT transfers from block explorer
    const response = await axios.get(network.explorer, {
      params: {
        module: 'account',
        action: 'tokennfttx',
        address: address,
        startblock: 0,
        endblock: 99999999,
        sort: 'desc'
      },
      timeout: 15000
    });

    if (response.data.status !== '1' || !response.data.result) {
      return [];
    }

    // Get unique NFT contracts
    const nftContracts = [...new Set(response.data.result.map(tx => tx.contractAddress))];

    // Fetch NFT counts for each collection
    const provider = new ethers.JsonRpcProvider(network.rpc);
    const nftBalances = [];

    for (const contractAddress of nftContracts.slice(0, 30)) { // Limit to 30 collections
      try {
        const contract = new ethers.Contract(contractAddress, ERC721_ABI, provider);
        const [balance, name, symbol] = await Promise.all([
          contract.balanceOf(address),
          contract.name().catch(() => 'Unknown'),
          contract.symbol().catch(() => 'NFT')
        ]);

        if (balance > 0n) {
          nftBalances.push({
            contract: contractAddress,
            name,
            symbol,
            count: Number(balance),
            raw: balance.toString()
          });
        }
      } catch (error) {
        // Skip collections that fail
        continue;
      }
    }

    return nftBalances;
  } catch (error) {
    console.error(`Error fetching NFT balances on ${network.name}:`, error.message);
    return [];
  }
}

/**
 * Calculate USD value for balances
 */
export async function calculateUSDValue(balances) {
  const prices = await fetchPrices();
  let totalUSD = 0;

  for (const [networkName, networkData] of Object.entries(balances)) {
    const network = NETWORKS[networkName];
    if (!network) continue;

    const priceData = prices[network.coingeckoId];
    if (!priceData) continue;

    const nativePrice = priceData.usd || 0;

    // Calculate native balance USD
    if (networkData.native && networkData.native.balance) {
      const nativeUSD = parseFloat(networkData.native.balance) * nativePrice;
      networkData.native.usd = nativeUSD;
      totalUSD += nativeUSD;
    }

    // For ERC-20 tokens, we'd need to fetch individual token prices
    // This is more complex and would require additional API calls
    // For now, we'll just include native token USD values
  }

  return totalUSD;
}

/**
 * Fetch all balances for an address across all networks
 */
export async function fetchAllBalances(address) {
  console.log(`\nFetching balances for ${address}...`);

  const results = {};

  for (const [key, network] of Object.entries(NETWORKS)) {
    console.log(`  Checking ${network.name}...`);

    const [native, erc20, nfts] = await Promise.all([
      getNativeBalance(address, network),
      getERC20Balances(address, network),
      getNFTBalances(address, network)
    ]);

    results[key] = {
      network: network.name,
      native,
      erc20Tokens: erc20,
      nfts
    };
  }

  // Calculate total USD value
  const totalUSD = await calculateUSDValue(results);
  results.totalUSD = totalUSD;

  return results;
}
