---
name: pharos-tx-decoder
description: Decode any transaction on the Pharos Network into a plain-English explanation. Given a transaction hash, this skill fetches the on-chain data, identifies the function that was called and its arguments, decodes all emitted events, and produces a clear summary of what the transaction actually did. Works for transfers, swaps, contract deployments, NFT mints, approvals, and any other on-chain action. Use whenever a user asks "what did this transaction do", "explain this tx", "decode 0x...", "what happened in this transaction", or pastes a Pharos transaction hash and wants to understand it.
license: MIT
---

# Pharos Transaction Decoder

A two-tier Agent Skill that turns any Pharos transaction hash into a clear, human-readable explanation.

**Tier 1 (always works, no setup):** Fetches the transaction and its receipt, decodes the function call using the public OpenChain signature database, decodes all event logs, and formats a complete summary.

**Tier 2 (optional, with API key):** When the target contract is verified, fetches its full ABI from SocialScan for more accurate decoding — including custom event names and structured parameter types.

## When to use

Use this skill when the user wants to:
- Understand what a transaction did on Pharos
- Decode the input data of a contract call
- See which events fired during a transaction
- Verify whether a transaction succeeded or reverted
- Inspect a NFT mint, token transfer, swap, or approval
- Audit suspicious transactions

## Inputs

1. **Transaction hash** — a 0x-prefixed 66-character hex string

Optional:
- **Network** — `mainnet` (default, chain 1672) or `testnet` (chain 688689 Atlantic)
- **SOCIALSCAN_API_KEY** environment variable — unlocks accurate ABI-based decoding

## How to run it

```bash
node scripts/decode_tx.js <txHash> [network]
```

With API key:

```bash
export SOCIALSCAN_API_KEY=your_key_here
node scripts/decode_tx.js <txHash> mainnet
```

## Output format

```
Transaction:    0xabc123...
Status:         ✅ Success
Block:          #1234567
Timestamp:      2026-05-25 18:42:11 UTC
Network:        Pharos Pacific Ocean Mainnet
From:           0x1234...
To:             0x5678... (contract)

— Value & gas —
Value sent:     0.5 PROS
Gas used:       142,318 / 200,000
Gas price:      1.25 gwei
Total cost:     0.50017789 PROS

— Function call —
Function:       transfer(address,uint256)
Decoded as:     transfer
  to:           0xabcd...
  amount:       1000000000000000000 (1.0 with 18 decimals)

— Events emitted (2) —
1. Transfer(address,address,uint256)
   from:        0x1234...
   to:          0xabcd...
   value:       1000000000000000000

2. Approval(address,address,uint256)
   owner:       0x1234...
   spender:     0xdef0...
   value:       0

Explorer:       https://pharosscan.xyz/tx/0xabc123...
```

## Decoding strategy

- **Status**: from receipt — `1` means success, `0` means revert
- **Function signature**: takes the first 4 bytes of `input` (the selector) and looks it up via the OpenChain signature database (free, no API key)
- **Function parameters**: once the signature is known, `decodeFunctionData` from viem turns the calldata into structured arguments
- **Event signatures**: each log's `topics[0]` is looked up the same way
- **Event parameters**: `decodeEventLog` turns topics + data into structured fields
- **Tier 2**: if the target contract is verified on Pharosscan, the full ABI is fetched and used for decoding instead of the public database — more accurate, includes custom names

## Edge cases

- **Plain PROS transfer (no input data)**: skipped function decode, just shows from/to/value
- **Contract deployment**: detected (`to` is null), shown clearly with deployed-address info
- **Reverted transaction**: status shown as failure, receipt still parsed
- **Unknown function selector**: shows the raw selector and a note that the signature isn't in OpenChain yet
- **Unknown event selector**: same — raw topics shown
- **Multiple matching signatures**: OpenChain returns several candidates; the most common one is chosen and others are noted
- **Network down / OpenChain unreachable**: Tier 1 falls back to showing raw data; the skill still returns useful output

## Dependencies

- Node.js 18+ (native `fetch` is used)
- `viem` (installed via `npm install`)

See `README.md` for setup.
