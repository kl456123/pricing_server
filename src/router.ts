import Router from "@koa/router";

import { EventSubscriber } from "./event_subscriber";
import { logger } from "./logging";
import { TokenPricing } from "./pricing";

export function getAllRouters(
  eventSuscriber: EventSubscriber,
  tokenPricing: TokenPricing
) {
  const router = new Router();

  router.get("/", (ctx) => {
    ctx.body = "token price reporter server";
  });

  router.get("/registerListener", (ctx) => {
    const query = ctx.query;
    const address = query.address as string;
    const isRegistered = eventSuscriber.registerPublisher(address);
    if (isRegistered) {
      const msg = `${address} is registered successfully`;
      logger.info(msg);
      ctx.body = {
        msg,
      };
    } else {
      const errorMsg = `${address} is registered already, ignored`;
      logger.warn(errorMsg);
      ctx.body = {
        msg: errorMsg,
      };
    }
  });

  router.get("/latestPrice", (ctx) => {
    const address = ctx.query.address as string;
    const { round, price, volume, priceWithVolumePerPool } =
      tokenPricing.getLatestPriceInUSD(address);
    ctx.body = {
      token: address,
      price,
      volume,
      round,
      priceWithVolumePerPool,
    };
  });

  router.get("/latestVolumeInUSD", (ctx) => {
    const address = ctx.query.address as string;
    // zero means no need to confirm
    const confirmation = ctx.query.confirmation
      ? parseInt(ctx.query.confirmation as string)
      : 0;
    const volumeInUSD = tokenPricing.getLatestVolumeInUSD(
      address,
      confirmation
    );
    ctx.body = volumeInUSD;
  });

  router.get("/historyUSDPrice", (ctx) => {
    const address = ctx.query.address as string;
    // const blockNumber = ctx.query.blockNumber as string;
    const historyPrices = tokenPricing.getHistoryUSDPrice(address);
    ctx.body = {
      historyPrices,
    };
  });
  return router;
}
