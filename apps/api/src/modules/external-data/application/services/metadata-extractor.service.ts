import { Injectable } from "@nestjs/common";

export interface ExtractedMetadata {
  symbols: string[];
  topics: string[];
  entities: { entity: string; entityType: string }[];
}

@Injectable()
export class MetadataExtractor {
  private readonly symbolMap: Record<string, string> = {
    BTC: "BTC-USDT",
    BITCOIN: "BTC-USDT",
    ETH: "ETH-USDT",
    ETHEREUM: "ETH-USDT",
    SOL: "SOL-USDT",
    SOLANA: "SOL-USDT",
    BNB: "BNB-USDT",
    "BNB CHAIN": "BNB-USDT",
    "BINANCE COIN": "BNB-USDT",
    XRP: "XRP-USDT",
    RIPPLE: "XRP-USDT",
    ADA: "ADA-USDT",
    CARDANO: "ADA-USDT",
    DOGE: "DOGE-USDT",
    DOGECOIN: "DOGE-USDT",
    AVAX: "AVAX-USDT",
    AVALANCHE: "AVAX-USDT",
    DOT: "DOT-USDT",
    POLKADOT: "DOT-USDT",
    MATIC: "MATIC-USDT",
    POL: "POL-USDT",
    POLYGON: "MATIC-USDT",
    UNI: "UNI-USDT",
    UNISWAP: "UNI-USDT",
    APT: "APT-USDT",
    APTOS: "APT-USDT",
    ARB: "ARB-USDT",
    ARBITRUM: "ARB-USDT",
    SUI: "SUI-USDT",
    PEPE: "PEPE-USDT",
    SHIB: "SHIB-USDT",
    INJ: "INJ-USDT",
    TIA: "TIA-USDT",
    LDO: "LDO-USDT",
    FIL: "FIL-USDT",
    FILECOIN: "FIL-USDT",
    ATOM: "ATOM-USDT",
    COSMOS: "ATOM-USDT",
    LINK: "LINK-USDT",
    CHAINLINK: "LINK-USDT",
    ZRO: "ZRO-USDT",
    LAYERZERO: "ZRO-USDT",
    OKB: "OKB-USDT",
    "OKX TOKEN": "OKB-USDT",
    NEAR: "NEAR-USDT",
    GAS: "GAS-USDT",
    OP: "OP-USDT",
    ONE: "ONE-USDT",
  };

  // Ambiguous tickers requiring explicit cashtag ($LINK) or pair format (LINK/USDT) to avoid false positives
  private readonly ambiguousSymbols = new Set([
    "ONE",
    "LINK",
    "NEAR",
    "GAS",
    "OP",
    "FOR",
    "KEY",
    "TIME",
    "MANA",
    "RUN",
  ]);

  private readonly topicKeywords: Record<string, string[]> = {
    regulation: [
      "sec",
      "cftc",
      "regulator",
      "regulation",
      "legal",
      "lawsuit",
      "subpoena",
      "enforcement",
      "compliance",
      "court",
    ],
    ETF: [
      "etf",
      "spot etf",
      "blackrock",
      "fidelity",
      "grayscale",
      "s-1",
      "19b-4",
    ],
    listing: [
      "list",
      "listing",
      "lists",
      "new pair",
      "trading pair",
      "launchpool",
    ],
    delisting: ["delist", "delisting", "delists", "cease trading", "removal"],
    security: [
      "exploit",
      "hack",
      "hacked",
      "vulnerability",
      "attack",
      "compromised",
      "stolen",
      "phishing",
      "security notice",
    ],
    stablecoin: [
      "usdt",
      "usdc",
      "dai",
      "tether",
      "circle",
      "depeg",
      "stablecoin",
    ],
    macro: [
      "cpi",
      "ppi",
      "fomc",
      "fed",
      "federal reserve",
      "interest rate",
      "inflation",
      "gdp",
      "unemployment",
      "payroll",
    ],
    institutional_adoption: [
      "institutional",
      "treasury",
      "microstrategy",
      "corporate reserve",
      "hedge fund",
    ],
    DeFi: [
      "defi",
      "decentralized finance",
      "tvl",
      "yield",
      "liquidity pool",
      "dex",
      "uniswap",
      "aave",
    ],
    layer_1: ["layer 1", "l1", "bitcoin", "ethereum", "solana", "avalanche"],
    layer_2: [
      "layer 2",
      "l2",
      "arbitrum",
      "optimism",
      "base",
      "zksync",
      "starknet",
      "rollup",
    ],
    derivatives: [
      "futures",
      "perpetual",
      "funding rate",
      "open interest",
      "options",
      "margin",
    ],
    liquidation: ["liquidation", "liquidated", "short squeeze", "long squeeze"],
    governance: ["governance", "dao", "proposal", "vote", "voting"],
    oracle: ["oracle", "chainlink", "pyth", "price feed", "data feed"],
  };

  private readonly entityKeywords: {
    name: string;
    type: string;
    keywords: string[];
  }[] = [
    {
      name: "Binance",
      type: "Exchange",
      keywords: ["binance", "cz", "richard teng"],
    },
    { name: "OKX", type: "Exchange", keywords: ["okx", "okex"] },
    {
      name: "Coinbase",
      type: "Exchange",
      keywords: ["coinbase", "brian armstrong"],
    },
    { name: "Bybit", type: "Exchange", keywords: ["bybit"] },
    { name: "Kraken", type: "Exchange", keywords: ["kraken"] },
    {
      name: "SEC",
      type: "Regulator",
      keywords: ["sec", "securities and exchange commission", "gary gensler"],
    },
    {
      name: "CFTC",
      type: "Regulator",
      keywords: ["cftc", "commodity futures trading commission"],
    },
    {
      name: "Fed",
      type: "CentralBank",
      keywords: ["fed", "federal reserve", "powell", "jerome powell"],
    },
    { name: "Tether", type: "Company", keywords: ["tether", "usdt"] },
    { name: "Circle", type: "Company", keywords: ["circle", "usdc"] },
  ];

  extractMetadata(title: string, summary: string = ""): ExtractedMetadata {
    const fullText = `${title} ${summary}`;
    const upperText = fullText.toUpperCase();
    const lowerText = fullText.toLowerCase();

    // 1. Extract Symbols
    const symbols = new Set<string>();

    // Explicit cashtags ($BTC, $ETH, $LINK)
    const cashtagMatches = fullText.match(/\$([A-Z0-9]{2,10})\b/gi);
    if (cashtagMatches) {
      for (const raw of cashtagMatches) {
        const ticker = raw.slice(1).toUpperCase();
        if (this.symbolMap[ticker]) {
          symbols.add(this.symbolMap[ticker]);
        }
      }
    }

    // Direct ticker matches
    for (const [ticker, mappedPair] of Object.entries(this.symbolMap)) {
      if (this.ambiguousSymbols.has(ticker)) {
        // Require explicit cashtag or pair context for ambiguous words
        const pairRegex = new RegExp(
          `\\b${ticker}[/-](USDT|USD|BUSD|PERP)\\b`,
          "i",
        );
        if (pairRegex.test(fullText) || upperText.includes(`$${ticker}`)) {
          symbols.add(mappedPair);
        }
      } else {
        const wordRegex = new RegExp(`\\b${ticker}\\b`, "i");
        if (wordRegex.test(fullText)) {
          symbols.add(mappedPair);
        }
      }
    }

    // 2. Extract Topics
    const topics = new Set<string>();
    for (const [topic, keywords] of Object.entries(this.topicKeywords)) {
      for (const kw of keywords) {
        if (lowerText.includes(kw)) {
          topics.add(topic);
          break;
        }
      }
    }

    // 3. Extract Entities
    const entitiesMap = new Map<string, string>();
    for (const entityDef of this.entityKeywords) {
      for (const kw of entityDef.keywords) {
        if (lowerText.includes(kw)) {
          entitiesMap.set(entityDef.name, entityDef.type);
          break;
        }
      }
    }

    const entities = Array.from(entitiesMap.entries()).map(
      ([entity, entityType]) => ({
        entity,
        entityType,
      }),
    );

    return {
      symbols: Array.from(symbols),
      topics: Array.from(topics),
      entities,
    };
  }
}
