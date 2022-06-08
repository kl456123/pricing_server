import axios from "axios";

import { logger } from "../src/logging";
import { tokensEthereum } from "../src/tokens";
import { Protocol } from "../src/types";

import dotenv from "dotenv";
dotenv.config();
// const url = `http://35.75.165.133:8547`;
const url = `http://${process.env.SERVER_IP}:${process.env.SERVER_PORT}`;

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

async function main() {
  // query token price
  await requestLatestPrice({ address: tokensEthereum.WETH.address });
  await requestLatestPrice({ address: tokensEthereum.WBTC.address });
  await requestLatestPrice({
    address: "0x8B3192f5eEBD8579568A2Ed41E6FEB402f93f73F",
  }); // SAITAMA
  await requestLatestPrice({
    address: "0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE",
  }); // SHIB
  await requestLatestPrice({
    address: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984",
  }); // UNI
}

main();
