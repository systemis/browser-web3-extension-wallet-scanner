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

async function getBrowserProfilePaths(browser = 'brave') {
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

async function readPhantomVault(dbPath) {
  const db = new Level(dbPath);

  try {
    await db.open();

    // Phantom stores data in LevelDB
    // Try to find wallet data by iterating through all keys
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

        // Store all data that might contain wallet info
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

async function decryptPhantomData(encryptedData, password) {
  try {
    const decrypted = await decrypt(password, encryptedData);
    return decrypted;
  } catch (error) {
    throw new Error('Failed to decrypt data. Incorrect password or corrupted data.');
  }
}

function deriveSolanaKeypairFromMnemonic(mnemonic, accountIndex = 0) {
  // Validate mnemonic
  if (!bip39.validateMnemonic(mnemonic)) {
    throw new Error('Invalid mnemonic');
  }

  // Generate seed from mnemonic
  const seed = bip39.mnemonicToSeedSync(mnemonic, '');

  // Derive path for Solana: m/44'/501'/accountIndex'/0'
  const path = `m/44'/501'/${accountIndex}'/0'`;
  const derivedSeed = derivePath(path, seed.toString('hex')).key;

  // Create keypair from derived seed
  const keypair = Keypair.fromSeed(derivedSeed);

  return {
    publicKey: keypair.publicKey.toBase58(),
    privateKey: bs58.encode(keypair.secretKey)
  };
}

async function extractWalletAddresses(walletData, password) {
  const wallets = [];
  const seenAddresses = new Set();

  try {
    // Step 1: Get the vault accounts (NOT encrypted in newer Phantom versions)
    const vaultAccountsData = walletData['.phantom-labs.vault.accounts'];
    if (!vaultAccountsData || !vaultAccountsData.accounts) {
      console.log('  No vault accounts found');
      return wallets;
    }

    // Step 2: Extract account data
    const accounts = vaultAccountsData.accounts;

    for (let accountIndex = 0; accountIndex < accounts.length; accountIndex++) {
      const account = accounts[accountIndex];

      try {
        // Check account type
        if (account.type === 'seed') {
          // HD Wallet - check for Solana chain ONLY
          if (account.chains && account.chains.solana) {
            const solanaPublicKey = account.chains.solana.publicKey;

            // Validate it's a Solana address (base58, typically 32-44 chars, no 0x prefix)
            if (solanaPublicKey && !solanaPublicKey.startsWith('0x') && solanaPublicKey.length >= 32 && solanaPublicKey.length <= 44) {
              if (!seenAddresses.has(solanaPublicKey)) {
                seenAddresses.add(solanaPublicKey);
                wallets.push({
                  type: 'HD Wallet',
                  address: solanaPublicKey,
                  index: accountIndex,
                  derivationIndex: account.derivationIndex || 0,
                  seedIdentifier: account.seedIdentifier,
                  privateKey: null, // Encrypted - needs password
                  mnemonic: null // Encrypted - needs password
                });
              }
            }
          }
          // Skip EVM chains from Phantom (account.chains.ethereum, etc.)
        } else if (account.type === 'privateKey' && account.chainType === 'solana') {
          // Imported Solana account - must be explicitly chainType: 'solana'
          const publicKey = account.publicKey;

          // Validate it's a Solana address
          if (publicKey && !publicKey.startsWith('0x') && publicKey.length >= 32 && publicKey.length <= 44) {
            if (!seenAddresses.has(publicKey)) {
              seenAddresses.add(publicKey);
              wallets.push({
                type: 'Imported Account',
                address: publicKey,
                index: accountIndex,
                privateKeyIdentifier: account.privateKeyIdentifier,
                identifier: account.identifier,
                privateKey: null, // Encrypted - needs password
                mnemonic: null
              });
            }
          }
        }
        // Ignore any other account types (EVM accounts in Phantom)
      } catch (error) {
        console.error(`  Error processing account ${accountIndex}:`, error.message);
      }
    }
  } catch (error) {
    console.error(`  Error extracting wallet addresses: ${error.message}`);
  }

  return wallets;
}

export async function scanAllWallets(password, browser = 'brave') {
  console.log(`Scanning for ${browser.charAt(0).toUpperCase() + browser.slice(1)} profiles with Phantom...\n`);

  const profiles = await getBrowserProfilePaths(browser);

  if (profiles.length === 0) {
    console.log(`No ${browser.charAt(0).toUpperCase() + browser.slice(1)} profiles with Phantom found.`);
    return [];
  }

  console.log(`Found ${profiles.length} profile(s) with Phantom\n`);

  const allWallets = [];

  for (const profile of profiles) {
    console.log(`Scanning profile: ${profile.name}`);

    try {
      const walletData = await readPhantomVault(profile.path);

      if (!walletData || Object.keys(walletData).length === 0) {
        console.log(`  No wallet data found`);
        continue;
      }

      // Extract addresses from wallet data (handles decryption internally)
      const addresses = await extractWalletAddresses(walletData, password);

      console.log(`  Found ${addresses.length} wallet address(es)`);

      addresses.forEach(addr => {
        allWallets.push({
          browser: profile.browser,
          profile: profile.name,
          ...addr
        });
      });
    } catch (error) {
      console.error(`  Error reading wallet data: ${error.message}`);
    }
  }

  return allWallets;
}
