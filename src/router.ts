import Router from "@koa/router";
import { EventSubscriber, ContractPublisher } from "./event_subscriber";
import { TokenPricing } from "./pricing";
import { logger } from "./logging";
import { Protocol } from "./types";

export async function getAllRouters(
  eventSuscriber: EventSubscriber,
  tokenPricing: TokenPricing
) {
  const router = new Router();

  router.get("/", async (ctx) => {
    ctx.body = "token price reporter server";
  });

  router.get("/registerListener", async (ctx) => {
    const query = ctx.query;
    const contractPub: ContractPublisher = {
      protocol: parseInt(query.protocol as string),
      address: query.address as string,
      fromToken: query.fromToken as string | undefined,
      toToken: query.toToken as string | undefined,
    };
    const isRegistered = eventSuscriber.registerPublisher(contractPub);
    if (isRegistered) {
      const msg = `${contractPub.address}[${
        Protocol[contractPub.protocol]
      }] is registered successfully`;
      logger.info(msg);
      ctx.body = {
        msg,
      };
    } else {
      const errorMsg = `${contractPub.address}[${
        Protocol[contractPub.protocol]
      }] is registered already, ignored`;
      logger.warn(errorMsg);
      ctx.body = {
        msg: errorMsg,
      };
    }
  });

  router.get("/latestPrice", async (ctx) => {
    const address = ctx.query.address as string;
    const { round, price, volume, priceWithVolumePerPool } =
      tokenPricing.getLatestPriceInUSD(address);
    ctx.body = {
      token: address,
      price,
      volume,
    };
  });

  router.get("/historyUSDPrice", async (ctx) => {
    const address = ctx.query.address as string;
    // const blockNumber = ctx.query.blockNumber as string;
    const historyPrices = tokenPricing.getHistoryUSDPrice(address);
    ctx.body = {
      historyPrices,
    };
  });
  return router;
}
