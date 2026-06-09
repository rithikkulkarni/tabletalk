import type { ColumnDef, DatasetInfo } from './types';

// ── Candy generation lookups ──────────────────────────────────────────────────
const PRODUCTS: [string, string, number][] = [
  ['Milk Chocolate Bar',     'Chocolate',  3.99],
  ['Dark Chocolate Truffle', 'Chocolate',  7.49],
  ['White Chocolate Bark',   'Chocolate',  5.99],
  ['Caramel Chocolate',      'Chocolate',  4.49],
  ['Peanut Butter Cup',      'Chocolate',  2.99],
  ['Gummy Bears',            'Gummy',      2.49],
  ['Gummy Worms',            'Gummy',      2.49],
  ['Peach Rings',            'Gummy',      1.99],
  ['Sour Gummy Worms',       'Gummy',      2.99],
  ['Peppermint Twist',       'Hard Candy', 1.49],
  ['Butterscotch Drop',      'Hard Candy', 1.29],
  ['Rock Candy',             'Hard Candy', 3.49],
  ['Sour Patch Kids',        'Sour',       3.29],
  ['Sour Belts',             'Sour',       2.79],
  ['Warheads',               'Sour',       1.99],
  ['Classic Lollipop',       'Lollipop',   0.99],
  ['Ring Pop',               'Lollipop',   1.49],
  ['Blow Pop',               'Lollipop',   1.29],
  ['Pop Rocks',              'Novelty',    1.99],
  ['Fun Dip',                'Novelty',    1.49],
  ['Jawbreaker',             'Novelty',    0.79],
  ['Candy Necklace',         'Novelty',    1.99],
];
const STORES: [string, string][] = [
  ['Main Street',  'North'],
  ['Mall Kiosk',   'East'],
  ['Airport Shop', 'Central'],
  ['Downtown',     'South'],
  ['Online',       'Online'],
];
const SEGMENTS   = ['Kids','Teens','Young Adults','Adults','Seniors'];
const OCCASIONS  = ['Impulse','Gifting','Personal Treat','Party / Event','Holiday'];
const CHANNELS   = ['In-Store Display','Social Media Ad','Email Campaign','Word of Mouth','No Attribution'];
const PROMOS     = ['None','Percent Discount','BOGO','Bundle Deal','Seasonal'];
const CUST_TYPES = ['New','Returning','Loyal'];
const CANDY_PAY  = ['Cash','Credit Card','Debit Card','Gift Card'];
const MONTHS     = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];
const SEG_WEIGHTS: number[][] = [
  [5,  15, 20, 35, 25],  // Chocolate
  [35, 30, 20, 10,  5],  // Gummy
  [5,  10, 15, 35, 35],  // Hard Candy
  [18, 42, 28, 10,  2],  // Sour
  [5,  10, 15, 35, 35],  // Hard Candy
  [50, 25, 15,  8,  2],  // Lollipop
  [40, 35, 15,  8,  2],  // Novelty
];
const WEAK_SELLERS = new Set(['Classic Lollipop','Gummy Worms','Candy Necklace','Butterscotch Drop']);

// ── Mulberry32 PRNG ───────────────────────────────────────────────────────────
let randSeed = 0;

function seedRand(seed: number) { randSeed = seed; }

function nextRand(): number {
  randSeed = (randSeed + 0x6d2b79f5) | 0;
  let t = Math.imul(randSeed ^ (randSeed >>> 15), 1 | randSeed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function pickIdx(weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = nextRand() * total;
  for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) return i; }
  return weights.length - 1;
}

// ── Column definitions ────────────────────────────────────────────────────────

function col(field: string, headerText: string, numeric: boolean, currency: boolean): ColumnDef {
  return { field, headerText, numeric, currency, visible: true };
}

function candyColumns(): ColumnDef[] {
  return [
    col('saleId',           'Sale ID',           false, false),
    col('date',             'Date',              false, false),
    col('month',            'Month',             false, false),
    col('product',          'Product',           false, false),
    col('category',         'Category',          false, false),
    col('store',            'Store',             false, false),
    col('region',           'Region',            false, false),
    col('customerSegment',  'Customer Segment',  false, false),
    col('customerType',     'Customer Type',     false, false),
    col('purchaseOccasion', 'Purchase Occasion', false, false),
    col('marketingChannel', 'Marketing Channel', false, false),
    col('promoType',        'Promo Type',        false, false),
    col('discountPct',      'Discount %',        true,  false),
    col('quantity',         'Quantity',          true,  false),
    col('unitPrice',        'Unit Price',        true,  true),
    col('grossTotal',       'Gross Total',       true,  true),
    col('total',            'Total',             true,  true),
    col('satisfaction',     'Satisfaction',      true,  false),
    col('paymentMethod',    'Payment Method',    false, false),
  ];
}

// ── Dataset builder ───────────────────────────────────────────────────────────

function buildCandy(): DatasetInfo {
  seedRand(42);
  const rows: Record<string, unknown>[] = [];

  function segWeightsFor(category: string): number[] {
    switch (category) {
      case 'Chocolate':  return SEG_WEIGHTS[0];
      case 'Gummy':      return SEG_WEIGHTS[1];
      case 'Hard Candy': return SEG_WEIGHTS[2];
      case 'Sour':       return SEG_WEIGHTS[3];
      case 'Lollipop':   return SEG_WEIGHTS[5];
      default:           return SEG_WEIGHTS[6];
    }
  }

  function occasionWeights(month1: number): number[] {
    if (month1 === 1 || month1 === 2)          return [20, 30, 20, 10, 20];
    if (month1 === 10)                          return [20, 10, 15, 20, 35];
    if (month1 === 11 || month1 === 12)         return [15, 30, 15, 10, 30];
    return [40, 10, 35, 12, 3];
  }

  function channelWeights(store: string): number[] {
    return store === 'Online' ? [2, 38, 32, 18, 10] : [45, 15, 10, 25, 5];
  }

  function promoWeights(month1: number): number[] {
    if (month1 === 10 || month1 === 11 || month1 === 12) return [50, 12,  8,  8, 22];
    if (month1 === 1  || month1 === 2)                   return [55, 18, 10, 12,  5];
    return [70, 12, 8, 8, 2];
  }

  for (let i = 0; i < 200; i++) {
    const dayOfYear = Math.floor(nextRand() * 365);
    const date = new Date(2024, 0, 1);
    date.setDate(date.getDate() + dayOfYear);
    const month  = date.getMonth();
    const month1 = month + 1;
    const dateStr = date.toISOString().slice(0, 10);

    const productWeights = PRODUCTS.map(([, cat]) => {
      switch (cat) {
        case 'Chocolate':  return (month <= 1 || month >= 10 || month === 3) ? 2.5 : 1;
        case 'Gummy':
        case 'Sour':       return (month >= 5 && month <= 8) ? 2 : 1;
        case 'Novelty':    return month === 9 ? 3 : 1;
        default:           return 1;
      }
    });
    const [productName, category, unitPrice] = PRODUCTS[pickIdx(productWeights)];
    const [store, storeRegion] = STORES[Math.floor(nextRand() * STORES.length)];

    const segment  = SEGMENTS [pickIdx(segWeightsFor(category))];
    const occasion = OCCASIONS[pickIdx(occasionWeights(month1))];
    const channel  = CHANNELS [pickIdx(channelWeights(store))];
    const promo    = PROMOS   [pickIdx(promoWeights(month1))];
    const custType = CUST_TYPES[pickIdx([28, 50, 22])];

    const satWeights = WEAK_SELLERS.has(productName) ? [6, 14, 28, 32, 20] : [2, 5, 16, 38, 39];
    const satisfaction = [1,2,3,4,5][pickIdx(satWeights)];

    let discountPct: number;
    switch (promo) {
      case 'None':        discountPct = 0;  break;
      case 'BOGO':        discountPct = 50; break;
      case 'Bundle Deal': discountPct = 15; break;
      case 'Seasonal':    discountPct = 25; break;
      default:            discountPct = [10,15,20][pickIdx([40,35,25])];
    }

    const baseQty = custType === 'Loyal' ? 6 : 1;
    const maxQty  = custType === 'Loyal' ? 30 : 24;
    const quantity = baseQty + Math.floor(nextRand() * (maxQty - baseQty + 1));

    const grossTotal = Math.round(unitPrice * quantity * 100) / 100;
    const total      = Math.round(grossTotal * (1 - discountPct / 100) * 100) / 100;
    const payMethod  = CANDY_PAY[pickIdx([20, 45, 25, 10])];

    rows.push({
      saleId: `CS-${String(i + 1).padStart(4, '0')}`,
      date: dateStr, month: MONTHS[month], product: productName, category,
      store, region: storeRegion, customerSegment: segment, customerType: custType,
      purchaseOccasion: occasion, marketingChannel: channel, promoType: promo,
      discountPct, quantity, unitPrice, grossTotal, total, satisfaction, paymentMethod: payMethod,
    });
  }
  return { id: 'candy', label: 'Candy Store Sales', columns: candyColumns(), rows };
}

// ── Dataset cache ─────────────────────────────────────────────────────────────

let _datasets: Map<string, DatasetInfo> | null = null;

export function getAllDatasets(): Map<string, DatasetInfo> {
  if (_datasets) return _datasets;
  const map = new Map<string, DatasetInfo>();
  map.set('candy', buildCandy());
  _datasets = map;
  return map;
}

export function getDataset(id: string): DatasetInfo {
  const map = getAllDatasets();
  return map.get(id) ?? map.values().next().value!;
}
