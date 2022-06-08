import { ethers, Contract, BytesLike } from "ethers";
import { Log } from "@ethersproject/abstract-provider";
import { Interface } from "@ethersproject/abi";
import { BigNumber } from "bignumber.js";
import { UniswapV2Pair__factory, UniswapV3Pool__factory } from "./typechain";
import { Protocol, SwapEvent } from "./types";
import { TokenPricing } from "./pricing";
import { tokensEthereum as tokens } from "./tokens";
import { logger } from "./logging";

const Zero = new BigNumber(0);

type EventHandlerType = {
  decodeLog: (log: Log) => Promise<SwapEvent>;
  protocol: Protocol;
};

export class EventSubscriber {
  // protected uniswapV2: Contract;
  protected swapEvents: SwapEvent[];
  protected eventHandlersMap: Record<string, EventHandlerType>;
  protected addressSet: Set<string>;

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
    this.decimals = 8;

    this.initEventHandlersMap();
  }

  initEventHandlersMap() {
    // uniswapv2
    const uniswapV2Iface = UniswapV2Pair__factory.createInterface();
    const uniswapV3Iface = UniswapV3Pool__factory.createInterface();
    this.eventHandlersMap[uniswapV2Iface.getEventTopic("Swap")] = {
      protocol: Protocol.UniswapV2,
      decodeLog: async (log: Log) => {
        const pairContract = UniswapV2Pair__factory.connect(
          log.address,
          this.provider
        );
        const token0 = await pairContract.token0();
        const token1 = await pairContract.token1();
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
      decodeLog: async (log: Log) => {
        const pairContract = UniswapV3Pool__factory.connect(
          log.address,
          this.provider
        );
        const token0 = await pairContract.token0();
        const token1 = await pairContract.token1();
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
      decodeLog: async (log: Log) => {
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

    const balancerABI = [
      "event LOG_SWAP(address indexed caller, address indexed tokenIn, address indexed tokenOut, uint256 tokenAmountIn, uint256 tokenAmountOut)",
    ];
    const balancerIface = new ethers.utils.Interface(balancerABI);
    this.eventHandlersMap[balancerIface.getEventTopic("LOG_SWAP")] = {
      protocol: Protocol.Balancer,
      decodeLog: async (log: Log) => {
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
  }

  public registerPublisher(contractAddr: string) {
    if (!this.isRegisteredAlready(contractAddr)) {
      this.addressSet.add(contractAddr.toLowerCase());
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
    const logs = await this.provider.getLogs({ fromBlock, toBlock });
    const promises = logs.map(async (log) => {
      if (
        log.topics[0] in this.eventHandlersMap &&
        this.addressSet.has(log.address.toLowerCase())
      ) {
        const eventHandler = this.eventHandlersMap[log.topics[0]];
        const swapEvent = await eventHandler.decodeLog(log);
        this.swapEvents.push(swapEvent);
      }
    });
    await Promise.all(promises);
  }

  async syncLogs(fromBlock: number, toBlock: number) {
    await this.getLogs(fromBlock, toBlock);
    logger.info(`${this.swapEvents.length} num of events found`);
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

  start() {
    this.provider.on("block", async (blockTag) => {
      if (blockTag >= this.fromBlock + this.confirmation) {
        const toBlock = blockTag - this.confirmation;
        const totalVolumeInUSD = await this.syncLogs(this.fromBlock, toBlock);
        this.totalVolumeInUSD = this.totalVolumeInUSD.plus(
          totalVolumeInUSD.toString()
        );
        // fast-forward
        this.fromBlock = toBlock + 1;
      }
    });
  }
}
