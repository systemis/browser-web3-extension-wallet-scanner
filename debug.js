import { Level } from 'level';
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

async function debugLevelDB(dbPath, profileName) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Debugging Profile: ${profileName}`);
  console.log(`Path: ${dbPath}`);
  console.log('='.repeat(80));

  const db = new Level(dbPath);

  try {
    await db.open();

    console.log('\nAll keys and values in database:\n');

    let count = 0;
    for await (const [key, value] of db.iterator()) {
      count++;
      console.log(`\n--- Entry #${count} ---`);
      console.log(`Key: ${key}`);
      console.log(`Key type: ${typeof key}`);
      console.log(`Key length: ${key.length}`);

      if (Buffer.isBuffer(value)) {
        console.log(`Value type: Buffer`);
        console.log(`Value length: ${value.length}`);

        // Try to parse as string
        try {
          const strValue = value.toString('utf8');
          console.log(`Value as string (first 500 chars):`);
          console.log(strValue.substring(0, 500));

          // Try to parse as JSON
          try {
            const jsonValue = JSON.parse(strValue);
            console.log(`\nValue as JSON (pretty printed):`);
            console.log(JSON.stringify(jsonValue, null, 2).substring(0, 1000));

            // Check for vault-related data
            if (strValue.includes('vault') || strValue.includes('KeyringController')) {
              console.log('\n*** POTENTIAL VAULT DATA FOUND ***');
            }
          } catch (e) {
            console.log('(Not valid JSON)');
          }
        } catch (e) {
          console.log('(Cannot convert to UTF-8 string)');
          console.log(`Value (hex, first 200 bytes): ${value.toString('hex').substring(0, 200)}`);
        }
      } else {
        console.log(`Value type: ${typeof value}`);
        console.log(`Value:`, JSON.stringify(value, null, 2).substring(0, 1000));
      }

      console.log('-'.repeat(80));
    }

    console.log(`\nTotal entries found: ${count}`);

    await db.close();
  } catch (error) {
    console.error(`Error reading database: ${error.message}`);
    console.error(error.stack);
    try {
      await db.close();
    } catch (e) {
      // Ignore close errors
    }
  }
}

async function main() {
  console.log('MetaMask LevelDB Debug Tool\n');

  const profiles = await getBraveProfilePaths();

  if (profiles.length === 0) {
    console.log('No Brave profiles with MetaMask found.');
    return;
  }

  console.log(`Found ${profiles.length} profile(s) with MetaMask\n`);

  // Debug only the first profile (or specific one)
  const profileToDebug = process.argv[2] ?
    profiles.find(p => p.name === process.argv[2]) || profiles[0] :
    profiles[0];

  await debugLevelDB(profileToDebug.path, profileToDebug.name);
}

main().catch(console.error);
