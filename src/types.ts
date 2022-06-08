export enum Protocol {
  UniswapV2,
  UniswapV3,
  Curve,
  CurveV2,
  Balancer,
  BalancerV2,
  Bancor,
  Kyber,
  DODO,
}

export type Token = {
  address: string;
  symbol: string;
  name?: string;
  decimals: number;
};

export type DatabaseToken = {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
};

export type DatabasePool = {
  protocol: Protocol;
  id: string;
  tokens: string[];
  liquidity: string[];
  poolData?: unknown;
};

export type SwapEvent = {
  amountIn: string;
  amountOut: string;
  fromToken: string;
  toToken: string;
  blockNumber: number;
  protocol: Protocol;
  logIndex: number;
  transactionIndex: number;
  address: string;
};
