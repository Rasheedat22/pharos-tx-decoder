#!/usr/bin/env node
/**
 * Pharos Transaction Decoder
 *
 * Decodes any transaction on the Pharos Network into a human-readable summary.
 *
 * Tier 1 (always): RPC + OpenChain signature database (no API key needed)
 * Tier 2 (optional): SocialScan ABI fetch for accurate decoding of verified contracts
 *
 * Usage:
 *   node scripts/decode_tx.js <txHash> [mainnet|testnet]
 *   SOCIALSCAN_API_KEY=<key> node scripts/decode_tx.js <txHash> mainnet
 */

import {
  createPublicClient,
  http,
  defineChain,
  parseAbiItem,
  decodeFunctionData,
  decodeEventLog,
  formatEther,
  formatGwei,
} from "viem";

// --- Network constants (URLs grouped together for easy auditing) ---
const RPC_MAINNET = "https://rpc.pharos.xyz";
const RPC_TESTNET = "https://atlantic.dplabs-internal.com";
const EXPLORER_MAINNET = "https://pharosscan.xyz";
const EXPLORER_TESTNET = "https://atlantic.pharosscan.xyz";
const SOCIALSCAN_BASE = "https://api.socialscan.io";
const OPENCHAIN_API = "https://api.openchain.xyz/signature-database/v1/lookup";

// --- Pharos chain definitions ---
const pharosMainnet = defineChain({
  id: 1672,
  name: "Pharos Pacific Ocean Mainnet",
  nativeCurrency: { name: "Pharos", symbol: "PROS", decimals: 18 },
  rpcUrls: { default: { http: [RPC_MAINNET] } },
});

const pharosTestnet = defineChain({
  id: 688689,
  name: "Pharos Atlantic Testnet",
  nativeCurrency: { name: "Pharos", symbol: "PROS", decimals: 18 },
  rpcUrls: { default: { http: [RPC_TESTNET] } },
});

const SOCIALSCAN_NETWORKS = {
  mainnet: "pharos-mainnet",
  testnet: "pharos-atlantic-testnet",
};

// --- Look up a function or event signature in OpenChain's free database ---
async function lookupSignature(selector, kind) {
  // kind = "function" or "event"
  try {
    const url = `${OPENCHAIN_API}?${kind}=${selector}&filter=true`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    const entries = data?.result?.[kind]?.[selector];
    if (!entries || entries.length === 0) return null;
    // Return the first (most common) signature
    return entries[0].name;
  } catch {
    return null;
  }
}

// --- Tier 2: fetch verified ABI from SocialScan ---
async function fetchAbi(address, networkKey, apiKey) {
  const network = SOCIALSCAN_NETWORKS[networkKey];
  const url =
    `${SOCIALSCAN_BASE}/${network}/v1/explorer/command_api/contract` +
    `?module=contract&action=getsourcecode&address=${address}&apikey=${apiKey}`;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    const r = data?.result?.[0];
    if (!r?.ABI || r.ABI === "Contract source code not verified") return null;
    return { abi: JSON.parse(r.ABI), contractName: r.ContractName || null };
  } catch {
    return null;
  }
}

// --- Decode the function call from tx.input ---
async function decodeCall(input, toAddress, abiFromSocialScan) {
  if (!input || input === "0x" || input.length < 10) {
    return { type: "transfer", note: "Plain PROS transfer (no calldata)" };
  }

  const selector = input.slice(0, 10); // 0x + 8 hex chars

  // Try Tier 2 first (verified ABI)
  if (abiFromSocialScan?.abi) {
    try {
      const decoded = decodeFunctionData({
        abi: abiFromSocialScan.abi,
        data: input,
      });
      const func = abiFromSocialScan.abi.find(
        (item) => item.name === decoded.functionName && item.type === "function",
      );
      const argNames = func?.inputs?.map((i) => i.name) || [];
      const args = (decoded.args || []).map((value, i) => ({
        name: argNames[i] || `arg${i}`,
        value: serializeValue(value),
      }));
      return {
        type: "call",
        signature: formatSignature(func),
        functionName: decoded.functionName,
        args,
        source: "verified-abi",
      };
    } catch {
      // Fall through to Tier 1
    }
  }

  // Tier 1: OpenChain signature lookup
  const signature = await lookupSignature(selector, "function");
  if (!signature) {
    return {
      type: "call",
      signature: null,
      selector,
      rawData: input,
      source: "unknown",
    };
  }

  try {
    const abi = [parseAbiItem(`function ${signature}`)];
    const decoded = decodeFunctionData({ abi, data: input });
    const funcAbi = abi[0];
    const argNames = funcAbi?.inputs?.map((i) => i.name) || [];
    const args = (decoded.args || []).map((value, i) => ({
      name: argNames[i] || `arg${i}`,
      value: serializeValue(value),
    }));
    return {
      type: "call",
      signature,
      functionName: decoded.functionName,
      args,
      source: "openchain",
    };
  } catch {
    return { type: "call", signature, selector, source: "decode-failed" };
  }
}

// --- Decode a single event log ---
async function decodeLog(log, abiFromSocialScan) {
  // Try Tier 2 first
  if (abiFromSocialScan?.abi) {
    try {
      const decoded = decodeEventLog({
        abi: abiFromSocialScan.abi,
        data: log.data,
        topics: log.topics,
      });
      const eventAbi = abiFromSocialScan.abi.find(
        (item) => item.type === "event" && item.name === decoded.eventName,
      );
      const argNames = eventAbi?.inputs?.map((i) => i.name) || [];
      const args = Object.entries(decoded.args || {}).map(([name, value]) => ({
        name,
        value: serializeValue(value),
      }));
      return {
        signature: formatSignature(eventAbi),
        eventName: decoded.eventName,
        args,
        source: "verified-abi",
      };
    } catch {
      // Fall through
    }
  }

  // Tier 1: OpenChain lookup
  const topic0 = log.topics?.[0];
  if (!topic0) return { signature: null, raw: log };

  const signature = await lookupSignature(topic0, "event");
  if (!signature) {
    return { signature: null, selector: topic0, raw: log };
  }

  try {
    const abi = [parseAbiItem(`event ${signature}`)];
    const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics });
    const eventAbi = abi[0];
    const argNames = eventAbi?.inputs?.map((i) => i.name) || [];
    const args = (eventAbi.inputs || []).map((input, i) => ({
      name: input.name || `arg${i}`,
      value: serializeValue(decoded.args?.[input.name] ?? decoded.args?.[i]),
    }));
    return { signature, eventName: decoded.eventName, args, source: "openchain" };
  } catch {
    return { signature, selector: topic0, raw: log, source: "decode-failed" };
  }
}

// --- Helpers ---
function serializeValue(v) {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(serializeValue);
  return v;
}

function formatSignature(funcOrEventAbi) {
  if (!funcOrEventAbi) return null;
  const inputs = (funcOrEventAbi.inputs || []).map((i) => i.type).join(",");
  return `${funcOrEventAbi.name}(${inputs})`;
}

function shorten(addr) {
  if (!addr) return "(none)";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// --- Main decode entry point ---
async function decodeTransaction(txHash, networkKey = "mainnet") {
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    throw new Error(`Invalid transaction hash format: ${txHash}`);
  }

  const chain = networkKey === "testnet" ? pharosTestnet : pharosMainnet;
  const explorerUrl = networkKey === "testnet" ? EXPLORER_TESTNET : EXPLORER_MAINNET;
  const client = createPublicClient({ chain, transport: http() });

  const [tx, receipt] = await Promise.all([
    client.getTransaction({ hash: txHash }),
    client.getTransactionReceipt({ hash: txHash }),
  ]);

  // Block timestamp (best-effort)
  let timestamp = null;
  try {
    const block = await client.getBlock({ blockNumber: tx.blockNumber });
    timestamp = new Date(Number(block.timestamp) * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
  } catch {
    /* ignore */
  }

  // Tier 2: try to fetch ABI for the target contract
  const apiKey = process.env.SOCIALSCAN_API_KEY;
  let abi = null;
  if (apiKey && tx.to) {
    abi = await fetchAbi(tx.to, networkKey, apiKey);
  }

  // Decode the function call
  const call = await decodeCall(tx.input, tx.to, abi);

  // Decode events
  const events = [];
  for (const log of receipt.logs) {
    events.push(await decodeLog(log, abi));
  }

  return {
    txHash,
    status: receipt.status === "success" ? "success" : "reverted",
    blockNumber: tx.blockNumber,
    timestamp,
    networkName: chain.name,
    from: tx.from,
    to: tx.to,
    contractCreated: receipt.contractAddress || null,
    value: tx.value,
    gasUsed: receipt.gasUsed,
    gasLimit: tx.gas,
    gasPrice: tx.gasPrice || tx.effectiveGasPrice,
    call,
    events,
    explorer: `${explorerUrl}/tx/${txHash}`,
    verifiedContractName: abi?.contractName || null,
  };
}

// --- Format the report ---
function formatReport(r) {
  const lines = [];
  lines.push(`Transaction:    ${r.txHash}`);
  lines.push(`Status:         ${r.status === "success" ? "Success" : "Reverted"}`);
  lines.push(`Block:          #${r.blockNumber}`);
  if (r.timestamp) lines.push(`Timestamp:      ${r.timestamp}`);
  lines.push(`Network:        ${r.networkName}`);
  lines.push(`From:           ${r.from}`);

  if (r.contractCreated) {
    lines.push(`Action:         Contract deployment`);
    lines.push(`Deployed at:    ${r.contractCreated}`);
  } else {
    const toLabel = r.verifiedContractName ? ` (${r.verifiedContractName})` : "";
    lines.push(`To:             ${r.to || "(contract creation)"}${toLabel}`);
  }

  // --- Value & gas ---
  lines.push("");
  lines.push("— Value & gas —");
  lines.push(`Value sent:     ${formatEther(r.value)} PROS`);
  lines.push(`Gas used:       ${r.gasUsed.toLocaleString()} / ${r.gasLimit.toLocaleString()}`);
  if (r.gasPrice) {
    lines.push(`Gas price:      ${formatGwei(r.gasPrice)} gwei`);
    const totalCost = r.gasUsed * r.gasPrice;
    lines.push(`Total cost:     ${formatEther(totalCost + r.value)} PROS`);
  }

  // --- Function call ---
  lines.push("");
  lines.push("— Function call —");
  if (r.call.type === "transfer") {
    lines.push(`(${r.call.note})`);
  } else if (r.call.signature) {
    lines.push(`Function:       ${r.call.signature}`);
    if (r.call.source === "verified-abi") {
      lines.push(`Source:         verified ABI`);
    } else if (r.call.source === "openchain") {
      lines.push(`Source:         OpenChain signature database`);
    }
    if (r.call.args && r.call.args.length > 0) {
      for (const arg of r.call.args) {
        const v = Array.isArray(arg.value) ? `[${arg.value.join(", ")}]` : arg.value;
        lines.push(`  ${arg.name}: ${v}`);
      }
    }
  } else {
    lines.push(`Function:       (unknown — selector ${r.call.selector} not in OpenChain)`);
    if (r.call.rawData) lines.push(`Raw input:      ${r.call.rawData.slice(0, 80)}...`);
  }

  // --- Events ---
  lines.push("");
  lines.push(`— Events emitted (${r.events.length}) —`);
  if (r.events.length === 0) {
    lines.push(`(no events)`);
  } else {
    r.events.forEach((ev, i) => {
      const idx = i + 1;
      if (ev.signature) {
        lines.push(`${idx}. ${ev.signature}`);
        if (ev.args && ev.args.length > 0) {
          for (const arg of ev.args) {
            const v = Array.isArray(arg.value) ? `[${arg.value.join(", ")}]` : arg.value;
            lines.push(`   ${arg.name}: ${v}`);
          }
        }
      } else {
        lines.push(`${idx}. (unknown event — ${ev.selector || "no topic"})`);
      }
    });
  }

  lines.push("");
  lines.push(`Explorer:       ${r.explorer}`);

  return lines.join("\n");
}

// --- CLI entry point ---
async function main() {
  const [txHash, network] = process.argv.slice(2);
  if (!txHash) {
    console.error("Usage: node scripts/decode_tx.js <txHash> [mainnet|testnet]");
    console.error("Optional: set SOCIALSCAN_API_KEY env var for verified-ABI decoding");
    process.exit(1);
  }
  try {
    const result = await decodeTransaction(txHash, network);
    console.log(formatReport(result));
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();

export { decodeTransaction, formatReport };
