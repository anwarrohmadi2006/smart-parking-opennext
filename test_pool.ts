import { Pool } from "@neondatabase/serverless";
const dbUrl = "postgresql://neondb_owner:npg_UTKFYWe58slZ@ep-aged-credit-aojkkv5q-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
const pool = new Pool({ connectionString: dbUrl });
console.log(pool);
