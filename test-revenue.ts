import dotenv from 'dotenv';
dotenv.config();

import { YandexDirectClient } from './src/modules/yandex/client';
import { YandexConfig } from './src/modules/yandex/types';

const config: YandexConfig = {
  clientId: process.env.YANDEX_CLIENT_ID || '',
  clientSecret: process.env.YANDEX_CLIENT_SECRET || '',
  accessToken: process.env.YANDEX_ACCESS_TOKEN || '',
  refreshToken: process.env.YANDEX_REFRESH_TOKEN || '',
};

async function testRevenue() {
  const client = new YandexDirectClient(config, true); // debug mode true

  // Get date range for last 3 days
  const today = new Date();
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(today.getDate() - 3);

  const dateTo = today.toISOString().split('T')[0];
  const dateFrom = threeDaysAgo.toISOString().split('T')[0];

  console.log(`Fetching stats from ${dateFrom} to ${dateTo}...`);

  // We need to access the private method or just copy the logic to see raw data
  // Since we can't easily access private methods in this script without reflection or modifying code,
  // I will just use the public getStats which logs response in debug mode.
  // I will rely on the console output of the client which logs response data.

  try {
    const stats = await client.getStats(dateFrom, dateTo);
    console.log('Parsed Stats:', JSON.stringify(stats, null, 2));
  } catch (error) {
    console.error('Error:', error);
  }
}

testRevenue();
