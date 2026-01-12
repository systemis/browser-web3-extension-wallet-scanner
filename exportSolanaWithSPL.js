import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { Level } from 'level';
import { decrypt } from '@metamask/browser-passworder';
import { readdir, access } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { derivePath } from 'ed25519-hd-key';
import * as bip39 from 'bip39';

const PHANTOM_EXTENSION_ID = 'bfnaelmomeimhlpmgjnjophhpkkoljpa';

// Chain type detection
const useArc = process.argv.includes('--arc');
const browser = useArc ? 'arc' : 'brave';

function getInputFileName() {
  const browserSuffix = useArc ? '_arc' : '';
  return `solana_wallet_balances${browserSuffix}.json`;
}

function getOutputFileName() {
  const browserSuffix = useArc ? '_arc' : '';
  return `solana_wallets_with_spl${browserSuffix}.json`;
}

const INPUT_FILE = getInputFileName();
const OUTPUT_FILE = getOutputFileName();

/**
 * Get browser profile paths
 */
async function getBrowserProfilePaths() {
  const platform = process.platform;
  let basePath;

  if (browser === 'brave') {
    if (platform === 'darwin') {
      basePath = join(homedir(), 'Library/Application Support/BraveSoftware/Brave-Browser');
    } else if (platform === 'win32') {
      basePath = join(homedir(), 'AppData/Local/BraveSoftware/Brave-Browser/User Data');
    } else if (platform === 'linux') {
      basePath = join(homedir(), '.config/BraveSoftware/Brave-Browser');
    }
  } else if (browser === 'arc') {
    if (platform === 'darwin') {
      basePath = join(homedir(), 'Library/Application Support/Arc/User Data');
    } else if (platform === 'win32') {
      basePath = join(homedir(), 'AppData/Local/Arc/User Data');
    } else if (platform === 'linux') {
      basePath = join(homedir(), '.config/Arc/User Data');
    }
  }

  if (!basePath) {
    throw new Error('Unsupported platform or browser');
  }

  const profiles = [];

  try {
    await access(basePath);
    const entries = await readdir(basePath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === 'Default' || entry.name.startsWith('Profile ')) {
          const phantomPath = join(basePath, entry.name, 'Local Extension Settings', PHANTOM_EXTENSION_ID);
          try {
            await access(phantomPath);
            profiles.push({
              name: entry.name,
              path: phantomPath,
              browser: browser
            });
          } catch (e) {
            // Profile doesn't have Phantom installed
          }
        }
      }
    }
  } catch (error) {
    console.error(`Error accessing ${browser} browser directory:`, error.message);
  }

  return profiles;
}

/**
 * Read Phantom vault
 */
async function readPhantomVault(dbPath) {
  const db = new Level(dbPath);

  try {
    await db.open();

    const walletData = {};

    for await (const [key, value] of db.iterator()) {
      try {
        let parsedValue;

        if (Buffer.isBuffer(value)) {
          parsedValue = JSON.parse(value.toString('utf8'));
        } else if (typeof value === 'string') {
          parsedValue = JSON.parse(value);
        } else {
          parsedValue = value;
        }

        walletData[key] = parsedValue;
      } catch (e) {
        // Skip non-JSON values
      }
    }

    await db.close();
    return walletData;
  } catch (error) {
    try {
      await db.close();
    } catch (e) {
      // Ignore close errors
    }
    throw error;
  }
}

/**
 * Decrypt Phantom data
 */
async function decryptPhantomData(encryptedData, password) {
  try {
    const decrypted = await decrypt(password, encryptedData);
    return decrypted;
  } catch (error) {
    throw new Error('Failed to decrypt data. Incorrect password or corrupted data.');
  }
}

/**
 * Derive Solana keypair from mnemonic
 */
function deriveSolanaKeypairFromMnemonic(mnemonic, accountIndex = 0) {
  if (!bip39.validateMnemonic(mnemonic)) {
    throw new Error('Invalid mnemonic');
  }

  const seed = bip39.mnemonicToSeedSync(mnemonic, '');
  const path = `m/44'/501'/${accountIndex}'/0'`;
  const derivedSeed = derivePath(path, seed.toString('hex')).key;
  const keypair = Keypair.fromSeed(derivedSeed);

  return {
    publicKey: keypair.publicKey.toBase58(),
    privateKey: bs58.encode(keypair.secretKey),
    derivationPath: path
  };
}

/**
 * Extract wallet credentials with private keys
 */
async function extractWalletCredentials(walletData, password, targetAddresses) {
  const walletCredentials = new Map();

  try {
    // Get vault accounts
    const vaultAccountsData = walletData['.phantom-labs.vault.accounts'];
    if (!vaultAccountsData || !vaultAccountsData.accounts) {
      return walletCredentials;
    }

    const accounts = vaultAccountsData.accounts;

    // Process each account
    for (let accountIndex = 0; accountIndex < accounts.length; accountIndex++) {
      const account = accounts[accountIndex];

      try {
        if (account.type === 'seed' && account.chains && account.chains.solana) {
          const solanaPublicKey = account.chains.solana.publicKey;

          // Check if this address is in our target list
          if (targetAddresses.has(solanaPublicKey.toLowerCase())) {
            // Get the encrypted mnemonic for this seed
            const seedKey = `.phantom-labs.vault.seed.${account.seedIdentifier}`;
            const encryptedSeed = walletData[seedKey];

            if (encryptedSeed) {
              try {
                const mnemonic = await decryptPhantomData(encryptedSeed, password);
                const derivationIndex = account.derivationIndex || 0;
                const keypair = deriveSolanaKeypairFromMnemonic(mnemonic, derivationIndex);

                walletCredentials.set(solanaPublicKey.toLowerCase(), {
                  address: solanaPublicKey,
                  type: 'HD Wallet',
                  mnemonic: mnemonic,
                  privateKey: keypair.privateKey,
                  derivationPath: keypair.derivationPath,
                  derivationIndex: derivationIndex
                });
              } catch (e) {
                console.error(`    Error decrypting seed for ${solanaPublicKey.substring(0, 8)}:`, e.message);
              }
            }
          }
        } else if (account.type === 'privateKey' && account.chainType === 'solana') {
          const publicKey = account.publicKey;

          // Check if this address is in our target list
          if (targetAddresses.has(publicKey.toLowerCase())) {
            // Get the encrypted private key for this account
            const privateKeyKey = `.phantom-labs.vault.privateKey.${account.privateKeyIdentifier}`;
            const encryptedPrivateKey = walletData[privateKeyKey];

            if (encryptedPrivateKey) {
              try {
                const privateKeyHex = await decryptPhantomData(encryptedPrivateKey, password);

                // Convert hex private key to base58
                const privateKeyBytes = Buffer.from(privateKeyHex, 'hex');
                const keypair = Keypair.fromSecretKey(privateKeyBytes);
                const privateKeyBase58 = bs58.encode(keypair.secretKey);

                walletCredentials.set(publicKey.toLowerCase(), {
                  address: publicKey,
                  type: 'Imported Account',
                  privateKey: privateKeyBase58
                });
              } catch (e) {
                console.error(`    Error decrypting private key for ${publicKey.substring(0, 8)}:`, e.message);
              }
            }
          }
        }
      } catch (error) {
        console.error(`    Error processing account ${accountIndex}:`, error.message);
      }
    }
  } catch (error) {
    console.error(`    Error extracting wallet credentials: ${error.message}`);
  }

  return walletCredentials;
}

/**
 * Check if wallet has SPL tokens
 */
function hasSPLTokens(wallet) {
  return wallet.balances &&
    wallet.balances.splTokens &&
    Array.isArray(wallet.balances.splTokens) &&
    wallet.balances.splTokens.length > 0;
}

/**
 * Main function
 */
async function main() {
  const extension = process.argv.find(arg => arg.startsWith('password'))
  const password = extension ? extension.split('=')[1] : process.argv[2];

  if (!password || password.startsWith('--')) {
    console.log('Solana Wallet Exporter - Wallets with SPL Tokens');
    console.log('='.repeat(50));
    console.log('\nUsage: node exportSolanaWithSPL.js <phantom-password> [options]');
    console.log('\nOptions:');
    console.log('  --arc    Use Arc browser instead of Brave');
    console.log('\nThis script exports wallets that have SPL tokens with their private keys.');
    console.log('\nExample:');
    console.log('  node exportSolanaWithSPL.js "your-password"');
    console.log('  node exportSolanaWithSPL.js "your-password" --arc');
    process.exit(1);
  }

  console.log(`Browser: ${browser.toUpperCase()}`);
  console.log(`Input file: ${INPUT_FILE}`);
  console.log(`Output file: ${OUTPUT_FILE}\n`);

  // Check if input file exists
  if (!existsSync(INPUT_FILE)) {
    console.error(`Error: ${INPUT_FILE} not found.`);
    console.log('\nPlease run the balance scan first:');
    console.log('  node scanWithBalances.js "your-password" --solana');
    if (useArc) {
      console.log('  (add --arc for Arc browser)');
    }
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

  console.log(`Total wallets: ${input.wallets.length}`);

  // Filter wallets with SPL tokens
  const walletsWithSPL = input.wallets.filter(hasSPLTokens);

  if (walletsWithSPL.length === 0) {
    console.log('\nNo wallets with SPL tokens found.');
    process.exit(0);
  }

  console.log(`Wallets with SPL tokens: ${walletsWithSPL.length}\n`);

  // Create set of target addresses
  const targetAddresses = new Set(
    walletsWithSPL.map(w => w.address.toLowerCase())
  );

  // Get browser profiles
  console.log('Scanning browser profiles for wallet credentials...\n');
  const profiles = await getBrowserProfilePaths();

  if (profiles.length === 0) {
    console.log(`No ${browser} profiles with Phantom found.`);
    process.exit(1);
  }

  // Extract credentials for target wallets
  const allCredentials = new Map();

  for (const profile of profiles) {
    console.log(`Scanning profile: ${profile.name}`);

    try {
      const walletData = await readPhantomVault(profile.path);

      if (!walletData || Object.keys(walletData).length === 0) {
        console.log('  No wallet data found');
        continue;
      }

      const credentials = await extractWalletCredentials(walletData, password, targetAddresses);

      console.log(`  Found credentials for ${credentials.size} wallet(s)`);

      // Merge credentials
      for (const [address, cred] of credentials) {
        allCredentials.set(address, { ...cred, profile: profile.name });
      }
    } catch (error) {
      console.error(`  Error: ${error.message}`);
    }
  }

  console.log(`\nTotal credentials extracted: ${allCredentials.size}\n`);

  // Merge credentials with wallet data
  const exportWallets = [];
  let walletsWithCredentials = 0;
  let walletsWithoutCredentials = 0;

  for (const wallet of walletsWithSPL) {
    const credentials = allCredentials.get(wallet.address.toLowerCase());

    const exportWallet = {
      address: wallet.address,
      profile: wallet.profile,
      type: wallet.type,
      totalUSD: wallet.totalUSD || 0,
      balances: {
        sol: wallet.balances.sol,
        splTokens: wallet.balances.splTokens.map(token => ({
          symbol: token.symbol || 'UNKNOWN',
          name: token.name || 'Unknown Token',
          balance: token.balance,
          mint: token.mint,
          usd: token.usd || null,
          price: token.price || null
        }))
      }
    };

    if (credentials) {
      exportWallet.mnemonic = credentials.mnemonic || null;
      exportWallet.privateKey = credentials.privateKey;
      exportWallet.derivationPath = credentials.derivationPath || null;
      exportWallet.derivationIndex = credentials.derivationIndex || null;
      walletsWithCredentials++;
    } else {
      exportWallet.privateKey = null;
      exportWallet.mnemonic = null;
      exportWallet.note = 'Private key not found - wallet may be from different profile or password';
      walletsWithoutCredentials++;
    }

    exportWallets.push(exportWallet);
  }

  // Sort by USD value
  exportWallets.sort((a, b) => (b.totalUSD || 0) - (a.totalUSD || 0));

  // Create output
  const output = {
    generatedAt: new Date().toISOString(),
    originalScanDate: input.scanDate,
    browser: browser,
    totalWalletsWithSPL: exportWallets.length,
    walletsWithPrivateKeys: walletsWithCredentials,
    walletsWithoutPrivateKeys: walletsWithoutCredentials,
    totalPortfolioUSD: exportWallets.reduce((sum, w) => sum + (w.totalUSD || 0), 0),
    wallets: exportWallets
  };

  // Save to output file
  await writeFile(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf8');

  console.log('='.repeat(80));
  console.log('EXPORT SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total wallets with SPL tokens: ${output.totalWalletsWithSPL}`);
  console.log(`Wallets with private keys: ${walletsWithCredentials}`);
  console.log(`Wallets without private keys: ${walletsWithoutCredentials}`);
  console.log(`Total portfolio value: $${output.totalPortfolioUSD.toFixed(2)}`);
  console.log('='.repeat(80));

  console.log(`\n✓ Export complete! Check ${OUTPUT_FILE} for detailed results.`);
  console.log('\n⚠️  WARNING: This file contains private keys. Keep it secure!');
}

main().catch((error) => {
  console.error('Error:', error.message);
  console.error(error.stack);
  process.exit(1);
});
