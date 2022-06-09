import { Interface } from "@ethersproject/abi";
import { Log } from "@ethersproject/abstract-provider";
import { BigNumber } from "bignumber.js";
import { BytesLike, Contract, ethers } from "ethers";

import { logger } from "./logging";
import { TokenPricing } from "./pricing";
import { tokensEthereum as tokens } from "./tokens";
import { UniswapV2Pair__factory, UniswapV3Pool__factory } from "./typechain";
import { Protocol, SwapEvent } from "./types";

const Zero = new BigNumber(0);

type EventHandlerType = {
  decodeLog: (log: Log, param: Param) => SwapEvent;
  protocol: Protocol;
};

type Param = {
  tokens: string[];
};

export class EventSubscriber {
  // protected uniswapV2: Contract;
  protected swapEvents: SwapEvent[];
  protected eventHandlersMap: Record<string, EventHandlerType>;
  protected addressSet: Set<string>;
  protected addressToParams: Record<string, Param>;
  protected fastSyncBatch: number;

  protected totalVolumeInUSD: BigNumber;
  protected decimals: number;
  constructor(
    protected tokenPricing: TokenPricing,
    protected provider: ethers.providers.JsonRpcProvider,
    protected fromBlock: number,
    protected confirmation: number = 2
  ) {
    this.swapEvents = [];
    this.totalVolumeInUSD = Zero;
    this.eventHandlersMap = {};
    this.addressSet = new Set<string>();
    this.addressToParams = {};
    this.fastSyncBatch = 50;
    this.decimals = 8;

    this.initEventHandlersMap();
  }

  initEventHandlersMap() {
    // uniswapv2
    const uniswapV2Iface = UniswapV2Pair__factory.createInterface();
    const uniswapV3Iface = UniswapV3Pool__factory.createInterface();
    this.eventHandlersMap[uniswapV2Iface.getEventTopic("Swap")] = {
      protocol: Protocol.UniswapV2,
      decodeLog: (log: Log, param: Param) => {
        const token0 = param.tokens[0];
        const token1 = param.tokens[1];
        const args = uniswapV2Iface.decodeEventLog(
          "Swap",
          log.data,
          log.topics
        );
        const { sender, amount0In, amount0Out, amount1In, amount1Out } = args;
        const fromToken = amount0In.gt(0) ? token0 : token1;
        const toToken = amount1Out.gt(0) ? token1 : token0;
        const amountIn = amount0In.gt(0) ? amount0In : amount1In;
        const amountOut = amount0Out.gt(0) ? amount0Out : amount1Out;
        return {
          fromToken,
          toToken,
          amountIn: amountIn.toString(),
          amountOut: amountOut.toString(),
          blockNumber: log.blockNumber,
          protocol: Protocol.UniswapV2,
          address: log.address,
          logIndex: log.logIndex,
          transactionIndex: log.transactionIndex,
        };
      },
    };
    // uniswapv3
    this.eventHandlersMap[uniswapV3Iface.getEventTopic("Swap")] = {
      protocol: Protocol.UniswapV3,
      decodeLog: (log: Log, param: Param) => {
        const token0 = param.tokens[0];
        const token1 = param.tokens[1];
        const args = uniswapV3Iface.decodeEventLog(
          "Swap",
          log.data,
          log.topics
        );

        const { amount0, amount1 } = args;
        const fromToken = amount0.gt(0) ? token0 : token1;
        const toToken = amount0.lt(0) ? token0 : token1;
        const amountIn = amount0.gt(0) ? amount0 : amount1;
        const amountOut = amount0.lt(0) ? amount0 : amount1;
        return {
          fromToken,
          toToken,
          amountIn: amountIn.toString(),
          amountOut: amountOut.abs().toString(),
          blockNumber: log.blockNumber,
          address: log.address,
          protocol: Protocol.UniswapV3,
          logIndex: log.logIndex,
          transactionIndex: log.transactionIndex,
        };
      },
    };
    // balancerv2
    const balancerV2ABI = [
      "event Swap(bytes32 indexed poolId,address indexed tokenIn,address indexed tokenOut,uint256 amountIn,uint256 amountOut)",
    ];
    const balancerV2Iface = new ethers.utils.Interface(balancerV2ABI);
    this.eventHandlersMap[balancerV2Iface.getEventTopic("Swap")] = {
      protocol: Protocol.BalancerV2,
      decodeLog: (log: Log) => {
        const args = balancerV2Iface.decodeEventLog(
          "Swap",
          log.data,
          log.topics
        );
        const { poolId, tokenIn, tokenOut, amountIn, amountOut } = args;
        return {
          fromToken: tokenIn,
          toToken: tokenOut,
          amountIn: amountIn.toString(),
          amountOut: amountOut.toString(),
          blockNumber: log.blockNumber,
          address: poolId,
          logIndex: log.logIndex,
          transactionIndex: log.transactionIndex,
          protocol: Protocol.BalancerV2,
        };
      },
    };

    // balancer
    const balancerABI = [
      "event LOG_SWAP(address indexed caller, address indexed tokenIn, address indexed tokenOut, uint256 tokenAmountIn, uint256 tokenAmountOut)",
    ];
    const balancerIface = new ethers.utils.Interface(balancerABI);
    this.eventHandlersMap[balancerIface.getEventTopic("LOG_SWAP")] = {
      protocol: Protocol.Balancer,
      decodeLog: (log: Log) => {
        const args = balancerIface.decodeEventLog(
          "LOG_SWAP",
          log.data,
          log.topics
        );
        const { tokenIn, tokenOut, tokenAmountIn, tokenAmountOut } = args;
        return {
          fromToken: tokenIn,
          toToken: tokenOut,
          amountIn: tokenAmountIn.toString(),
          amountOut: tokenAmountOut.toString(),
          blockNumber: log.blockNumber,
          address: log.address,
          protocol: Protocol.Balancer,
          logIndex: log.logIndex,
          transactionIndex: log.transactionIndex,
        };
      },
    };

    // curve
    const curveABI = [
      "event TokenExchangeUnderlying(address indexed buyer,int128 sold_id,uint256 tokens_sold,int128 bought_id,uint256 tokens_bought)",
      "event TokenExchange(address indexed buyer,int128 sold_id,uint256 tokens_sold,int128 bought_id,uint256 tokens_bought)",
    ];
    const curveV2ABI = [
      "event TokenExchange(address indexed buyer,uint256 sold_id,uint256 tokens_sold,uint256 bought_id,uint256 tokens_bought)",
    ];
    const curveIface = new ethers.utils.Interface(curveABI);
    const curveV2Iface = new ethers.utils.Interface(curveV2ABI);

    this.eventHandlersMap[curveIface.getEventTopic("TokenExchangeUnderlying")] =
      {
        protocol: Protocol.Curve,
        decodeLog: (log: Log, param: Param) => {
          const args = curveIface.decodeEventLog(
            "TokenExchangeUnderlying",
            log.data,
            log.topics
          );
          const { sold_id, tokens_sold, bought_id, tokens_bought } = args;
          const fromToken = param.tokens[sold_id];
          const toToken = param.tokens[bought_id];
          return {
            fromToken,
            toToken,
            amountIn: tokens_sold.toString(),
            amountOut: tokens_bought.toString(),
            blockNumber: log.blockNumber,
            address: log.address,
            protocol: Protocol.Balancer,
            logIndex: log.logIndex,
            transactionIndex: log.transactionIndex,
          };
        },
      };

    // curveV2
    this.eventHandlersMap[curveV2Iface.getEventTopic("TokenExchange")] = {
      protocol: Protocol.CurveV2,
      decodeLog: (log: Log, param: Param) => {
        const args = curveV2Iface.decodeEventLog(
          "TokenExchange",
          log.data,
          log.topics
        );
        const { sold_id, tokens_sold, bought_id, tokens_bought } = args;
        const fromToken = param.tokens[sold_id];
        const toToken = param.tokens[bought_id];
        return {
          fromToken,
          toToken,
          amountIn: tokens_sold.toString(),
          amountOut: tokens_bought.toString(),
          blockNumber: log.blockNumber,
          address: log.address,
          protocol: Protocol.Balancer,
          logIndex: log.logIndex,
          transactionIndex: log.transactionIndex,
        };
      },
    };
  }

  public registerPublisher(contractAddr: string, param?: Param) {
    if (!this.isRegisteredAlready(contractAddr)) {
      this.addressSet.add(contractAddr.toLowerCase());
      if (param) {
        this.addressToParams[contractAddr.toLowerCase()] = param;
      }
      return true;
    }
    return false;
  }

  public isRegisteredAlready(contractAddr: string) {
    return this.addressSet.has(contractAddr.toLowerCase());
  }

  public getTotalVolumeInUSD() {
    return this.totalVolumeInUSD.dp(this.decimals);
  }
  async getLogs(fromBlock: number, toBlock: number) {
    const logs = await this.provider.getLogs({
      fromBlock,
      toBlock,
    });
    logs.forEach((log) => {
      if (
        log.topics[0] in this.eventHandlersMap &&
        this.addressSet.has(log.address.toLowerCase())
      ) {
        const eventHandler = this.eventHandlersMap[log.topics[0]];
        const param = this.addressToParams[log.address.toLowerCase()];
        const swapEvent = eventHandler.decodeLog(log, param);
        this.swapEvents.push(swapEvent);
      }
    });
  }

  async processLogs(fromBlock: number, toBlock: number) {
    await this.getLogs(fromBlock, toBlock);
    logger.info(`${this.swapEvents.length} num of events found to process`);
    const totalVolumeUSD = this.swapEvents
      .sort((a, b) => {
        if (a.blockNumber !== b.blockNumber) {
          return a.blockNumber - b.blockNumber;
        }
        if (a.transactionIndex !== b.transactionIndex) {
          return a.transactionIndex - b.transactionIndex;
        }
        return a.logIndex - b.logIndex;
      })
      .map(
        ({
          fromToken,
          toToken,
          amountIn,
          amountOut,
          blockNumber,
          address,
          protocol,
        }) => {
          if (fromToken === toToken) {
            return Zero;
          }
          try {
            const volumeUSD = this.tokenPricing.volumeInUSD(
              fromToken,
              amountIn,
              toToken,
              amountOut,
              blockNumber,
              address,
              protocol
            );
            return volumeUSD;
          } catch (error) {
            // skip errors
            logger.error(error);
            return Zero;
          }
        }
      )
      .reduce((res, cur) => res.plus(cur), Zero);

    // clean consumed events
    this.swapEvents.length = 0;
    return totalVolumeUSD;
  }
  async syncLogs(currentBlockNumber: number) {
    // fast-sync
    const toBlock = currentBlockNumber - this.confirmation;
    const fromBlock = this.fromBlock;

    // fetch logs by batch
    for (let block = fromBlock; block <= toBlock; block += this.fastSyncBatch) {
      const fromBlockPerBatch = block;
      const toBlockPerBatch = Math.min(block + this.fastSyncBatch - 1, toBlock);
      const totalVolumeInUSD = await this.processLogs(
        fromBlockPerBatch,
        toBlockPerBatch
      );
      this.totalVolumeInUSD = this.totalVolumeInUSD.plus(
        totalVolumeInUSD.toString()
      );

      logger.info(
        `processing logs in range [${fromBlockPerBatch}, ${toBlockPerBatch}]`
      );
    }
    // fast-forward
    this.fromBlock = toBlock + 1;
  }

  async start() {
    while (true) {
      const currentBlockNumber = await this.provider.getBlockNumber();
      await this.syncLogs(currentBlockNumber);
      if (currentBlockNumber - this.fromBlock < this.confirmation) {
        break;
      }
    }

    this.provider.on("block", async (blockTag) => {
      if (blockTag >= this.fromBlock + this.confirmation) {
        const toBlock = blockTag - this.confirmation;
        const totalVolumeInUSD = await this.processLogs(
          this.fromBlock,
          toBlock
        );
        this.totalVolumeInUSD = this.totalVolumeInUSD.plus(
          totalVolumeInUSD.toString()
        );
        // fast-forward
        this.fromBlock = toBlock + 1;
      }
    });
  }
}
