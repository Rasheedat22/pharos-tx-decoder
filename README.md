# Pharos Transaction Decoder

An [Agent Skill](https://agentskills.io) that decodes any transaction on the [Pharos Network](https://www.pharos.xyz) into a clear, human-readable summary. Built for the **Pharos Agent Center Skill Builder Campaign**.

Stop staring at indecipherable hex. Paste any Pharos tx hash and the skill tells you:
- Whether it succeeded or reverted
- Who sent it, to whom, with what value and gas
- **Exactly which function was called and with what arguments**
- **Every event that fired, decoded by name**
- A direct link to the explorer

## Why it's different

Most explorers only decode calls and events for **verified** contracts. This skill works on **any** transaction — verified or not — by combining three data sources:

1. The transaction itself (via Pharos RPC)
2. The public **OpenChain** signature database (free, no key required)
3. *Optionally* the SocialScan verified-contract ABI database (more accurate when available)

That means you get a useful decoded report even when the target contract hasn't been verified yet.

## How it works

### Tier 1 — RPC + OpenChain (always works, no setup)

- Fetches the transaction and its receipt from Pharos
- Pulls out the function selector (first 4 bytes of input)
- Looks up the matching function signature from OpenChain's free public database
- Decodes the arguments using viem
- Does the same for every event log

### Tier 2 — Verified ABI (with API key)

If you set `SOCIALSCAN_API_KEY`, the skill:
- Checks if the target contract is verified on Pharosscan
- Pulls the full ABI
- Uses the ABI to decode the call and events with original parameter names
- Includes the contract name in the report

Get a free key at https://developer.socialscan.io.

## Installation

```bash
git clone https://github.com/<your-username>/pharos-tx-decoder.git
cd pharos-tx-decoder
npm install
```

Requires Node.js 18+.

## Usage

### Tier 1 only

```bash
node scripts/decode_tx.js <txHash> [mainnet|testnet]
```

### Tier 1 + Tier 2

```bash
export SOCIALSCAN_API_KEY=your_key_here
node scripts/decode_tx.js <txHash> mainnet
```

## Example output

```
Transaction:    0xabc123...
Status:         Success
Block:          #1234567
Timestamp:      2026-05-25 18:42:11 UTC
Network:        Pharos Pacific Ocean Mainnet
From:           0x1234...
To:             0x5678... (USDC)

— Value & gas —
Value sent:     0.0 PROS
Gas used:       52,318 / 80,000
Gas price:      1.25 gwei
Total cost:     0.00006539 PROS

— Function call —
Function:       transfer(address,uint256)
Source:         verified ABI
  to:           0xabcd1234...
  amount:       1000000

— Events emitted (1) —
1. Transfer(address,address,uint256)
   from:        0x1234...
   to:          0xabcd...
   value:       1000000

Explorer:       https://pharosscan.xyz/tx/0xabc123...
```

## Using as an Agent Skill

This repo follows the [open Agent Skills format](https://agentskills.io/specification):

```
pharos-tx-decoder/
├── SKILL.md
├── scripts/
│   └── decode_tx.js
├── package.json
└── README.md
```

Agents compatible with Pharos Agent Center (Claude Code, Codex, OpenClaw, etc.) load `SKILL.md` automatically and trigger this skill when the user asks about a transaction.

Example agent prompts that trigger it:
- "What did transaction 0x123... do?"
- "Decode this Pharos tx for me"
- "Explain what happened in 0xabc..."

## Network details

| Network | Chain ID | RPC | Explorer |
|---|---|---|---|
| Mainnet | 1672 | `https://rpc.pharos.xyz` | `https://pharosscan.xyz` |
| Atlantic Testnet | 688689 | `https://atlantic.dplabs-internal.com` | `https://atlantic.pharosscan.xyz` |

## Data sources

- **Pharos RPC** for transaction and receipt data
- **OpenChain** ([openchain.xyz](https://openchain.xyz)) for the free 4-byte signature database
- **SocialScan** ([socialscan.io](https://socialscan.io)) for verified contract ABIs (optional)

## License

MIT
