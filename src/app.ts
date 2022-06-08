import Koa from "koa";
import { getAllRouters } from "./router";
import { ethers } from "ethers";
import { Database } from "./mongodb";
import { EventSubscriber } from "./event_subscriber";
import { TokenPricing } from "./pricing";
import { logger } from "./logging";
import { Token, DatabaseToken, DatabasePool, Protocol } from "./types";
import { balancerV2VaultAddr } from "./constants";
import dotenv from "dotenv";

dotenv.config();

async function getApp() {
  const app = new Koa();
  const options = {
    url: process.env.MAINNET_URL,
    tokenCollectionName: "tokens",
    poolsCollectionName: "pools",
    dbConnection:
      process.env.DB_CONNECTION ||
      "mongodb://127.0.0.1:27017/?directConnection=true&serverSelectionTimeoutMS=2000&appName=mongosh+1",
    dbName: "dex",
    tick: 20,
    serverPort: process.env.SERVER_PORT || "3000",
    serverIP: process.env.SERVER_IP || "127.0.0.1",
  };

  const provider = new ethers.providers.JsonRpcProvider(options.url);
  const currentBlockNumber = await provider.getBlockNumber();
  const fromBlock = currentBlockNumber;

  const database = new Database(options.dbConnection);
  await database.initDB(options.dbName);

  const tokens: DatabaseToken[] = await database.loadMany<DatabaseToken>(
    {},
    options.tokenCollectionName
  );

  const pools: DatabasePool[] = await database.loadMany<DatabasePool>(
    {},
    options.poolsCollectionName
  );
  const tokensMap: Record<string, Token> = {};
  tokens.forEach((token) => {
    tokensMap[token.address.toLowerCase()] = {
      address: token.address.toLowerCase(),
      decimals: token.decimals,
      symbol: token.symbol,
      name: token.name,
    };
  });

  const tokenPricing = new TokenPricing(options.tick, tokensMap, provider);
  const eventSubscriber = new EventSubscriber(
    tokenPricing,
    provider,
    fromBlock
  );
  // register some addresses before start
  pools
    .filter((pool) => pool.protocol !== Protocol.BalancerV2)
    .map((pool) => eventSubscriber.registerPublisher(pool.id));
  // register balancerv2 using vault address
  eventSubscriber.registerPublisher(balancerV2VaultAddr);
  eventSubscriber.start();

  const router = await getAllRouters(eventSubscriber, tokenPricing);
  app.use(router.routes());

  app.listen(parseInt(options.serverPort), options.serverIP);
  logger.info(`start listening at ${options.serverIP}:${options.serverPort}`);
  return app;
}

getApp();
