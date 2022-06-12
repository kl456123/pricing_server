import fs from "fs";

import axios from "axios";
import dotenv from "dotenv";
import { ethers } from "ethers";

import { logger } from "../src/logging";
import { tokensEthereum } from "../src/tokens";
import { Protocol } from "../src/types";

dotenv.config();
// const url = `http://35.75.165.133:8547`;
const url = `http://${process.env.SERVER_IP}:${process.env.SERVER_PORT}`;

async function requestLatestPrice(query: { address: string }) {
  return requestGet(query, "/latestPrice");
}

async function requestHistoryUSDPrice(query: { address: string }) {
  return requestGet(query, "/historyUSDPrice");
}

async function requestLatestVolumeInUSD(query: {
  address: string;
  confirmation?: number;
}) {
  return requestGet(query, "/latestVolumeInUSD");
}

async function requestGet(
  query: { address: string; confirmation?: number },
  routePath: string
) {
  const res = await axios.get(`${url}${routePath}`, { params: query });
  const quoteRes = res.data;
  return quoteRes;
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

type HistoryPrice = { price: string; volume: string; blockNumber: string };
type HistoryPriceWithTiemStamp = HistoryPrice & { timeStamp: number };

function getTimeStamp(
  startBlockNumber: number,
  blockNumber: number,
  interval: number,
  startTimeStamp: number
) {
  return startTimeStamp + (blockNumber - startBlockNumber) * interval;
}

async function saveHistoryPrices(address: string) {
  const { historyPrices: historyPricesWithFirst } =
    (await requestHistoryUSDPrice({
      address,
    })) as { historyPrices: HistoryPrice[] };
  const historyPrices = historyPricesWithFirst.slice(1);
  if (historyPrices && !historyPrices.length) {
    logger.info(`no history price of token: ${address}`);
    return;
  }

  const provider = new ethers.providers.JsonRpcProvider(
    `http://35.75.165.133:8545`
  );
  const startBlockNumber = parseInt(historyPrices[0].blockNumber);
  const endBlockNumber = parseInt(
    historyPrices[historyPrices.length - 1].blockNumber
  );
  const startTimeStamp = (await provider.getBlock(startBlockNumber)).timestamp;
  const endTimeStamp = (await provider.getBlock(endBlockNumber)).timestamp;
  const interval = Math.round(
    (endTimeStamp - startTimeStamp) / (endBlockNumber - startBlockNumber)
  );

  const historyPricesWithTimeStamp: HistoryPriceWithTiemStamp[] =
    historyPrices.map((historyPrice, ind) => ({
      ...historyPrice,
      timeStamp: getTimeStamp(
        startBlockNumber,
        parseInt(historyPrice.blockNumber),
        interval,
        startTimeStamp
      ),
    }));

  fs.writeFileSync(
    "./price.json",
    JSON.stringify(
      historyPricesWithTimeStamp.map((item: HistoryPriceWithTiemStamp) => ({
        ...item,
        price: item.price,
      })),
      null,
      4
    )
  );
}

async function main() {
  // query token price
  const wethPriceInUSD = await requestLatestPrice({
    address: tokensEthereum.WETH.address,
  });
  logger.info(wethPriceInUSD);
  await saveHistoryPrices("0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84");
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

  await requestLatestVolumeInUSD({
    address: "0xd632f22692FaC7611d2AA1C0D552930D43CAEd3B",
  });
  const volumeInUSD = await requestLatestVolumeInUSD({
    address: "0xDC24316b9AE028F1497c275EB9192a3Ea0f67022",
    confirmation: 0,
  });
  logger.info(volumeInUSD);
}

main();
