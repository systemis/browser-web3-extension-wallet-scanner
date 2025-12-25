# Phantom Wallet Scanner for Brave Browser

This tool scans all Brave browser profiles on your system, extracts Phantom wallets, and fetches their Solana balances.

## Features

- **Wallet Scanning:**
  - Automatically detects all Brave browser profiles
  - Locates Phantom extension data in each profile
  - Decrypts Phantom vault using your password
  - Extracts all wallet addresses (HD wallets and imported accounts)

- **Balance Fetching:**
  - Fetches native SOL balance
  - Retrieves SPL token balances
  - Lists NFT collections and counts
  - Calculates total USD value per wallet
  - Uses Solana mainnet RPC

- **Caching:**
  - Saves results to `wallet_balances.json`
  - Can load cached results without re-scanning
  - Prevents rate limiting by reusing data

- **Cross-platform support:** macOS, Windows, Linux

## Installation

```bash
npm install
```

## Usage

### Scan Wallets with Balance Checking

This is the main feature that scans all wallets and fetches their balances:

```bash
npm run scan "your-phantom-password"
```

This will:
1. Scan all Brave profiles for Phantom wallets
2. Extract wallet addresses
3. Check for existing cached data and resume if found
4. Fetch balances on Solana mainnet
5. **Save data after each wallet** to prevent data loss
6. Calculate total USD values
7. Display a comprehensive summary

**Important:** The scanner saves data incrementally after each wallet is scanned. If the scan is interrupted (error, network issue, Ctrl+C), you can simply run the command again and it will resume from where it left off.

### Force Rescan All Wallets

Ignore cache and fetch fresh data for all wallets:

```bash
npm run scan "your-password" --force
```

### View Cached Results

Load previously scanned results without fetching new data:

```bash
npm run scan "your-password" --skip-fetch
```

### Filter Wallets with Balance

After scanning, filter to show only unique wallets that have balance > 0:

```bash
npm run filter
```

This will:
- Read from `wallet_balances.json`
- Filter wallets with any balance (SOL, SPL tokens, or NFTs)
- Remove duplicate addresses (keeps the one with most data)
- Include private keys and mnemonics for each wallet
- Sort by total USD value (highest first)
- Save results to `wallets_with_balance.json`
- Display a summary with private keys

**Important:** The filtered output includes sensitive private keys and mnemonics. Keep `wallets_with_balance.json` secure!

### Debug Mode

Inspect the raw LevelDB data to understand Phantom's storage structure:

```bash
npm run debug
```

## Output

### Balance Scan Output

The balance scanner displays:
- Profile name and wallet type
- Wallet address (Solana public key)
- Total USD value per wallet
- SOL balance with USD value
- SPL token holdings
- NFT collections and counts
- **Includes private keys and mnemonics for each wallet**

### Filter Output

The filter script creates `wallets_with_balance.json` containing:
- Only unique wallets with balance > 0
- Complete private key/mnemonic for each wallet
- Detailed balance breakdown (SOL, tokens, NFTs)
- Sorted by total USD value
- Summary statistics

Example output structure:
```json
{
  "generatedAt": "2025-12-24T...",
  "walletsWithBalance": 5,
  "totalPortfolioUSD": 1234.56,
  "wallets": [
    {
      "walletNumber": 1,
      "address": "ABC123...",
      "type": "HD Wallet",
      "mnemonic": "word1 word2 ...",
      "privateKey": "base58-encoded-key",
      "totalUSD": 500.00,
      "balances": {
        "sol": { ... },
        "splTokens": [ ... ],
        "nfts": [ ... ]
      }
    }
  ]
}
```

## Security Warning

This tool handles sensitive cryptographic material (seed phrases and private keys).

**Important:**
- **CRITICAL:** `wallet_balances.json` and `wallets_with_balance.json` contain private keys and mnemonics
- Keep these files secure and encrypted
- Never commit these files to git (they're in .gitignore)
- Never share your seed phrase or private keys with anyone
- Run this tool only on your own computer
- Delete these files after use or store them in an encrypted volume
- Anyone with access to these files can steal all your crypto assets

## Platform-Specific Paths

The script automatically detects Phantom data at:

- **macOS**: `~/Library/Application Support/BraveSoftware/Brave-Browser/[Profile]/Local Extension Settings/`
- **Windows**: `%LOCALAPPDATA%/BraveSoftware/Brave-Browser/User Data/[Profile]/Local Extension Settings/`
- **Linux**: `~/.config/BraveSoftware/Brave-Browser/[Profile]/Local Extension Settings/`

Phantom Extension ID: `bfnaelmomeimhlpmgjnjophhpkkoljpa`

## Cache File

Results are saved to `wallet_balances.json` with the following structure:

```json
{
  "scanDate": "2025-12-24T...",
  "lastUpdate": "2025-12-24T...",
  "totalWallets": 5,
  "scannedWallets": 5,
  "totalPortfolioUSD": 1234.56,
  "wallets": [
    {
      "profile": "Default",
      "type": "HD Wallet",
      "address": "ABC123...",
      "totalUSD": 123.45,
      "mnemonic": "word1 word2 ...",
      "privateKey": "base58...",
      "balances": {
        "sol": { "symbol": "SOL", "balance": "0.5", "usd": 100.0 },
        "splTokens": [...],
        "nfts": [...]
      }
    }
  ]
}
```

**Incremental Saving:** The cache file is updated after each wallet is scanned. This means:
- If the scan is interrupted, you won't lose progress
- Running the scan again will automatically resume from where it stopped
- Use `--force` to ignore the cache and rescan everything

## Solana Network Details

- **Network:** Solana Mainnet
- **RPC Endpoints:**
  - `https://api.mainnet-beta.solana.com` (primary)
  - `https://solana-api.projectserum.com` (fallback)
  - `https://rpc.ankr.com/solana` (fallback)
- **Native Token:** SOL
- **Token Standard:** SPL (Solana Program Library)
- **NFT Standard:** Metaplex

## Troubleshooting

**No profiles found:**
- Make sure Brave browser is installed
- Ensure Phantom extension is installed in at least one profile

**Decryption failed:**
- Verify you're using the correct Phantom password
- Make sure Brave is closed before running the scanner
- Phantom's data structure may differ from MetaMask

**Permission errors:**
- On macOS, you might need to grant Terminal full disk access in System Preferences

**RPC rate limiting:**
- The script includes delays between requests
- If you encounter rate limits, wait a few minutes and try again
- Use `--skip-fetch` to view cached results

**No balances showing:**
- Check your internet connection
- Solana RPC nodes may be slow to respond
- Try again after a few minutes

**Scan was interrupted:**
- Don't worry! Your progress is saved after each wallet
- Simply run the same command again to resume
- Already scanned wallets will be loaded from cache
- Use `--force` if you want to start fresh

**No wallets found:**
- Phantom stores data differently from MetaMask
- The scanner may need manual configuration for your setup
- Try running `npm run debug` to inspect the raw database
- Check if Phantom is properly installed and has wallets created

## Quick Start Guide

Complete workflow to scan and filter Phantom wallets:

```bash
# 1. Install dependencies
npm install

# 2. Scan all wallets and fetch balances (close Brave first!)
npm run scan "your-phantom-password"

# 3. Filter to show only wallets with balance
npm run filter

# 4. Check the output file
cat wallets_with_balance.json

# 5. IMPORTANT: Secure or delete the sensitive files
# The following files contain private keys:
# - wallet_balances.json
# - wallets_with_balance.json
```

The complete process will:
1. Find all Phantom wallets across all Brave profiles
2. Extract addresses, private keys, and mnemonics
3. Fetch balances on Solana mainnet
4. Calculate total USD values
5. Filter to unique wallets with balance > 0
6. Sort by value (highest first)
7. Output everything to `wallets_with_balance.json`

## Notes

- Phantom wallet data extraction is more complex than MetaMask
- The password decryption may work differently depending on Phantom version
- If automatic extraction fails, use the debug tool to inspect the database
- Solana addresses are base58-encoded (different from Ethereum's hex format)
- Private keys are also base58-encoded in Solana
- HD wallet derivation uses path: `m/44'/501'/accountIndex'/0'` (501 is Solana's coin type)

## Differences from MetaMask Scanner

1. **Address Format:** Solana uses base58 instead of hex (0x...)
2. **Derivation Path:** `m/44'/501'/x'/0'` instead of `m/44'/60'/0'/0/x`
3. **Network:** Single chain (Solana) instead of multiple EVM chains
4. **Tokens:** SPL tokens instead of ERC-20
5. **NFTs:** Metaplex standard instead of ERC-721/1155
6. **Data Structure:** Phantom's storage may be different from MetaMask's

## Support

If the scanner cannot find your wallets:
1. Run `npm run debug` to see the raw database structure
2. Check if Phantom is installed and has active wallets
3. Ensure you're using the correct password
4. Close Brave before scanning
5. Check the Phantom extension ID is correct for your version
