import { Level } from 'level';
import { decrypt } from '@metamask/browser-passworder';
import { readdir, access } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { ethers } from 'ethers';

const METAMASK_EXTENSION_ID = 'nkbihfbeogaeaoehlefnkodbefgpgknn';

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
          const metamaskPath = join(basePath, entry.name, 'Local Extension Settings', METAMASK_EXTENSION_ID);
          try {
            await access(metamaskPath);
            profiles.push({
              name: entry.name,
              path: metamaskPath,
              browser: browser
            });
          } catch (e) {
            // Profile doesn't have MetaMask installed
          }
        }
      }
    }
  } catch (error) {
    console.error(`Error accessing ${browser} browser directory:`, error.message);
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

function extractWalletAddresses(decryptedVault) {
  const addresses = [];

  if (Array.isArray(decryptedVault)) {
    for (const keyring of decryptedVault) {
      if (keyring.type === 'HD Key Tree') {
        // For HD wallets, derive addresses from mnemonic
        if (keyring.data?.mnemonic) {
          const mnemonic = keyring.data.mnemonic;
          const numberOfAccounts = keyring.data.numberOfAccounts || 1;

          try {
            for (let i = 0; i < numberOfAccounts; i++) {
              const path = `m/44'/60'/0'/0/${i}`;
              const wallet = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, path);
              addresses.push({
                type: 'HD Wallet',
                address: wallet.address,
                index: i,
                derivationPath: path,
                mnemonic: mnemonic,
                privateKey: wallet.privateKey
              });
            }
          } catch (error) {
            console.error('Error deriving addresses from mnemonic:', error.message);
          }
        }
      } else if (keyring.type === 'Simple Key Pair') {
        // For imported accounts, derive address from private key
        const privateKeys = keyring.data || [];
        privateKeys.forEach((pk, index) => {
          try {
            const wallet = new ethers.Wallet(pk);
            addresses.push({
              type: 'Imported Account',
              address: wallet.address,
              index: index + 1,
              privateKey: pk
            });
          } catch (error) {
            console.error('Error deriving address from private key:', error.message);
          }
        });
      }
    }
  }

  return addresses;
}

export async function scanAllWallets(password, browser = 'brave') {
  console.log(`Scanning for ${browser.charAt(0).toUpperCase() + browser.slice(1)} profiles with MetaMask...\n`);

  const profiles = await getBrowserProfilePaths(browser);

  if (profiles.length === 0) {
    console.log(`No ${browser.charAt(0).toUpperCase() + browser.slice(1)} profiles with MetaMask found.`);
    return [];
  }

  console.log(`Found ${profiles.length} profile(s) with MetaMask\n`);

  const allWallets = [];

  for (const profile of profiles) {
    console.log(`Scanning profile: ${profile.name}`);

    try {
      const keyringController = await readMetaMaskVault(profile.path);

      if (!keyringController) {
        console.log(`  No vault data found`);
        continue;
      }

      if (keyringController.vault) {
        try {
          const decryptedVault = await decryptVault(keyringController.vault, password);
          const addresses = extractWalletAddresses(decryptedVault);

          console.log(`  Found ${addresses.length} wallet address(es)`);

          addresses.forEach(addr => {
            allWallets.push({
              browser: profile.browser,
              profile: profile.name,
              ...addr
            });
          });
        } catch (decryptError) {
          console.error(`  Error decrypting vault: ${decryptError.message}`);
        }
      } else {
        console.log('  No encrypted vault found');
      }
    } catch (error) {
      console.error(`  Error reading vault data: ${error.message}`);
    }
  }

  return allWallets;
}
