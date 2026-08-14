/**
 * MongoDB client for Next.js API routes. Single database: set MONGO_URL (or MONGODB_URI) and DB_NAME.
 * Client is cached for serverless.
 */

import { MongoClient, Db } from "mongodb";

const uri = process.env.MONGO_URL ?? process.env.MONGODB_URI ?? "";
const dbName = process.env.DB_NAME ?? "";

declare global {
  // eslint-disable-next-line no-var
  var _mongoClient: MongoClient | undefined;
}

function getClient(): MongoClient {
  if (!uri) throw new Error("Missing MONGO_URL or MONGODB_URI");
  if (globalThis._mongoClient) return globalThis._mongoClient;
  const client = new MongoClient(uri);
  globalThis._mongoClient = client;
  return client;
}

function getDefaultDb(): Db {
  const client = getClient();
  if (!dbName) throw new Error("Missing DB_NAME");
  return client.db(dbName);
}

/** Main app database (contact_submissions, etc.). */
export function getDb(): Db {
  return getDefaultDb();
}

/** Same database (blogs, plans, contact_submissions, etc.). */
export function getAdminDb(): Db {
  return getDefaultDb();
}
