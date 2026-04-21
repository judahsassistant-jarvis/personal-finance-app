const { onRequest } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");

setGlobalOptions({ region: "europe-west2", maxInstances: 10 });

exports.healthcheck = onRequest((req, res) => {
  res.json({ ok: true, region: "europe-west2", ts: new Date().toISOString() });
});
