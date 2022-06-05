import axios from "axios";

import { logger } from "../src/logging";
import { tokensEthereum } from "../src/tokens";
import { Protocol } from "../src/types";

const url = `http://127.0.0.1:3000`;
// const url = `http://35.75.165.133:8547`;

async function requestLatestPrice(query: { address: string }) {
  try {
    const res = await axios.get(`${url}/latestPrice`, { params: query });
    const quoteRes = res.data;
    logger.info(quoteRes);
  } catch (error: any) {
    logger.fatal(`${error.response}`);
  }
}

async function requestRegisterListener(query: {
  protocol: number;
  address: string;
}) {
  try {
    const res = await axios.get(`${url}/registerListener`, { params: query });
    const quoteRes = res.data;
    logger.info(quoteRes);
  } catch (error: any) {
    logger.fatal(`${error.response}`);
  }
}

async function registerAllListeners() {
  const contractPubs = [];
  contractPubs.push({
    address: "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc", // WETH/USDC
    protocol: Protocol.UniswapV2,
  });
  contractPubs.push({
    address: "0x0d4a11d5EEaaC28EC3F61d100daF4d40471f1852", // WETH/USDT
    protocol: Protocol.UniswapV2,
  });
  contractPubs.push({
    address: "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640", // WETH/USDC
    protocol: Protocol.UniswapV3,
  });
  contractPubs.push({
    address: "0x11b815efB8f581194ae79006d24E0d814B7697F6", // WETH/USDT
    protocol: Protocol.UniswapV3,
  });
  contractPubs.push({
    address: "0xBA12222222228d8Ba445958a75a0704d566BF2C8", // vault
    protocol: Protocol.BalancerV2,
  });
  contractPubs.push({
    address: "0xE7ce624C00381b4b7aBB03e633fB4aCaC4537dD6", // WETH/USDT
    protocol: Protocol.Balancer,
  });
  contractPubs.push({
    address: "0x4585FE77225b41b697C938B018E2Ac67Ac5a20c0", // WBTC/WETH
    protocol: Protocol.UniswapV3,
  });
  contractPubs.push({
    address: "0xBb2b8038a1640196FbE3e38816F3e67Cba72D940", // WBTC/WETH
    protocol: Protocol.UniswapV2,
  });

  for (const contractPub of contractPubs) {
    await requestRegisterListener(contractPub);
  }
}

async function main() {
  await registerAllListeners();

  // query token price
  await requestLatestPrice({ address: tokensEthereum.WETH.address });
  await requestLatestPrice({ address: tokensEthereum.WBTC.address });
}

main();
