import { Level } from 'level';
import { decrypt } from '@metamask/browser-passworder';
import { readdir, access } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

const METAMASK_EXTENSION_ID = 'nkbihfbeogaeaoehlefnkodbefgpgknn';

async function getBraveProfilePaths() {
  const platform = process.platform;
  let basePath;

  if (platform === 'darwin') {
    basePath = join(homedir(), 'Library/Application Support/BraveSoftware/Brave-Browser');
  } else if (platform === 'win32') {
    basePath = join(homedir(), 'AppData/Local/BraveSoftware/Brave-Browser/User Data');
  } else if (platform === 'linux') {
    basePath = join(homedir(), '.config/BraveSoftware/Brave-Browser');
  } else {
    throw new Error('Unsupported platform');
  }

  const profiles = [];

  try {
    await access(basePath);
    const entries = await readdir(basePath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === 'Default' || entry.name.startsWith('Profile ')) {
          const metamaskPath = join(basePath, entry.name, 'Local Extension Settings', METAMASK_EXTENSION_ID);
          try {
            await access(metamaskPath);
            profiles.push({
              name: entry.name,
              path: metamaskPath
            });
          } catch (e) {
            // Profile doesn't have MetaMask installed
          }
        }
      }
    }
  } catch (error) {
    console.error('Error accessing Brave browser directory:', error.message);
  }

  return profiles;
}

async function readMetaMaskVault(dbPath) {
  const db = new Level(dbPath);

  try {
    await db.open();

    // Look for the 'data' key which contains the entire MetaMask state
    try {
      const value = await db.get('data');
      let stateData;

      // Parse the value (it might be a string or buffer)
      if (Buffer.isBuffer(value)) {
        stateData = JSON.parse(value.toString('utf8'));
      } else if (typeof value === 'string') {
        stateData = JSON.parse(value);
      } else {
        stateData = value;
      }

      await db.close();

      // Check if KeyringController exists in the state
      if (stateData && stateData.KeyringController) {
        return stateData.KeyringController;
      }

      return null;
    } catch (error) {
      await db.close();
      if (error.code === 'LEVEL_NOT_FOUND') {
        return null;
      }
      throw error;
    }
  } catch (error) {
    try {
      await db.close();
    } catch (e) {
      // Ignore close errors
    }
    throw error;
  }
}

async function decryptVault(vault, password) {
  try {
    const decrypted = await decrypt(password, vault);
    return decrypted;
  } catch (error) {
    throw new Error('Failed to decrypt vault. Incorrect password or corrupted vault.');
  }
}

function extractWalletInfo(decryptedVault) {
  const wallets = [];

  if (Array.isArray(decryptedVault)) {
    for (const keyring of decryptedVault) {
      if (keyring.type === 'HD Key Tree') {
        wallets.push({
          type: 'HD Wallet (Seed Phrase)',
          mnemonic: keyring.data?.mnemonic || 'N/A',
          accounts: keyring.data?.numberOfAccounts || 0
        });
      } else if (keyring.type === 'Simple Key Pair') {
        const privateKeys = keyring.data || [];
        privateKeys.forEach((pk, index) => {
          wallets.push({
            type: 'Imported Account',
            index: index + 1,
            privateKey: pk
          });
        });
      }
    }
  }

  return wallets;
}

async function scanMetaMaskWallets(password) {
  console.log('Scanning for Brave profiles with MetaMask...\n');

  const profiles = await getBraveProfilePaths();

  if (profiles.length === 0) {
    console.log('No Brave profiles with MetaMask found.');
    return;
  }

  console.log(`Found ${profiles.length} profile(s) with MetaMask:\n`);

  for (const profile of profiles) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Profile: ${profile.name}`);
    console.log(`Path: ${profile.path}`);
    console.log('='.repeat(60));

    try {
      const keyringController = await readMetaMaskVault(profile.path);

      if (!keyringController) {
        console.log('No vault data found in this profile.');
        continue;
      }

      if (keyringController.vault) {
        try {
          const decryptedVault = await decryptVault(keyringController.vault, password);
          const wallets = extractWalletInfo(decryptedVault);

          if (wallets.length === 0) {
            console.log('\nNo wallets found in decrypted vault.');
          } else {
            console.log(`\nFound ${wallets.length} wallet(s):\n`);

            wallets.forEach((wallet, index) => {
              console.log(`\nWallet #${index + 1}:`);
              console.log(`Type: ${wallet.type}`);

              if (wallet.mnemonic && wallet.mnemonic !== 'N/A') {
                console.log(`Seed Phrase: ${wallet.mnemonic}`);
                console.log(`Number of Accounts: ${wallet.accounts}`);
              }

              if (wallet.privateKey) {
                console.log(`Private Key: ${wallet.privateKey}`);
              }

              console.log('-'.repeat(50));
            });
          }
        } catch (decryptError) {
          console.error(`\nError decrypting vault: ${decryptError.message}`);
        }
      } else {
        console.log('No encrypted vault found in KeyringController.');
      }
    } catch (error) {
      console.error(`Error reading vault data: ${error.message}`);
    }
  }
}

const password = process.argv[2];

if (!password) {
  console.log('Usage: node index.js <metamask-password>');
  console.log('\nExample:');
  console.log('  node index.js "your-metamask-password"');
  process.exit(1);
}

scanMetaMaskWallets(password)
  .then(() => {
    console.log('\n\nScan complete!');
  })
  .catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  });
