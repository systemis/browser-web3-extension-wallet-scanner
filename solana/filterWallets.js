import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';

// Determine browser from command line args
const useArc = process.argv.includes('--arc');
const INPUT_FILE = useArc ? 'wallet_balances_arc.json' : 'wallet_balances.json';
const OUTPUT_FILE = useArc ? 'wallets_with_balance_arc.json' : 'wallets_with_balance.json';

/**
 * Check if a wallet has any balance
 */
function hasBalance(wallet) {
  // Check if totalUSD is greater than 0
  if (wallet.totalUSD && wallet.totalUSD > 0) {
    return true;
  }

  // Also check if there are any non-zero balances
  if (!wallet.balances) {
    return false;
  }

  // Check SOL balance
  if (wallet.balances.sol && parseFloat(wallet.balances.sol.balance) > 0) {
    return true;
  }

  // Check SPL tokens
  if (wallet.balances.splTokens && wallet.balances.splTokens.length > 0) {
    for (const token of wallet.balances.splTokens) {
      if (parseFloat(token.balance) > 0) {
        return true;
      }
    }
  }

  // Check NFTs
  if (wallet.balances.nfts && wallet.balances.nfts.length > 0) {
    return true;
  }

  return false;
}

/**
 * Remove duplicate wallets by address (keep the one with more complete data)
 */
function removeDuplicates(wallets) {
  const walletMap = new Map();

  for (const wallet of wallets) {
    const addressKey = wallet.address.toLowerCase();

    if (!walletMap.has(addressKey)) {
      walletMap.set(addressKey, wallet);
    } else {
      // If duplicate, keep the one with more data (prefer one with mnemonic)
      const existing = walletMap.get(addressKey);

      // Prefer HD wallet with mnemonic over imported account
      if (wallet.mnemonic && !existing.mnemonic) {
        walletMap.set(addressKey, wallet);
      } else if (wallet.totalUSD > existing.totalUSD) {
        // Or keep the one with higher balance
        walletMap.set(addressKey, wallet);
      }
    }
  }

  return Array.from(walletMap.values());
}

/**
 * Format wallet for display
 */
function formatWallet(wallet, index) {
  const formatted = {
    walletNumber: index + 1,
    profile: wallet.profile,
    type: wallet.type,
    address: wallet.address,
    totalUSD: wallet.totalUSD || 0
  };

  // Add private key info
  if (wallet.mnemonic) {
    formatted.mnemonic = wallet.mnemonic;
  }

  if (wallet.privateKey) {
    formatted.privateKey = wallet.privateKey;
  }

  if (wallet.derivationPath) {
    formatted.derivationPath = wallet.derivationPath;
  }

  if (wallet.index !== undefined) {
    formatted.accountIndex = wallet.index;
  }

  // Add balance summary
  formatted.balances = {};

  if (wallet.balances) {
    // SOL balance
    if (wallet.balances.sol && parseFloat(wallet.balances.sol.balance) > 0) {
      formatted.balances.sol = {
        symbol: wallet.balances.sol.symbol,
        balance: wallet.balances.sol.balance,
        usd: wallet.balances.sol.usd || 0
      };
    }

    // SPL tokens
    if (wallet.balances.splTokens && wallet.balances.splTokens.length > 0) {
      formatted.balances.splTokens = wallet.balances.splTokens.map(token => ({
        symbol: token.symbol || 'UNKNOWN',
        name: token.name || 'Unknown Token',
        balance: token.balance,
        mint: token.mint
      }));
    }

    // NFTs
    if (wallet.balances.nfts && wallet.balances.nfts.length > 0) {
      formatted.balances.nfts = wallet.balances.nfts.map(collection => ({
        name: collection.name,
        count: collection.count,
        nfts: collection.nfts
      }));
    }
  }

  return formatted;
}

/**
 * Display summary
 */
function displaySummary(filtered, unique, output) {
  console.log('\n' + '='.repeat(80));
  console.log('PHANTOM WALLET FILTER SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total wallets in input: ${output.originalTotalWallets}`);
  console.log(`Wallets with balance > 0: ${filtered.length}`);
  console.log(`Unique wallets (duplicates removed): ${unique.length}`);
  console.log(`Total portfolio value: $${output.totalPortfolioUSD.toFixed(2)}`);
  console.log('='.repeat(80));

  console.log('\nWallets with balance:');
  console.log('-'.repeat(80));

  for (const wallet of output.wallets) {
    console.log(`\n#${wallet.walletNumber} - ${wallet.address}`);
    console.log(`  Type: ${wallet.type}`);
    console.log(`  Profile: ${wallet.profile}`);
    console.log(`  Total USD: $${wallet.totalUSD.toFixed(2)}`);

    if (wallet.mnemonic) {
      console.log(`  Mnemonic: ${wallet.mnemonic}`);
    }

    if (wallet.privateKey) {
      console.log(`  Private Key: ${wallet.privateKey}`);
    }

    // Show balance summary
    if (wallet.balances.sol) {
      console.log(`  SOL: ${parseFloat(wallet.balances.sol.balance).toFixed(6)}`);
    }

    if (wallet.balances.splTokens && wallet.balances.splTokens.length > 0) {
      console.log(`  SPL Tokens: ${wallet.balances.splTokens.length}`);
    }

    if (wallet.balances.nfts && wallet.balances.nfts.length > 0) {
      const totalNFTs = wallet.balances.nfts.reduce((sum, col) => sum + col.count, 0);
      console.log(`  NFTs: ${totalNFTs} (${wallet.balances.nfts.length} collections)`);
    }
  }

  console.log('\n' + '='.repeat(80));
}

async function main() {
  // Check if input file exists
  if (!existsSync(INPUT_FILE)) {
    console.error(`Error: ${INPUT_FILE} not found.`);
    console.log('\nPlease run the balance scan first:');
    console.log('  npm run scan "your-password"');
    process.exit(1);
  }

  console.log(`Reading from ${INPUT_FILE}...`);

  // Read input file
  const data = await readFile(INPUT_FILE, 'utf8');
  const input = JSON.parse(data);

  if (!input.wallets || input.wallets.length === 0) {
    console.log('No wallets found in input file.');
    process.exit(0);
  }

  console.log(`Found ${input.wallets.length} total wallets`);

  // Filter wallets with balance > 0
  console.log('\nFiltering wallets with balance > 0...');
  const filtered = input.wallets.filter(hasBalance);

  if (filtered.length === 0) {
    console.log('No wallets with balance found.');
    process.exit(0);
  }

  console.log(`Found ${filtered.length} wallets with balance`);

  // Remove duplicates
  console.log('Removing duplicate addresses...');
  const unique = removeDuplicates(filtered);

  console.log(`${unique.length} unique wallets after removing duplicates`);

  // Sort by totalUSD descending
  unique.sort((a, b) => (b.totalUSD || 0) - (a.totalUSD || 0));

  // Format output
  const output = {
    generatedAt: new Date().toISOString(),
    originalScanDate: input.scanDate,
    originalTotalWallets: input.totalWallets,
    walletsWithBalance: unique.length,
    totalPortfolioUSD: unique.reduce((sum, w) => sum + (w.totalUSD || 0), 0),
    wallets: unique.map((wallet, index) => formatWallet(wallet, index))
  };

  // Save to output file
  await writeFile(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf8');
  console.log(`\nFiltered wallets saved to ${OUTPUT_FILE}`);

  // Display summary
  displaySummary(filtered, unique, output);

  console.log(`\n✓ Complete! Check ${OUTPUT_FILE} for detailed results.`);
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
