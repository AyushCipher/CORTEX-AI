import { initializeApp, cert } from "firebase-admin/app";
import fs from "fs";
import path from "path";

const serviceAccountPath = path.resolve("./serviceAccount.json");

let app;

if (fs.existsSync(serviceAccountPath)) {
  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf-8"));

  app = initializeApp({
    credential: cert(serviceAccount)
  });
} else {
  console.warn(
    "serviceAccount.json not found — Firebase auth is disabled. /login will return 503 until it is provided."
  );
}

export { app };
