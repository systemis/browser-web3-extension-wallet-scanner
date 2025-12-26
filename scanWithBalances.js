import { writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';

// Chain type detection
const useSolana = process.argv.includes('--solana');
const browser = process.argv.includes('--arc') ? 'arc' : 'brave';

// Dynamic imports based on chain type
const scannerModule = useSolana
  ? await import('./src/solana/walletScanner.js')
  : await import('./src/evm/walletScanner.js');

const fetcherModule = useSolana
  ? await import('./src/solana/balanceFetcher.js')
  : await import('./src/evm/balanceFetcher.js');

const { scanAllWallets } = scannerModule;
const { fetchAllBalances } = fetcherModule;

// Cache file names based on chain and browser
function getCacheFileName() {
  const chainPrefix = useSolana ? 'solana_' : '';
  const browserSuffix = browser === 'arc' ? '_arc' : '';
  return `${chainPrefix}wallet_balances${browserSuffix}.json`;
}

const CACHE_FILE = getCacheFileName();

async function loadCache() {
  if (existsSync(CACHE_FILE)) {
    try {
      const data = await readFile(CACHE_FILE, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Error loading cache:', error.message);
      return null;
    }
  }
  return null;
}

async function saveCache(data, silent = false) {
  try {
    await writeFile(CACHE_FILE, JSON.stringify(data, null, 2), 'utf8');
    if (!silent) {
      console.log(`\nResults saved to ${CACHE_FILE}`);
    }
  } catch (error) {
    console.error('Error saving cache:', error.message);
  }
}

function displayResultsEVM(results) {
  console.log('\n' + '='.repeat(80));
  console.log('METAMASK WALLET BALANCE SUMMARY');
  console.log('='.repeat(80));

  for (const wallet of results.wallets) {
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`Profile: ${wallet.profile}`);
    console.log(`Type: ${wallet.type}`);
    console.log(`Address: ${wallet.address}`);
    if (wallet.derivationPath) {
      console.log(`Derivation Path: ${wallet.derivationPath}`);
    }
    console.log(`Total USD Value: $${wallet.totalUSD?.toFixed(2) || '0.00'}`);

    if (wallet.balances) {
      for (const [network, data] of Object.entries(wallet.balances)) {
        if (network === 'totalUSD') continue;

        console.log(`\n  ${data.network}:`);

        // Native balance
        if (data.native && parseFloat(data.native.balance) > 0) {
          const usdValue = data.native.usd ? ` ($${data.native.usd.toFixed(2)})` : '';
          console.log(`    ${data.native.symbol}: ${parseFloat(data.native.balance).toFixed(6)}${usdValue}`);
        }

        // ERC-20 tokens
        if (data.erc20Tokens && data.erc20Tokens.length > 0) {
          console.log(`    ERC-20 Tokens (${data.erc20Tokens.length}):`);
          data.erc20Tokens.slice(0, 10).forEach(token => {
            console.log(`      ${token.symbol}: ${parseFloat(token.balance).toFixed(6)}`);
          });
          if (data.erc20Tokens.length > 10) {
            console.log(`      ... and ${data.erc20Tokens.length - 10} more`);
          }
        }

        // NFTs
        if (data.nfts && data.nfts.length > 0) {
          console.log(`    NFTs (${data.nfts.length} collections):`);
          data.nfts.slice(0, 5).forEach(nft => {
            console.log(`      ${nft.name} (${nft.symbol}): ${nft.count} NFT(s)`);
          });
          if (data.nfts.length > 5) {
            console.log(`      ... and ${data.nfts.length - 5} more collections`);
          }
        }
      }
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`TOTAL PORTFOLIO VALUE: $${results.totalPortfolioUSD?.toFixed(2) || '0.00'}`);
  console.log('='.repeat(80));
}

function displayResultsSolana(results) {
  console.log('\n' + '='.repeat(80));
  console.log('PHANTOM WALLET BALANCE SUMMARY');
  console.log('='.repeat(80));

  for (const wallet of results.wallets) {
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`Profile: ${wallet.profile}`);
    console.log(`Type: ${wallet.type}`);
    console.log(`Address: ${wallet.address}`);
    if (wallet.derivationPath) {
      console.log(`Derivation Path: ${wallet.derivationPath}`);
    }
    console.log(`Total USD Value: $${wallet.totalUSD?.toFixed(2) || '0.00'}`);

    if (wallet.balances) {
      // SOL balance
      if (wallet.balances.sol && parseFloat(wallet.balances.sol.balance) > 0) {
        const usdValue = wallet.balances.sol.usd ? ` ($${wallet.balances.sol.usd.toFixed(2)})` : '';
        console.log(`\n  SOL: ${parseFloat(wallet.balances.sol.balance).toFixed(6)}${usdValue}`);
      }

      // SPL tokens
      if (wallet.balances.splTokens && wallet.balances.splTokens.length > 0) {
        console.log(`\n  SPL Tokens (${wallet.balances.splTokens.length}):`);
        wallet.balances.splTokens.slice(0, 10).forEach(token => {
          const symbol = token.symbol || 'UNKNOWN';
          const name = token.name || 'Unknown Token';
          console.log(`    ${symbol}: ${parseFloat(token.balance).toFixed(6)}`);
          if (name !== symbol) {
            console.log(`      (${name})`);
          }
        });
        if (wallet.balances.splTokens.length > 10) {
          console.log(`    ... and ${wallet.balances.splTokens.length - 10} more`);
        }
      }

      // NFTs
      if (wallet.balances.nfts && wallet.balances.nfts.length > 0) {
        const totalNFTs = wallet.balances.nfts.reduce((sum, col) => sum + col.count, 0);
        console.log(`\n  NFTs (${totalNFTs} total in ${wallet.balances.nfts.length} collection(s)):`);
        wallet.balances.nfts.slice(0, 5).forEach(collection => {
          console.log(`    ${collection.name}: ${collection.count} NFT(s)`);
        });
        if (wallet.balances.nfts.length > 5) {
          console.log(`    ... and ${wallet.balances.nfts.length - 5} more collections`);
        }
      }
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`TOTAL PORTFOLIO VALUE: $${results.totalPortfolioUSD?.toFixed(2) || '0.00'}`);
  console.log('='.repeat(80));
}

function displayResults(results) {
  if (useSolana) {
    displayResultsSolana(results);
  } else {
    displayResultsEVM(results);
  }
}

async function main() {
  const password = process.argv[2];
  const skipFetch = process.argv.includes('--skip-fetch');
  const forceRescan = process.argv.includes('--force');

  if (!password || password.startsWith('--')) {
    const walletType = useSolana ? 'phantom' : 'metamask';
    const extensionName = useSolana ? 'Phantom (Solana)' : 'MetaMask (EVM)';
    
    console.log(`Multi-Chain Wallet Scanner - ${extensionName}`);
    console.log('='.repeat(50));
    console.log(`\nUsage: node scanWithBalances.js <${walletType}-password> [options]`);
    console.log('\nOptions:');
    console.log('  --solana        Scan Phantom wallets (Solana) instead of MetaMask (EVM)');
    console.log('  --skip-fetch    Load from cache without fetching new balances');
    console.log('  --force         Force rescan all wallets (ignore cache)');
    console.log('  --arc           Scan Arc browser instead of Brave');
    console.log('\nExamples:');
    console.log('  node scanWithBalances.js "your-password"                  # EVM/MetaMask');
    console.log('  node scanWithBalances.js "your-password" --solana         # Solana/Phantom');
    console.log('  node scanWithBalances.js "your-password" --solana --arc   # Solana on Arc');
    console.log('  node scanWithBalances.js "your-password" --skip-fetch');
    console.log('  node scanWithBalances.js "your-password" --force');
    process.exit(1);
  }

  const chainName = useSolana ? 'Solana (Phantom)' : 'EVM (MetaMask)';
  console.log(`Chain: ${chainName}`);
  console.log(`Browser: ${browser.toUpperCase()}`);
  console.log(`Cache file: ${CACHE_FILE}\n`);

  let results;

  if (skipFetch) {
    console.log('Loading from cache...');
    results = await loadCache();
    if (!results) {
      console.log('No cache found. Run without --skip-fetch to scan wallets.');
      process.exit(1);
    }
  } else {
    // Scan wallets
    const wallets = await scanAllWallets(password, browser);

    if (wallets.length === 0) {
      console.log('\nNo wallets found.');
      if (useSolana) {
        console.log('\nNote: Phantom wallet scanning may require additional configuration.');
        console.log('Make sure you have Phantom installed and have created wallets.');
      }
      process.exit(0);
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`Total wallets found: ${wallets.length}`);
    console.log('='.repeat(80));

    // Load existing cache to check for already scanned wallets
    let existingCache = null;
    if (!forceRescan) {
      existingCache = await loadCache();
      if (existingCache) {
        console.log(`\nFound existing cache from ${existingCache.scanDate}`);
        console.log('Will resume from where we left off...');
      }
    }

    // Create a map of existing wallet data by address
    const existingWalletMap = new Map();
    if (existingCache && existingCache.wallets) {
      for (const wallet of existingCache.wallets) {
        existingWalletMap.set(wallet.address.toLowerCase(), wallet);
      }
    }

    // Fetch balances for each wallet
    console.log('\nFetching balances for all wallets...');
    console.log('This may take a few minutes...');
    console.log('Data is saved after each wallet to prevent data loss.\n');

    let totalPortfolioUSD = 0;
    let skippedCount = 0;
    let fetchedCount = 0;

    for (let i = 0; i < wallets.length; i++) {
      const wallet = wallets[i];
      const addressKey = wallet.address.toLowerCase();

      // Check if this wallet already has balance data
      const existingWallet = existingWalletMap.get(addressKey);
      if (existingWallet && existingWallet.balances && Object.keys(existingWallet.balances).length > 0) {
        console.log(`\n[${i + 1}/${wallets.length}] ${wallet.address} - Using cached data`);
        wallet.balances = existingWallet.balances;
        wallet.totalUSD = existingWallet.totalUSD || 0;
        totalPortfolioUSD += wallet.totalUSD;
        skippedCount++;
      } else {
        console.log(`\n[${i + 1}/${wallets.length}] ${wallet.address} - Fetching...`);

        try {
          const balances = await fetchAllBalances(wallet.address);
          wallet.balances = balances;
          wallet.totalUSD = balances.totalUSD || 0;
          totalPortfolioUSD += wallet.totalUSD;
          fetchedCount++;
        } catch (error) {
          console.error(`  Error fetching balances: ${error.message}`);
          wallet.balances = {};
          wallet.totalUSD = 0;
        }

        // Save incrementally after each wallet is fetched
        const intermediateResults = {
          scanDate: new Date().toISOString(),
          lastUpdate: new Date().toISOString(),
          chainType: useSolana ? 'solana' : 'evm',
          totalWallets: wallets.length,
          scannedWallets: i + 1,
          totalPortfolioUSD,
          wallets: wallets.slice(0, i + 1)
        };
        await saveCache(intermediateResults, true); // Silent save

        // Add small delay to avoid rate limiting
        const delay = useSolana ? (500 + Math.random() * 500) : 500;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    results = {
      scanDate: existingCache?.scanDate || new Date().toISOString(),
      lastUpdate: new Date().toISOString(),
      chainType: useSolana ? 'solana' : 'evm',
      totalWallets: wallets.length,
      scannedWallets: wallets.length,
      totalPortfolioUSD,
      wallets
    };

    // Final save with message
    await saveCache(results);

    console.log(`\n${'='.repeat(80)}`);
    console.log(`Scan complete! Fetched: ${fetchedCount} | Cached: ${skippedCount} | Total: ${wallets.length}`);
    console.log('='.repeat(80));
  }

  // Display results
  displayResults(results);
}

main().catch((error) => {
  console.error('Error:', error.message);
  console.error(error.stack);
  process.exit(1);
});
