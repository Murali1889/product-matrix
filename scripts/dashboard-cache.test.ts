import assert from 'node:assert/strict';

import {
  createDashboardCacheKey,
  createDashboardInputSignature,
  readDashboardCache,
  writeDashboardCache,
} from '../src/lib/dashboard-cache';

class MemoryStorage {
  private store = new Map<string, string>();

  getItem(key: string) {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
}

const clients = [
  {
    client_id: 'c1',
    client_name: 'Alpha',
    isInMasterList: true,
    profile: { segment: 'NBFC', geography: 'India', billing_currency: 'USD' },
    monthly_data: [
      {
        month: 'May 2026',
        total_revenue_usd: 100,
        apis: [
          { name: 'PAN', revenue_usd: 70 },
          { name: 'Bank Account', revenue_usd: 30 },
        ],
      },
      { month: 'Apr 2026', total_revenue_usd: 80, apis: [{ name: 'PAN', revenue_usd: 80 }] },
    ],
  },
  {
    client_id: 'c2',
    client_name: 'Beta',
    isInMasterList: true,
    profile: { segment: 'Payments', geography: 'India', billing_currency: 'USD' },
    monthly_data: [
      { month: 'May 2026', total_revenue_usd: 45, apis: [{ name: 'OCR', revenue_usd: 45 }] },
    ],
  },
];

const signatureInput = {
  month: '',
  masterAPICount: 12,
  clients,
};

assert.equal(createDashboardCacheKey(''), 'pm_dashboard_v1_default');
assert.equal(createDashboardCacheKey('2026-05'), 'pm_dashboard_v1_2026-05');

const storage = new MemoryStorage();
const signature = createDashboardInputSignature(signatureInput);

writeDashboardCache(storage, createDashboardCacheKey(''), signature, { totalRevenue: 145 }, 123);
assert.deepEqual(readDashboardCache(storage, createDashboardCacheKey(''), signature), {
  totalRevenue: 145,
});

assert.equal(readDashboardCache(storage, createDashboardCacheKey(''), 'stale-signature'), null);

const revenueChangedSignature = createDashboardInputSignature({
  ...signatureInput,
  clients: [
    {
      ...clients[0],
      monthly_data: [
        { ...clients[0].monthly_data[0], total_revenue_usd: 101 },
        clients[0].monthly_data[1],
      ],
    },
    clients[1],
  ],
});
assert.notEqual(revenueChangedSignature, signature);

const apiChangedSignature = createDashboardInputSignature({
  ...signatureInput,
  clients: [
    {
      ...clients[0],
      monthly_data: [
        {
          ...clients[0].monthly_data[0],
          apis: [{ name: 'Face Match', revenue_usd: 100 }],
        },
        clients[0].monthly_data[1],
      ],
    },
    clients[1],
  ],
});
assert.notEqual(apiChangedSignature, signature);

console.log('dashboard-cache tests passed');
