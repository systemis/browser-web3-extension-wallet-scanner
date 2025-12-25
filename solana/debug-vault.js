import { Level } from 'level';
import { readdir, access } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

const PHANTOM_EXTENSION_ID = 'bfnaelmomeimhlpmgjnjophhpkkoljpa';

async function getBraveProfilePaths() {
  const platform = process.platform;
  let basePath;

  if (platform === 'darwin') {
    basePath = join(homedir(), 'Library/Application Support/BraveSoftware/Brave-Browser');
  } else if (platform === 'win32') {
    basePath = join(homedir(), 'AppData/Local/BraveSoftware/Brave-Browser/User Data');
  } else if (platform === 'linux') {
    basePath = join(homedir(), '.config/BraveSoftware/Brave-Browser');
  }

  const profiles = [];
  const entries = await readdir(basePath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name === 'Default' || entry.name.startsWith('Profile ')) {
        const phantomPath = join(basePath, entry.name, 'Local Extension Settings', PHANTOM_EXTENSION_ID);
        try {
          await access(phantomPath);
          profiles.push({ name: entry.name, path: phantomPath });
        } catch (e) {}
      }
    }
  }

  return profiles;
}

async function main() {
  const profiles = await getBraveProfilePaths();
  const profile = profiles[0];

  console.log(`Inspecting: ${profile.name}\n`);

  const db = new Level(profile.path);
  await db.open();

  const vaultKey = '.phantom-labs.vault.accounts';
  try {
    const value = await db.get(vaultKey);
    let parsed;

    if (Buffer.isBuffer(value)) {
      parsed = JSON.parse(value.toString('utf8'));
    } else if (typeof value === 'string') {
      parsed = JSON.parse(value);
    } else {
      parsed = value;
    }

    console.log('Vault Accounts Structure:');
    console.log(JSON.stringify(parsed, null, 2));

    if (parsed.accounts && Array.isArray(parsed.accounts)) {
      console.log(`\n\nFound ${parsed.accounts.length} accounts`);

      parsed.accounts.forEach((account, i) => {
        console.log(`\n--- Account ${i} ---`);
        console.log(`Chains: ${Object.keys(account.chains || {}).join(', ')}`);

        if (account.chains && account.chains.solana) {
          console.log('\nSolana Chain Data:');
          console.log(JSON.stringify(account.chains.solana, null, 2));
        }
      });
    }
  } catch (error) {
    console.error('Error:', error.message);
  }

  await db.close();
}

main().catch(console.error);
