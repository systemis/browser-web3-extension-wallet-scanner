import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import axios from 'axios';

// Solana RPC endpoints - using Helius for reliable access
const RPC_ENDPOINTS = [
  'https://mainnet.helius-rpc.com/?api-key=b6c4bd24-c1fb-4630-abbd-e594030be4e1',
];

let currentRPCIndex = 0;

function rotateRPC() {
  currentRPCIndex = (currentRPCIndex + 1) % RPC_ENDPOINTS.length;
}

// Add retry logic with exponential backoff
async function withRetry(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;

      // Check if it's a rate limit or network error
      const is429 = error.message?.includes('429') || error.message?.includes('Too Many Requests');
      const is403 = error.message?.includes('403') || error.message?.includes('Forbidden');

      if (is429 || is403) {
        const delay = Math.min(1000 * Math.pow(2, i), 5000); // Max 5 seconds
        await new Promise(resolve => setTimeout(resolve, delay));
        rotateRPC(); // Switch to different endpoint
      } else {
        throw error; // Don't retry on other errors
      }
    }
  }
}

// Cache for prices
let priceCache = {};
let priceCacheTime = 0;
const PRICE_CACHE_DURATION = 60000; // 1 minute

/**
 * Fetch SOL price from CoinGecko
 */
async function fetchSOLPrice() {
  const now = Date.now();

  if (now - priceCacheTime < PRICE_CACHE_DURATION && priceCache.sol) {
    return priceCache.sol;
  }

  try {
    const response = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
      { timeout: 10000 }
    );

    priceCache.sol = response.data.solana?.usd || 0;
    priceCacheTime = now;
    return priceCache.sol;
  } catch (error) {
    console.error('Error fetching SOL price:', error.message);
    return priceCache.sol || 0;
  }
}

/**
 * Get Solana connection with rotation
 */
function getConnection() {
  const endpoint = RPC_ENDPOINTS[currentRPCIndex];
  rotateRPC(); // Rotate for next call
  return new Connection(endpoint, 'confirmed');
}

/**
 * Get native SOL balance
 */
export async function getSOLBalance(address) {
  return await withRetry(async () => {
    try {
      const connection = getConnection();
      const publicKey = new PublicKey(address);
      const balance = await connection.getBalance(publicKey);
      const balanceInSOL = balance / LAMPORTS_PER_SOL;

      return {
        symbol: 'SOL',
        balance: balanceInSOL.toString(),
        raw: balance.toString(),
        lamports: balance
      };
    } catch (error) {
      return {
        symbol: 'SOL',
        balance: '0',
        raw: '0',
        lamports: 0,
        error: error.message
      };
    }
  });
}

/**
 * Get SPL token balances
 */
export async function getSPLTokenBalances(address) {
  try {
    const connection = getConnection();
    const publicKey = new PublicKey(address);

    // Get token accounts owned by the address
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      publicKey,
      { programId: TOKEN_PROGRAM_ID }
    );

    const balances = [];

    for (const accountInfo of tokenAccounts.value) {
      const parsedInfo = accountInfo.account.data.parsed.info;
      const tokenAmount = parsedInfo.tokenAmount;

      // Only include tokens with non-zero balance
      if (parseFloat(tokenAmount.uiAmount) > 0) {
        balances.push({
          mint: parsedInfo.mint,
          balance: tokenAmount.uiAmount.toString(),
          decimals: tokenAmount.decimals,
          raw: tokenAmount.amount,
          tokenAccount: accountInfo.pubkey.toBase58()
        });
      }
    }

    // Try to fetch token metadata
    for (const token of balances) {
      try {
        const metadata = await fetchTokenMetadata(token.mint, connection);
        if (metadata) {
          token.symbol = metadata.symbol || 'UNKNOWN';
          token.name = metadata.name || 'Unknown Token';
        }
      } catch (e) {
        token.symbol = 'UNKNOWN';
        token.name = token.mint.substring(0, 8) + '...';
      }
    }

    return balances;
  } catch (error) {
    console.error('Error fetching SPL token balances:', error.message);
    return [];
  }
}

/**
 * Fetch token metadata
 */
async function fetchTokenMetadata(mintAddress, connection) {
  try {
    // Try to get metadata from Metaplex
    const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
    const mintPubkey = new PublicKey(mintAddress);

    const [metadataPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('metadata'),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        mintPubkey.toBuffer(),
      ],
      TOKEN_METADATA_PROGRAM_ID
    );

    const accountInfo = await connection.getAccountInfo(metadataPDA);

    if (accountInfo) {
      // Parse metadata (simplified - full parsing would be more complex)
      const data = accountInfo.data;

      // Try to extract name and symbol (basic parsing)
      // This is a simplified version - full metadata parsing requires more work
      return {
        symbol: 'TOKEN',
        name: 'Token'
      };
    }

    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Get NFT balances (simplified)
 */
export async function getNFTBalances(address) {
  try {
    const connection = getConnection();
    const publicKey = new PublicKey(address);

    // Get token accounts with amount = 1 and decimals = 0 (likely NFTs)
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      publicKey,
      { programId: TOKEN_PROGRAM_ID }
    );

    const nfts = [];

    for (const accountInfo of tokenAccounts.value) {
      const parsedInfo = accountInfo.account.data.parsed.info;
      const tokenAmount = parsedInfo.tokenAmount;

      // NFTs typically have decimals=0 and amount=1
      if (tokenAmount.decimals === 0 && tokenAmount.amount === '1') {
        nfts.push({
          mint: parsedInfo.mint,
          tokenAccount: accountInfo.pubkey.toBase58()
        });
      }
    }

    // Try to fetch NFT metadata
    for (const nft of nfts) {
      try {
        const metadata = await fetchNFTMetadata(nft.mint);
        if (metadata) {
          nft.name = metadata.name || 'Unknown NFT';
          nft.symbol = metadata.symbol || 'NFT';
          nft.collection = metadata.collection || null;
        }
      } catch (e) {
        nft.name = 'Unknown NFT';
        nft.symbol = 'NFT';
      }
    }

    // Group by collection if available
    const collections = new Map();
    for (const nft of nfts) {
      const collectionKey = nft.collection || nft.symbol || 'Unknown';
      if (!collections.has(collectionKey)) {
        collections.set(collectionKey, {
          name: collectionKey,
          count: 0,
          nfts: []
        });
      }
      const collection = collections.get(collectionKey);
      collection.count++;
      collection.nfts.push(nft);
    }

    return Array.from(collections.values());
  } catch (error) {
    console.error('Error fetching NFT balances:', error.message);
    return [];
  }
}

/**
 * Fetch NFT metadata from URI
 */
async function fetchNFTMetadata(mintAddress) {
  try {
    // This would require fetching from Metaplex metadata
    // For now, return basic info
    return {
      name: 'NFT',
      symbol: 'NFT'
    };
  } catch (error) {
    return null;
  }
}

/**
 * Calculate USD value for Solana balances
 */
export async function calculateUSDValue(balances) {
  const solPrice = await fetchSOLPrice();
  let totalUSD = 0;

  if (balances.sol && balances.sol.balance) {
    const solUSD = parseFloat(balances.sol.balance) * solPrice;
    balances.sol.usd = solUSD;
    totalUSD += solUSD;
  }

  // For SPL tokens, we would need to fetch individual token prices
  // This would require additional API calls to token price services

  return totalUSD;
}

/**
 * Fetch all balances for a Solana address
 */
export async function fetchAllBalances(address) {
  console.log(`  Fetching SOL balance...`);

  try {
    // Only fetch SOL balance to reduce API calls
    // SPL tokens and NFTs require too many RPC calls and hit rate limits
    const sol = await getSOLBalance(address);

    const balances = {
      sol,
      splTokens: [], // Skip to avoid rate limits
      nfts: [] // Skip to avoid rate limits
    };

    // Calculate total USD value
    const totalUSD = await calculateUSDValue(balances);
    balances.totalUSD = totalUSD;

    return balances;
  } catch (error) {
    console.error(`  Error fetching balances: ${error.message}`);
    return {
      sol: { symbol: 'SOL', balance: '0', raw: '0', lamports: 0 },
      splTokens: [],
      nfts: [],
      totalUSD: 0,
      error: error.message
    };
  }
}
