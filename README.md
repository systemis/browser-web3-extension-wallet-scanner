# Multi-Chain Wallet Scanner for Brave/Arc Browser

Scan MetaMask (EVM) and Phantom (Solana) wallets from browser profiles.

## Installation

```bash
npm install
```

## Usage

### EVM Wallets (MetaMask)

```bash
npm run scan "your-password"
```

### Solana Wallets (Phantom)

```bash
npm run scan:solana "your-password"
```

### All Commands

| Command | Description |
|---------|-------------|
| `npm run scan "pw"` | Scan MetaMask (EVM) |
| `npm run scan:solana "pw"` | Scan Phantom (Solana) |
| `npm run filter` | Filter EVM wallets with balance |
| `npm run filter:solana` | Filter Solana wallets with balance |

### Options

Add options after the password:

```bash
npm run scan "pw" --arc        # Scan Arc browser instead of Brave
npm run scan "pw" --force      # Force rescan (ignore cache)
npm run scan "pw" --skip-fetch # View cached results only
```

For Solana with options, use the `-- ` separator:
```bash
npm run scan -- "pw" --solana --arc
```

## Output Files

| Mode | Scan Cache | Filtered Output |
|------|------------|-----------------|
| EVM | `wallet_balances.json` | `wallets_with_balance.json` |
| Solana | `solana_wallet_balances.json` | `solana_wallets_with_balance.json` |

## Supported Networks

**EVM:** Ethereum, BSC, Base, Sei  
**Solana:** Solana Mainnet

## Security Warning

⚠️ Output files contain private keys and mnemonics! Keep secure and never commit to git.

## Project Structure

```
├── scanWithBalances.js    # Main scanner
├── filterWallets.js       # Filter wallets with balance
├── src/
│   ├── evm/              # MetaMask scanning
│   └── solana/           # Phantom scanning
└── package.json
```
