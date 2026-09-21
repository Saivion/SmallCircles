import { defineApp } from "convex/server";
import staticHosting from "@convex-dev/static-hosting/convex.config";

const app = defineApp();
// Serves the exported Next.js site at https://<deployment>.convex.site.
// App HTTP routes (webhook, health) stay at the root; see http.ts.
app.use(staticHosting);

export default app;
