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

// Well-known token mint addresses for major SPL tokens
const KNOWN_TOKENS = {
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': { symbol: 'USDC', coingeckoId: 'usd-coin' },
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': { symbol: 'USDT', coingeckoId: 'tether' },
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': { symbol: 'mSOL', coingeckoId: 'msol' },
  'So11111111111111111111111111111111111111112': { symbol: 'SOL', coingeckoId: 'solana' },
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': { symbol: 'BONK', coingeckoId: 'bonk' },
  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs': { symbol: 'ETH', coingeckoId: 'ethereum' },
  'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm': { symbol: 'WIF', coingeckoId: 'dogwifcoin' },
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN': { symbol: 'JUP', coingeckoId: 'jupiter-exchange-solana' },
  '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr': { symbol: 'POPCAT', coingeckoId: 'popcat' },
  'hntyVP6YFm1Hg25TN9WGLqM12b1TRezMtjegh2cN4z': { symbol: 'RAY', coingeckoId: 'raydium' },
  'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL': { symbol: 'JTO', coingeckoId: 'jito-governance-token' },
  '5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm': { symbol: 'INF', coingeckoId: 'socean-staked-sol' },
};

/**
 * Fetch token prices from CoinGecko (batch)
 */
async function fetchTokenPrices(tokenIds) {
  const now = Date.now();

  // Return cached prices if still valid
  const cachedPrices = {};
  const uncachedIds = [];

  for (const id of tokenIds) {
    if (priceCache[id] && now - priceCacheTime < PRICE_CACHE_DURATION) {
      cachedPrices[id] = priceCache[id];
    } else {
      uncachedIds.push(id);
    }
  }

  // If all prices are cached, return them
  if (uncachedIds.length === 0) {
    return cachedPrices;
  }

  try {
    const idsParam = uncachedIds.join(',');
    const response = await axios.get(
      `https://api.coingecko.com/api/v3/simple/price?ids=${idsParam}&vs_currencies=usd`,
      { timeout: 10000 }
    );

    // Update cache
    for (const id of uncachedIds) {
      const price = response.data[id]?.usd || 0;
      priceCache[id] = price;
      cachedPrices[id] = price;
    }

    priceCacheTime = now;
    return cachedPrices;
  } catch (error) {
    console.error('Error fetching token prices:', error.message);

    // Return cached prices even if expired, or 0 for new tokens
    for (const id of uncachedIds) {
      cachedPrices[id] = priceCache[id] || 0;
    }
    return cachedPrices;
  }
}

/**
 * Fetch SOL price from CoinGecko
 */
async function fetchSOLPrice() {
  const prices = await fetchTokenPrices(['solana']);
  return prices['solana'] || 0;
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
 * Get SPL token balances with enhanced metadata and pricing
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
        const mint = parsedInfo.mint;
        const token = {
          mint,
          balance: tokenAmount.uiAmount.toString(),
          decimals: tokenAmount.decimals,
          raw: tokenAmount.amount,
          tokenAccount: accountInfo.pubkey.toBase58()
        };

        // Check if this is a known token
        if (KNOWN_TOKENS[mint]) {
          token.symbol = KNOWN_TOKENS[mint].symbol;
          token.name = KNOWN_TOKENS[mint].symbol;
          token.coingeckoId = KNOWN_TOKENS[mint].coingeckoId;
        } else {
          // Try to fetch metadata for unknown tokens
          try {
            const metadata = await fetchTokenMetadata(mint, connection);
            if (metadata) {
              token.symbol = metadata.symbol || 'UNKNOWN';
              token.name = metadata.name || 'Unknown Token';
            } else {
              token.symbol = 'UNKNOWN';
              token.name = mint.substring(0, 8) + '...';
            }
          } catch (e) {
            token.symbol = 'UNKNOWN';
            token.name = mint.substring(0, 8) + '...';
          }
        }

        balances.push(token);
      }
    }

    // Fetch prices for known tokens
    const tokensWithPrices = balances.filter(t => t.coingeckoId);
    if (tokensWithPrices.length > 0) {
      const coingeckoIds = [...new Set(tokensWithPrices.map(t => t.coingeckoId))];
      const prices = await fetchTokenPrices(coingeckoIds);

      for (const token of balances) {
        if (token.coingeckoId && prices[token.coingeckoId]) {
          token.price = prices[token.coingeckoId];
          token.usd = parseFloat(token.balance) * token.price;
        }
      }
    }

    // Sort by USD value (highest first), then by balance
    balances.sort((a, b) => {
      if (a.usd && b.usd) return b.usd - a.usd;
      if (a.usd) return -1;
      if (b.usd) return 1;
      return parseFloat(b.balance) - parseFloat(a.balance);
    });

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

  // Calculate SOL value
  if (balances.sol && balances.sol.balance) {
    const solUSD = parseFloat(balances.sol.balance) * solPrice;
    balances.sol.usd = solUSD;
    totalUSD += solUSD;
  }

  // Calculate SPL token values (already calculated in getSPLTokenBalances)
  if (balances.splTokens && Array.isArray(balances.splTokens)) {
    for (const token of balances.splTokens) {
      if (token.usd) {
        totalUSD += token.usd;
      }
    }
  }

  return totalUSD;
}

/**
 * Fetch all balances for a Solana address
 */
export async function fetchAllBalances(address) {
  console.log(`  Fetching SOL balance...`);

  try {
    // Fetch SOL balance
    const sol = await getSOLBalance(address);

    console.log(`  Fetching SPL token balances...`);
    // Fetch SPL token balances with pricing
    const splTokens = await getSPLTokenBalances(address);

    if (splTokens.length > 0) {
      console.log(`  Found ${splTokens.length} SPL tokens`);
      const tokensWithValue = splTokens.filter(t => t.usd && t.usd > 0.01);
      if (tokensWithValue.length > 0) {
        console.log(`  ${tokensWithValue.length} tokens with USD value`);
      }
    }

    const balances = {
      sol,
      splTokens,
      nfts: [] // Skip NFTs as they require additional metadata calls
    };

    // Calculate total USD value
    const totalUSD = await calculateUSDValue(balances);
    balances.totalUSD = totalUSD;

    console.log(`  Total USD value: $${totalUSD.toFixed(2)}`);

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
