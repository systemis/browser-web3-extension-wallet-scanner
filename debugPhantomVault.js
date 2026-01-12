import { Level } from 'level';
import { decrypt } from '@metamask/browser-passworder';
import { readdir, access } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { writeFile } from 'fs/promises';

const PHANTOM_EXTENSION_ID = 'bfnaelmomeimhlpmgjnjophhpkkoljpa';

const useArc = process.argv.includes('--arc');
const browser = useArc ? 'arc' : 'brave';

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
    throw new Error('Failed to decrypt: ' + error.message);
  }
}

/**
 * Main function
 */
async function main() {
  const extension = process.argv.find(arg => arg.startsWith('password'))
  const password = extension ? extension.split('=')[1] : process.argv[2];

  if (!password || password.startsWith('--')) {
    console.log('Phantom Vault Debug Tool');
    console.log('='.repeat(50));
    console.log('\nUsage: node debugPhantomVault.js <phantom-password> [options]');
    console.log('\nOptions:');
    console.log('  --arc    Use Arc browser instead of Brave');
    console.log('\nThis script shows the structure of Phantom vault data.');
    process.exit(1);
  }

  console.log(`Browser: ${browser.toUpperCase()}\n`);

  const profiles = await getBrowserProfilePaths();

  if (profiles.length === 0) {
    console.log(`No ${browser} profiles with Phantom found.`);
    process.exit(1);
  }

  for (const profile of profiles) {
    console.log('='.repeat(80));
    console.log(`Profile: ${profile.name}`);
    console.log('='.repeat(80));

    try {
      const walletData = await readPhantomVault(profile.path);

      if (!walletData || Object.keys(walletData).length === 0) {
        console.log('  No wallet data found');
        continue;
      }

      console.log(`\nFound ${Object.keys(walletData).length} keys in vault\n`);

      // Show all keys
      console.log('Available keys:');
      for (const key of Object.keys(walletData)) {
        console.log(`  - ${key}`);
      }

      // Show accounts
      const vaultAccountsData = walletData['.phantom-labs.vault.accounts'];
      if (vaultAccountsData && vaultAccountsData.accounts) {
        console.log(`\n${'─'.repeat(80)}`);
        console.log('ACCOUNTS');
        console.log('─'.repeat(80));
        console.log(JSON.stringify(vaultAccountsData.accounts, null, 2));
      }

      // Try to decrypt seeds
      const vaultSeedsKey = '.phantom-labs.vault.seeds';
      const encryptedSeeds = walletData[vaultSeedsKey];

      if (encryptedSeeds) {
        console.log(`\n${'─'.repeat(80)}`);
        console.log('ENCRYPTED SEEDS (before decryption)');
        console.log('─'.repeat(80));
        console.log('Type:', typeof encryptedSeeds);
        console.log('Keys:', Object.keys(encryptedSeeds));
        console.log('Data:', JSON.stringify(encryptedSeeds, null, 2).substring(0, 500));

        try {
          const decryptedSeeds = await decryptPhantomData(encryptedSeeds, password);
          console.log(`\n${'─'.repeat(80)}`);
          console.log('DECRYPTED SEEDS');
          console.log('─'.repeat(80));
          console.log('Type:', typeof decryptedSeeds);
          if (typeof decryptedSeeds === 'object') {
            console.log('Keys:', Object.keys(decryptedSeeds));
            // Don't print full mnemonics for security
            for (const [key, value] of Object.entries(decryptedSeeds)) {
              if (typeof value === 'string' && value.includes(' ')) {
                const words = value.split(' ');
                console.log(`  ${key}: [${words.length} word mnemonic] ${words[0]} ... ${words[words.length - 1]}`);
              } else {
                console.log(`  ${key}:`, value);
              }
            }
          } else {
            console.log('Data:', decryptedSeeds);
          }
        } catch (e) {
          console.log('\nError decrypting seeds:', e.message);
        }
      }

      // Try to decrypt private keys
      const vaultPrivateKeysKey = '.phantom-labs.vault.privateKeys';
      const encryptedPrivateKeys = walletData[vaultPrivateKeysKey];

      if (encryptedPrivateKeys) {
        console.log(`\n${'─'.repeat(80)}`);
        console.log('ENCRYPTED PRIVATE KEYS (before decryption)');
        console.log('─'.repeat(80));
        console.log('Type:', typeof encryptedPrivateKeys);
        console.log('Keys:', Object.keys(encryptedPrivateKeys));
        console.log('Data:', JSON.stringify(encryptedPrivateKeys, null, 2).substring(0, 500));

        try {
          const decryptedPrivateKeys = await decryptPhantomData(encryptedPrivateKeys, password);
          console.log(`\n${'─'.repeat(80)}`);
          console.log('DECRYPTED PRIVATE KEYS');
          console.log('─'.repeat(80));
          console.log('Type:', typeof decryptedPrivateKeys);
          if (typeof decryptedPrivateKeys === 'object') {
            console.log('Keys:', Object.keys(decryptedPrivateKeys));
            // Don't print full private keys for security
            for (const [key, value] of Object.entries(decryptedPrivateKeys)) {
              if (typeof value === 'string') {
                console.log(`  ${key}: [${value.length} chars] ${value.substring(0, 10)}...${value.substring(value.length - 10)}`);
              } else {
                console.log(`  ${key}:`, value);
              }
            }
          } else {
            console.log('Data:', decryptedPrivateKeys);
          }
        } catch (e) {
          console.log('\nError decrypting private keys:', e.message);
        }
      }

      // Save debug output to file
      const debugOutput = {
        profile: profile.name,
        keys: Object.keys(walletData),
        accounts: vaultAccountsData,
        hasSeeds: !!encryptedSeeds,
        hasPrivateKeys: !!encryptedPrivateKeys
      };

      await writeFile(
        `phantom_vault_debug_${profile.name.replace(/\s+/g, '_')}.json`,
        JSON.stringify(debugOutput, null, 2),
        'utf8'
      );

      console.log(`\n✓ Debug output saved to phantom_vault_debug_${profile.name.replace(/\s+/g, '_')}.json`);

    } catch (error) {
      console.error(`  Error: ${error.message}`);
      console.error(error.stack);
    }

    console.log('\n');
  }
}

main().catch((error) => {
  console.error('Error:', error.message);
  console.error(error.stack);
  process.exit(1);
});
