import axios from "axios";
import dotenv from "dotenv";

import { logger } from "../src/logging";
import { tokensEthereum } from "../src/tokens";
import { Protocol } from "../src/types";

dotenv.config();
// const url = `http://35.75.165.133:8547`;
const url = `http://${process.env.SERVER_IP}:${process.env.SERVER_PORT}`;

async function requestLatestPrice(query: { address: string }) {
  requestGet(query, "/latestPrice");
}

async function requestLatestVolumeInUSD(query: {
  address: string;
  confirmation?: number;
}) {
  requestGet(query, "/latestVolumeInUSD");
}

async function requestGet(
  query: { address: string; confirmation?: number },
  routePath: string
) {
  const res = await axios.get(`${url}${routePath}`, { params: query });
  const quoteRes = res.data;
  logger.info(quoteRes);
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
    address: "0x956F47F50A910163D8BF957Cf5846D573E7f87CA",
  }); // UNI

  // WETH/USDC
  await requestLatestVolumeInUSD({
    address: "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640",
  });
  requestLatestVolumeInUSD({
    address: "0xd632f22692FaC7611d2AA1C0D552930D43CAEd3B",
  });
}

main();
