import { BigNumber } from "bignumber.js";
import { ethers } from "ethers";
import _ from "lodash";

import { blocksPerDay, day, ethAddr } from "./constants";
import { logger } from "./logging";
import {
  pricingTokens,
  tokensEthereum as tokens,
  usdStableTokens,
} from "./tokens";
import { Protocol, Token } from "./types";

type TokenMap = {
  [name: string]: Token;
};

const Zero = new BigNumber(0);
const One = new BigNumber(1);

type PriceWithVolume = {
  price: BigNumber;
  volume: BigNumber; // the amounts of base token
  blockNumber: number;
};

type DataSource = {
  protocol: Protocol;
  address: string;
};

export type TokenPriceWithSource = PriceWithVolume & DataSource;

export type PriceAggregation = {
  round: number;
  price: BigNumber;
  volume: BigNumber;
  priceWithVolumePerPool: {
    price: BigNumber;
    volume: BigNumber;
    address: string;
    protocol: Protocol;
  }[];
};

export type DailyPoolSnapshot = {
  dayID: number;
  volumeInUSD: BigNumber;
};

export class TokenPricing {
  // params
  protected pricingAssets: string[];
  protected usdStableAssets: string[];
  protected priceDecimals: number;
  protected maxHistoryRecords: number;
  protected maxCachedDays: number;

  // internal states
  // mapping from ${baseToken}-${quoteToken} to price
  private usdPrice: Record<string, BigNumber>;
  private tokenPrice: Record<string, TokenPriceWithSource[]>;
  protected startBlockNumber: number;
  protected numRounds: number;
  protected historyUSDPrice: Record<string, PriceWithVolume[]>;
  protected dailyPoolVolumeInUSD: Record<string, DailyPoolSnapshot[]>;
  protected currentRoundUpdatedTokens: Set<string>;
  protected currentRoundUpdatedTokenPairs: Set<string>;

  constructor(
    protected tick: number = 2,
    protected tokens: TokenMap,
    protected provider: ethers.providers.JsonRpcProvider
  ) {
    this.pricingAssets = pricingTokens.map((asset) =>
      asset.address.toLowerCase()
    );
    this.usdStableAssets = usdStableTokens.map((asset) =>
      asset.address.toLowerCase()
    );
    this.usdPrice = {};
    this.tokenPrice = {};
    this.historyUSDPrice = {};
    this.dailyPoolVolumeInUSD = {};
    this.priceDecimals = 8;
    this.currentRoundUpdatedTokens = new Set<string>();
    this.currentRoundUpdatedTokenPairs = new Set<string>();
    this.numRounds = 0;
    this.startBlockNumber = 0;
    this.maxHistoryRecords = (2 * day) / 13 / this.tick;
    this.maxCachedDays = 100;

    this.initPricingAsset();
  }

  public getHistoryUSDPrice(token: string): PriceWithVolume[] {
    if (token.toLowerCase() in this.historyUSDPrice) {
      return this.historyUSDPrice[token.toLowerCase()].map(
        (priceWithVolume) => ({
          price: priceWithVolume.price.dp(this.priceDecimals),
          volume: priceWithVolume.volume.dp(this.priceDecimals),
          blockNumber: priceWithVolume.blockNumber,
        })
      );
    }
    return [];
  }

  public initPricingAsset() {
    this.usdPrice[tokens.USDC.address.toLowerCase()] = One;
    this.usdPrice[tokens.USDT.address.toLowerCase()] = One;
    this.usdPrice[tokens.DAI.address.toLowerCase()] = One;
  }

  public isUSDStable(token: string) {
    return this.usdStableAssets.some(
      (asset) => asset.toLowerCase() === token.toLowerCase()
    );
  }

  public getTokenPairKey(baseToken: string, quoteToken: string) {
    return `${baseToken.toLowerCase()}-${quoteToken.toLowerCase()}`;
  }

  private processTokenPrice(
    tokenPrices: TokenPriceWithSource[],
    baseToken: string,
    quoteToken: string
  ): PriceAggregation {
    const quoteTokenPriceInUSD =
      this.usdPrice[quoteToken.toLowerCase()] ?? Zero;
    const priceWithVolumePerPool = _(tokenPrices)
      .map((item) => item.address)
      .uniq()
      .map((address) =>
        tokenPrices.filter((tokenPrice) => tokenPrice.address === address)
      )
      .map((tokenPricesPerPool) =>
        tokenPricesPerPool.reduce(
          (res, cur) => {
            return {
              ...res,
              value: res.value.plus(cur.price.times(cur.volume)),
              volume: res.volume.plus(cur.volume),
            };
          },
          {
            volume: Zero,
            value: Zero,
            address: tokenPricesPerPool[0].address,
            protocol: tokenPricesPerPool[0].protocol,
          }
        )
      )
      .map((tokenPricePerPool) => {
        const price = tokenPricePerPool.value
          .div(tokenPricePerPool.volume)
          .times(quoteTokenPriceInUSD)
          .dp(this.priceDecimals);
        return {
          price,
          volume: tokenPricePerPool.volume.dp(this.priceDecimals),
          address: tokenPricePerPool.address,
          protocol: tokenPricePerPool.protocol,
        };
      })
      .value();

    // volume and weighted average price
    const totalVolume = tokenPrices.reduce(
      (res, cur) => res.plus(cur.volume),
      Zero
    );
    const usdPrice = this.isUSDStable(baseToken)
      ? One
      : tokenPrices
          .reduce((res, cur) => res.plus(cur.price.times(cur.volume)), Zero)
          .div(totalVolume)
          .times(quoteTokenPriceInUSD);
    return {
      round: this.numRounds,
      price: usdPrice,
      volume: totalVolume,
      priceWithVolumePerPool,
    };
  }

  public getLatestVolumeInUSD(poolAddr: string, confirmation: number) {
    const dailySnapshots =
      this.dailyPoolVolumeInUSD[poolAddr.toLowerCase()] ?? [];
    const isExist = dailySnapshots.length > confirmation;
    if (!isExist) {
      return { dayID: 0, volumeInUSD: Zero };
    }
    return dailySnapshots[dailySnapshots.length - 1 - confirmation];
  }

  isPriceValid(price: TokenPriceWithSource) {
    return price.blockNumber - this.startBlockNumber >= 0;
  }

  public getLatestPriceInUSD(baseToken: string) {
    const priceAggregationPerPairs: PriceAggregation[] = [];
    for (let i = 0; i < this.pricingAssets.length; ++i) {
      const key = this.getTokenPairKey(baseToken, this.pricingAssets[i]);
      // discard pricing asset when it has no usd price exist or token price is expired
      if (
        key in this.tokenPrice &&
        this.tokenPrice[key][0].blockNumber >= this.startBlockNumber &&
        this.pricingAssets[i] in this.usdPrice &&
        this.usdPrice[this.pricingAssets[i]].gt(0)
      ) {
        priceAggregationPerPairs.push(
          this.processTokenPrice(
            this.tokenPrice[key],
            baseToken.toLowerCase(),
            this.pricingAssets[i]
          )
        );
      }
    }
    if (!priceAggregationPerPairs.length) {
      return {
        round: this.numRounds,
        blockNumber: this.startBlockNumber,
        // use the last price record
        price: this.usdPrice[baseToken.toLowerCase()] ?? Zero,
        volume: Zero,
        priceWithVolumePerPool: [],
      };
    }
    // aggregate all prices of token pairs including base token
    const totalVolume = priceAggregationPerPairs.reduce(
      (res, cur) => res.plus(cur.volume),
      Zero
    );
    const weightedPrice = priceAggregationPerPairs
      .reduce((res, cur) => res.plus(cur.price.times(cur.volume)), Zero)
      .div(totalVolume);

    const priceWithVolumePerPool = priceAggregationPerPairs.flatMap(
      (priceAggregationPerPair) =>
        priceAggregationPerPair.priceWithVolumePerPool
    );

    return {
      round: this.numRounds,
      blockNumber: this.startBlockNumber,
      price: weightedPrice.dp(this.priceDecimals),
      volume: totalVolume.dp(this.priceDecimals),
      priceWithVolumePerPool,
    };
  }
  public isSupportedToken(tokenAddr: string) {
    return tokenAddr.toLowerCase() in this.tokens;
  }

  public getDecimals(tokenAddr: string) {
    const token = this.tokens[tokenAddr.toLowerCase()];
    return new BigNumber(10).pow(token.decimals);
  }

  protected updatePoolVolumeInUSD(
    poolAddr: string,
    volumeInUSD: BigNumber,
    blockNumber: number
  ) {
    let dailySnapshots =
      this.dailyPoolVolumeInUSD[poolAddr.toLowerCase()] ?? [];
    const dayID = Math.floor(blockNumber / blocksPerDay);
    const numDaysCached = dailySnapshots.length;
    if (numDaysCached >= this.maxCachedDays) {
      dailySnapshots = dailySnapshots.slice(-this.maxCachedDays);
    }
    if (
      dailySnapshots.length &&
      dailySnapshots[numDaysCached - 1].dayID === dayID
    ) {
      // the same day
      dailySnapshots[numDaysCached - 1].volumeInUSD =
        dailySnapshots[numDaysCached - 1].volumeInUSD.plus(volumeInUSD);
    } else {
      dailySnapshots.push({
        volumeInUSD,
        dayID,
      });
    }
    // write back
    this.dailyPoolVolumeInUSD[poolAddr.toLowerCase()] = dailySnapshots;
  }

  updateTokensPrice() {
    for (const fromTokenAddr of this.currentRoundUpdatedTokens) {
      // cache all history token price for current round
      const { price: fromTokenPrice, volume: fromTokenVolume } =
        this.getLatestPriceInUSD(fromTokenAddr);
      let fromTokenHistory = this.historyUSDPrice[fromTokenAddr] ?? [];

      // discard oldest history records
      if (fromTokenHistory.length >= this.maxHistoryRecords) {
        fromTokenHistory = fromTokenHistory.slice(-this.maxHistoryRecords);
      }

      if (fromTokenPrice.gt(0) && fromTokenVolume.gt(0)) {
        fromTokenHistory.push({
          price: fromTokenPrice,
          volume: fromTokenVolume,
          blockNumber: this.startBlockNumber,
        });
        this.historyUSDPrice[fromTokenAddr] = fromTokenHistory;
        // update usd price

        this.usdPrice[fromTokenAddr] = fromTokenPrice;
      }
    }

    // remove all out of dated swap events
    this.currentRoundUpdatedTokenPairs.forEach(
      (pairKey) => delete this.tokenPrice[pairKey]
    );

    this.currentRoundUpdatedTokens.clear();
  }

  tokenAddrPreprocess(tokenAddr: string) {
    tokenAddr = tokenAddr.toLowerCase();
    if (tokenAddr === ethAddr.toLowerCase()) {
      // wrapped to weth for now
      return tokens.WETH.address.toLowerCase();
    }
    return tokenAddr;
  }

  public volumeInUSD(
    fromToken: string,
    fromTokenAmount: string,
    toToken: string,
    toTokenAmount: string,
    blockNumber: number,
    address: string,
    protocol: Protocol
  ) {
    // to lowercase
    const fromTokenAddr = this.tokenAddrPreprocess(fromToken);
    const toTokenAddr = this.tokenAddrPreprocess(toToken);

    const { price: fromTokenPrice, volume: fromTokenVolume } =
      this.getLatestPriceInUSD(fromTokenAddr);
    const { price: toTokenPrice, volume: toTokenVolume } =
      this.getLatestPriceInUSD(toTokenAddr);
    const amountSold = new BigNumber(fromTokenAmount).div(
      this.getDecimals(fromTokenAddr)
    );
    const amountBought = new BigNumber(toTokenAmount).div(
      this.getDecimals(toTokenAddr)
    );
    let volumeInUSD = new BigNumber(0);
    // only pricing assets are considered
    if (
      this.pricingAssets.includes(fromTokenAddr) &&
      this.pricingAssets.includes(toTokenAddr)
    ) {
      volumeInUSD = amountSold
        .times(fromTokenPrice)
        .plus(amountBought.times(toTokenPrice))
        .div(2);
    } else if (this.pricingAssets.includes(fromTokenAddr)) {
      volumeInUSD = amountSold.times(fromTokenPrice);
    } else if (this.pricingAssets.includes(toTokenAddr)) {
      volumeInUSD = amountBought.times(toTokenPrice);
    }
    // update token pair price
    const newToTokenPrice = amountSold.div(amountBought);
    const newFromTokenPrice = amountBought.div(amountSold);

    if (blockNumber < this.startBlockNumber) {
      logger.warn(
        `blockNumber: ${blockNumber} is out of date, current round is in [${
          this.startBlockNumber
        }, ${
          this.startBlockNumber + this.tick - 1
        }]. so discard the swap event!`
      );
      return volumeInUSD.dp(this.priceDecimals);
    }

    if (blockNumber >= this.startBlockNumber + this.tick) {
      this.updateTokensPrice();

      // update block number
      const num = Math.floor((blockNumber - this.startBlockNumber) / this.tick);
      // fast-forward
      this.startBlockNumber += this.tick * num;
      this.numRounds += 1;
    }

    // push price to the current round
    const pairKey0 = this.getTokenPairKey(toTokenAddr, fromTokenAddr);
    const pairKey1 = this.getTokenPairKey(fromTokenAddr, toTokenAddr);
    if (pairKey0 in this.tokenPrice) {
      this.tokenPrice[pairKey0].push({
        price: newToTokenPrice,
        volume: amountBought,
        address,
        protocol,
        blockNumber,
      });
      this.tokenPrice[pairKey1].push({
        price: newFromTokenPrice,
        volume: amountSold,
        address,
        protocol,
        blockNumber,
      });
    } else {
      this.tokenPrice[pairKey0] = [
        {
          price: newToTokenPrice,
          volume: amountBought,
          address,
          protocol,
          blockNumber,
        },
      ];
      this.tokenPrice[pairKey1] = [
        {
          price: newFromTokenPrice,
          volume: amountSold,
          address,
          protocol,
          blockNumber,
        },
      ];
    }
    this.updatePoolVolumeInUSD(address, volumeInUSD, blockNumber);
    this.currentRoundUpdatedTokens.add(fromTokenAddr);
    this.currentRoundUpdatedTokens.add(toTokenAddr);
    this.currentRoundUpdatedTokenPairs.add(pairKey0);
    this.currentRoundUpdatedTokenPairs.add(pairKey1);

    return volumeInUSD.dp(this.priceDecimals);
  }
}
