# MetaMask Wallet Scanner for Brave Browser

This tool scans all Brave browser profiles on your system, extracts MetaMask wallets, and fetches their balances across multiple blockchain networks.

## Features

- **Wallet Scanning:**
  - Automatically detects all Brave browser profiles
  - Locates MetaMask extension data in each profile
  - Decrypts MetaMask vault using your password
  - Extracts all wallet addresses (HD wallets and imported accounts)

- **Balance Fetching:**
  - Fetches native token balances (ETH, BNB, SEI)
  - Retrieves ERC-20 token balances
  - Lists NFT collections and counts
  - Calculates total USD value per wallet
  - Supports multiple networks: Ethereum, BSC, Base, Sei

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
npm run scan "your-metamask-password"
```

This will:
1. Scan all Brave profiles for MetaMask wallets
2. Extract wallet addresses
3. Check for existing cached data and resume if found
4. Fetch balances on Ethereum, BSC, Base, and Sei networks (skips already cached wallets)
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
- Filter wallets with any balance (native, ERC-20, or NFTs)
- Remove duplicate addresses (keeps the one with most data)
- Include private keys and mnemonics for each wallet
- Sort by total USD value (highest first)
- Save results to `wallets_with_balance.json`
- Display a summary with private keys

**Important:** The filtered output includes sensitive private keys and mnemonics. Keep `wallets_with_balance.json` secure!

### Basic Wallet Scan (No Balances)

Extract just the seed phrases and private keys:

```bash
npm start "your-metamask-password"
```

## Output

### Balance Scan Output

The balance scanner displays:
- Profile name and wallet type
- Wallet address
- Total USD value per wallet
- Native token balances with USD values
- ERC-20 token holdings
- NFT collections and counts
- Total portfolio value across all wallets
- **Includes private keys and mnemonics for each wallet**

### Filter Output

The filter script creates `wallets_with_balance.json` containing:
- Only unique wallets with balance > 0
- Complete private key/mnemonic for each wallet
- Detailed balance breakdown by network
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
      "address": "0x...",
      "type": "HD Wallet",
      "mnemonic": "word1 word2 ...",
      "privateKey": "0x...",
      "totalUSD": 500.00,
      "balances": { ... }
    }
  ]
}
```

### Basic Scan Output

The basic scanner shows:
- All Brave profiles that have MetaMask installed
- HD wallets with seed phrases and account counts
- Imported accounts with private keys

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

The script automatically detects MetaMask data at:

- **macOS**: `~/Library/Application Support/BraveSoftware/Brave-Browser/[Profile]/Local Extension Settings/`
- **Windows**: `%LOCALAPPDATA%/BraveSoftware/Brave-Browser/User Data/[Profile]/Local Extension Settings/`
- **Linux**: `~/.config/BraveSoftware/Brave-Browser/[Profile]/Local Extension Settings/`

## Supported Networks

- **Ethereum** (ETH) - Mainnet
- **Binance Smart Chain** (BNB) - BSC Mainnet
- **Base** (ETH) - Base Mainnet
- **Sei** (SEI) - Sei EVM

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
      "address": "0x...",
      "totalUSD": 123.45,
      "balances": {
        "ethereum": {
          "native": { "symbol": "ETH", "balance": "0.5", "usd": 100.0 },
          "erc20Tokens": [...],
          "nfts": [...]
        }
      }
    }
  ]
}
```

**Incremental Saving:** The cache file is updated after each wallet is scanned. This means:
- If the scan is interrupted, you won't lose progress
- Running the scan again will automatically resume from where it stopped
- Use `--force` to ignore the cache and rescan everything

## Troubleshooting

**No profiles found:**
- Make sure Brave browser is installed
- Ensure MetaMask extension is installed in at least one profile

**Decryption failed:**
- Verify you're using the correct MetaMask password
- Make sure Brave is closed before running the scanner

**Permission errors:**
- On macOS, you might need to grant Terminal full disk access in System Preferences

**API rate limiting:**
- The script includes delays between requests
- If you encounter rate limits, wait a few minutes and try again
- Use `--skip-fetch` to view cached results

**No balances showing:**
- Check your internet connection
- Some networks may be slow to respond
- Block explorer APIs may have rate limits

**Scan was interrupted:**
- Don't worry! Your progress is saved after each wallet
- Simply run the same command again to resume
- Already scanned wallets will be loaded from cache
- Use `--force` if you want to start fresh

## Quick Start Guide

Complete workflow to scan and filter wallets:

```bash
# 1. Install dependencies
npm install

# 2. Scan all wallets and fetch balances (close Brave first!)
npm run scan "your-metamask-password"

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
1. Find all MetaMask wallets across all Brave profiles
2. Extract addresses, private keys, and mnemonics
3. Fetch balances on 4 networks (Ethereum, BSC, Base, Sei)
4. Calculate total USD values
5. Filter to unique wallets with balance > 0
6. Sort by value (highest first)
7. Output everything to `wallets_with_balance.json`
