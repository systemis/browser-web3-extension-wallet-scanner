import { scanAllWallets } from './walletScanner.js';
import { writeFile } from 'fs/promises';

async function main() {
  const password = process.argv[2] || 'dummy'; // Password not needed for address extraction
  const useArc = process.argv.includes('--arc');
  const browser = useArc ? 'arc' : 'brave';
  const outputFile = useArc ? 'phantom_wallets_arc.json' : 'phantom_wallets.json';

  console.log(`Scanning Phantom wallets in ${browser.toUpperCase()}...\n`);

  const wallets = await scanAllWallets(password, browser);

  if (wallets.length === 0) {
    console.log('No wallets found.');
    process.exit(0);
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`Total wallets found: ${wallets.length}`);
  console.log('='.repeat(80));

  // Group by profile
  const byProfile = {};
  for (const wallet of wallets) {
    if (!byProfile[wallet.profile]) {
      byProfile[wallet.profile] = [];
    }
    byProfile[wallet.profile].push(wallet);
  }

  // Display by profile
  for (const [profile, profileWallets] of Object.entries(byProfile)) {
    console.log(`\n${profile}: ${profileWallets.length} wallet(s)`);
    console.log('-'.repeat(80));

    profileWallets.forEach((wallet, i) => {
      console.log(`\n${i + 1}. ${wallet.address}`);
      console.log(`   Type: ${wallet.type}`);
      if (wallet.derivationIndex !== undefined) {
        console.log(`   Derivation Index: ${wallet.derivationIndex}`);
      }
    });
  }

  // Save to file
  const output = {
    scanDate: new Date().toISOString(),
    totalWallets: wallets.length,
    wallets: wallets.map(w => ({
      profile: w.profile,
      type: w.type,
      address: w.address,
      derivationIndex: w.derivationIndex,
      seedIdentifier: w.seedIdentifier,
      privateKeyIdentifier: w.privateKeyIdentifier
    }))
  };

  await writeFile(outputFile, JSON.stringify(output, null, 2));

  console.log(`\n${'='.repeat(80)}`);
  console.log(`Wallet list saved to ${outputFile}`);
  console.log('\nNote: Private keys are encrypted and require Phantom-specific decryption.');
  console.log('Addresses can be used to check balances on Solana explorers like:');
  console.log('  - https://solscan.io/');
  console.log('  - https://explorer.solana.com/');
  console.log('='.repeat(80));
}

main().catch(console.error);
