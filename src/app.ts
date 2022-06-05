import Koa from "koa";
import { getAllRouters } from "./router";
import { ethers } from "ethers";
import { Database } from "./mongodb";
import { EventSubscriber } from "./event_subscriber";
import { TokenPricing } from "./pricing";
import { logger } from "./logging";
import { Token, DatabaseToken, Protocol } from "./types";
import dotenv from "dotenv";

dotenv.config();

async function getApp() {
  const app = new Koa();
  const options = {
    url: process.env.MAINNET_URL,
    tokenCollectionName: "tokens",
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
  const tokensMap: Record<string, Token> = {};
  tokens.forEach((token) => {
    tokensMap[token.id.toLowerCase()] = {
      address: token.id.toLowerCase(),
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
  eventSubscriber.start();

  const router = await getAllRouters(eventSubscriber, tokenPricing);
  app.use(router.routes());

  app.listen(parseInt(options.serverPort), options.serverIP);
  logger.info(`start listening at ${options.serverIP}:${options.serverPort}`);
  return app;
}

getApp();
