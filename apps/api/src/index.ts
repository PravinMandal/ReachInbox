import { createApp, initSearch } from "./app.js";
import { env, isVercel } from "./env.js";
import { logger } from "./logger.js";

const app = createApp();

if (!isVercel) {
  initSearch();
  app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, "api listening");
  });
}

export default app;
