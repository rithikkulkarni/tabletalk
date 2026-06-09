/**
 * Port of DatasetService.java — generates all 5 datasets at module load time.
 * The Mulberry32 PRNG and all generation logic are faithful TypeScript ports.
 */
import type { ColumnDef, DatasetInfo } from './types';
import { fetchSepTransactions } from './sep-api';

// ── Payment row factory lookups ───────────────────────────────────────────────
const CARRIERS     = ['Aetna', 'Cigna', 'United', 'Humana'];
const STATUSES     = ['Paid', 'Failed', 'Pending'];
const PAY_METHODS  = ['ACH', 'Credit Card', 'Wire'];
const REGIONS      = ['Southeast', 'Midwest', 'Northeast', 'South', 'West', 'East'];
const PREFIXES = [
  'Oak Valley','Summit Ridge','Riverbend','Cedar Point','Maple Harbor',
  'Pinecrest','Lakeside','Brightstone','Silverline','Westhaven',
  'Redwood','Clearwater','Northstar','Ironwood','Bluewater',
  'Fairview','Granite','Hearthside','Keystone','Mariner',
  'Parkway','Rosemont','Stonebridge','Windward',
];
const SUFFIXES = [
  'Benefits','Insurance','Risk Advisors','Employee Plans',
  'Coverage Group','Health Partners','Benefit Services','Underwriters',
];

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
  [5,  10, 15, 35, 35],  // Hard Candy (duplicate)
  [50, 25, 15,  8,  2],  // Lollipop
  [40, 35, 15,  8,  2],  // Novelty
];
const WEAK_SELLERS = new Set(['Classic Lollipop','Gummy Worms','Candy Necklace','Butterscotch Drop']);

// ── SEP mock data ─────────────────────────────────────────────────────────────
const SEP_FIRSTS = [
  'James','Mary','Robert','Patricia','John','Jennifer','Michael','Linda',
  'William','Barbara','David','Elizabeth','Richard','Susan','Joseph','Jessica',
  'Thomas','Sarah','Charles','Karen','Daniel','Lisa','Matthew','Nancy','Anthony',
  'Mark','Betty','Donald','Margaret','Paul','Sandra','Steven','Ashley','Andrew','Dorothy',
  'Joshua','Kimberly','Ryan','Donna','Kevin','Carol','Brian','Michelle','George','Emily',
];
const SEP_LASTS = [
  'Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis',
  'Rodriguez','Martinez','Wilson','Anderson','Taylor','Thomas','Moore',
  'Jackson','Martin','Lee','Thompson','White','Harris','Clark','Lewis','Robinson','Walker',
  'Hall','Allen','Young','King','Wright','Lopez','Hill','Scott','Green','Adams',
  'Baker','Nelson','Carter','Mitchell','Perez','Roberts','Turner','Phillips','Campbell','Parker',
];
const SEP_DOMAINS  = ['gmail.com','yahoo.com','outlook.com','icloud.com','hotmail.com','protonmail.com'];
const SEP_STATUS_POOL = [
  'APPROVED','APPROVED','APPROVED','APPROVED','APPROVED','APPROVED','APPROVED','APPROVED','APPROVED','APPROVED',
  'APPROVED','APPROVED','APPROVED','APPROVED',
  'DECLINED','DECLINED','DECLINED','DECLINED',
  'PENDING','PENDING',
  'VOIDED',
  'REFUNDED',
];
const REF_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// ── Mulberry32 PRNG ───────────────────────────────────────────────────────────
// Faithful JS port of the Java implementation (uses |0 / Math.imul for 32-bit arithmetic).
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

function sepTransactionColumns(): ColumnDef[] {
  return [
    col('referenceNumber', 'Reference #',    false, false),
    col('billingName',     'Customer',       false, false),
    col('insuredName',     'Insured',        false, false),
    col('policyNumber',    'Policy #',       false, false),
    col('amount',          'Amount',         true,  true),
    col('status',          'Status',         false, false),
    col('depositDate',     'Date',           false, false),
    col('authCode',        'Auth Code',      false, false),
    col('email',           'Email',          false, false),
    col('message',         'Result',         false, false),
    col('transNumber',     'Transaction ID', false, false),
  ];
}

function paymentColumns(): ColumnDef[] {
  return [
    col('paymentId',     'Payment ID',     true,  false),
    col('customer',      'Customer',       false, false),
    col('carrier',       'Carrier',        false, false),
    col('policyNumber',  'Policy Number',  false, false),
    col('amount',        'Amount',         true,  true),
    col('status',        'Status',         false, false),
    col('paymentMethod', 'Payment Method', false, false),
    col('invoiceDate',   'Invoice Date',   false, false),
    col('region',        'Region',         false, false),
  ];
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

// ── Row helpers ───────────────────────────────────────────────────────────────

function payment(
  id: number, customer: string, carrier: string, policy: string,
  amount: number, status: string, method: string, date: string, region: string
): Record<string, unknown> {
  return { paymentId: id, customer, carrier, policyNumber: policy,
           amount, status, paymentMethod: method, invoiceDate: date, region };
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function makeGeneratedRow(
  index: number, idBase: number, policyPrefix: string, policyStart: number,
  dateStart: string, statusOffset: number, amountBase: number, amountStep: number, customerOffset: number
): Record<string, unknown> {
  const dateStr  = addDays(dateStart, index * 2);
  const status   = STATUSES[(index + statusOffset) % STATUSES.length];
  const carrier  = CARRIERS[(index + customerOffset) % CARRIERS.length];
  const payMeth  = PAY_METHODS[(index + statusOffset + 1) % PAY_METHODS.length];
  const region   = REGIONS[(index + statusOffset + customerOffset) % REGIONS.length];
  const customer = PREFIXES[(index + customerOffset) % PREFIXES.length] + ' ' + SUFFIXES[index % SUFFIXES.length];
  const policy   = `${policyPrefix}-${String(policyStart + index + 1).padStart(3, '0')}`;
  const bump     = status === 'Failed' ? 1800 : status === 'Pending' ? 950 : 0;
  const amount   = Math.round((amountBase + ((index * amountStep) % 7200) + bump) * 100) / 100;
  return payment(idBase + index + 1, customer, carrier, policy, amount, status, payMeth, dateStr, region);
}

function buildRows(
  base: Record<string, unknown>[], idBase: number, prefix: string, policyStart: number,
  dateStart: string, statusOff: number, amtBase: number, amtStep: number, custOff: number
): Record<string, unknown>[] {
  const rows = [...base];
  for (let i = rows.length; i < 50; i++) {
    rows.push(makeGeneratedRow(i, idBase, prefix, policyStart, dateStart, statusOff, amtBase, amtStep, custOff));
  }
  return rows;
}

// ── Dataset builders ──────────────────────────────────────────────────────────

function buildSepMockPayments(): DatasetInfo {
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < 100; i++) {
    const first  = SEP_FIRSTS[(i * 13 + 5)  % SEP_FIRSTS.length];
    const last   = SEP_LASTS [(i * 17 + 11) % SEP_LASTS.length];
    const domain = SEP_DOMAINS[(i * 7 + 3)  % SEP_DOMAINS.length];
    const status = SEP_STATUS_POOL[(i * 3 + 7) % SEP_STATUS_POOL.length];

    const refArr: string[] = [];
    for (let j = 0; j < 10; j++) {
      refArr.push(REF_CHARS.charAt(Math.abs(((i * 73 + j * 31 + 137) * 1664525 + 1013904223) | 0) % REF_CHARS.length));
    }
    const refNum = refArr.join('');

    const a = (i * 0xFDECBA9 + 0x10000000) & 0x7FFFFFFF;
    const b = (i * 0x9876 + 0x1234) & 0xFFFF;
    const c = (i * 0x0F37 + 0x100) & 0xFFF;
    const d = (i * 0xABCD + 0x200) & 0xFFF;
    const e = ((i * 0xFEDCBA987 + 0x100000000000)) & 0xFFFFFFFFFFFF;
    const transNum = `${a.toString(16).padStart(8,'0')}-${b.toString(16).padStart(4,'0')}-4${c.toString(16).padStart(3,'0')}-b${d.toString(16).padStart(3,'0')}-${e.toString(16).padStart(12,'0')}`;

    const amount  = Math.round((75 + ((i * 49.37 + (i % 7) * 137.5) % 4875)) * 100) / 100;
    const authCode = String(((i + 1) * 97 + 13) % 1000000).padStart(6, '0');
    const policy  = `POL-${String(100001 + i * 7).padStart(6, '0')}`;
    const date    = `202${4 + (i % 2)}-${String((i % 12) + 1).padStart(2,'0')}-${String((i % 28) + 1).padStart(2,'0')}`;

    let message: string;
    switch (status) {
      case 'APPROVED': message = `APPROVED ${authCode}`; break;
      case 'DECLINED': message = 'DECLINED - DO NOT HONOR'; break;
      case 'REFUNDED': message = `REFUNDED ${authCode}`; break;
      case 'VOIDED':   message = 'VOIDED - TRANSACTION CANCELLED'; break;
      default:         message = 'PENDING - AWAITING AUTHORIZATION';
    }

    rows.push({
      referenceNumber: refNum, billingName: `${first} ${last}`, insuredName: `${first} ${last}`,
      policyNumber: policy, amount, status, depositDate: date, authCode,
      email: `${first.toLowerCase()}.${last.toLowerCase()}@${domain}`, message, transNumber: transNum,
    });
  }
  return { id: 'sepDemo', label: 'SEP Transactions (Demo)', columns: sepTransactionColumns(), rows };
}

function buildAdjustments(): DatasetInfo {
  const base: Record<string, unknown>[] = [
    payment(2001,'Summit Benefit Advisors','Aetna', 'ADJ-101', 410.25,'Pending','ACH',        '2026-04-04','Midwest'),
    payment(2002,'Sandhill Coverage',      'Humana','ADJ-102', 980.00,'Paid',   'Wire',        '2026-04-09','South'),
    payment(2003,'Delta Group Health',     'Cigna', 'ADJ-103',1450.75,'Failed', 'Credit Card', '2026-04-11','Southeast'),
    payment(2004,'Monarch Employee Plans', 'United','ADJ-104', 520.00,'Paid',   'ACH',         '2026-04-14','West'),
    payment(2005,'Harborline Financial',   'Cigna', 'ADJ-105',2675.42,'Pending','Wire',        '2026-04-18','Northeast'),
    payment(2006,'Old Town Brokerage',     'Aetna', 'ADJ-106', 320.00,'Paid',   'ACH',         '2026-04-22','South'),
    payment(2007,'Apex Risk Network',      'United','ADJ-107',1780.14,'Failed', 'Credit Card', '2026-04-26','Midwest'),
    payment(2008,'Springfield Benefits',   'Humana','ADJ-108', 830.33,'Pending','ACH',         '2026-04-30','Southeast'),
  ];
  return { id: 'adjustments', label: 'Rebills & Adjustments', columns: paymentColumns(),
           rows: buildRows(base, 2000,'ADJ',100,'2026-05-02',1,340,291.8,3) };
}

function buildExceptions(): DatasetInfo {
  const base: Record<string, unknown>[] = [
    payment(3001,'Bridgeway Underwriters',  'United','EXC-201',6120.90,'Failed', 'Wire',        '2026-03-02','West'),
    payment(3002,'Pioneer Benefit Group',   'Aetna', 'EXC-202',1125.00,'Pending','ACH',         '2026-03-04','Northeast'),
    payment(3003,'Northgate Insurance',     'Cigna', 'EXC-203',2999.99,'Failed', 'Credit Card', '2026-03-08','South'),
    payment(3004,'Greenfield Associates',   'Humana','EXC-204', 455.85,'Pending','ACH',         '2026-03-13','East'),
    payment(3005,'Sterling Coverage Co',    'United','EXC-205', 718.70,'Paid',   'Wire',        '2026-03-16','Midwest'),
    payment(3006,'Palisade Benefits',       'Aetna', 'EXC-206',5200.13,'Failed', 'Credit Card', '2026-03-21','Southeast'),
    payment(3007,'Crescent Health Partners','Cigna', 'EXC-207',1340.00,'Pending','ACH',         '2026-03-25','West'),
    payment(3008,'Frontier Insurance Desk', 'Humana','EXC-208', 680.44,'Paid',   'ACH',         '2026-03-29','South'),
  ];
  return { id: 'exceptions', label: 'Exceptions Queue', columns: paymentColumns(),
           rows: buildRows(base, 3000,'EXC',200,'2026-04-01',2,980,524.6,6) };
}

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
    const month  = date.getMonth(); // 0-based
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
      case 'None':             discountPct = 0;  break;
      case 'BOGO':             discountPct = 50; break;
      case 'Bundle Deal':      discountPct = 15; break;
      case 'Seasonal':         discountPct = 25; break;
      default:                 discountPct = [10,15,20][pickIdx([40,35,25])];
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

// ── Module-level dataset cache (built once at server startup) ─────────────────

let _datasets: Map<string, DatasetInfo> | null = null;

export async function getAllDatasets(): Promise<Map<string, DatasetInfo>> {
  if (_datasets) return _datasets;

  const map = new Map<string, DatasetInfo>();

  // payments: try live SEP API first, fall back to mock
  try {
    const apiRows = await fetchSepTransactions('2020-01-01T00:00:00Z', '2030-12-31T23:59:59Z');
    if (apiRows.length > 0) {
      map.set('payments', { id: 'payments', label: 'SEP Transactions', columns: sepTransactionColumns(), rows: apiRows });
    } else {
      map.set('payments', buildSepMockPayments());
    }
  } catch {
    map.set('payments', buildSepMockPayments());
  }

  map.set('sepDemo',     buildSepMockPayments());
  map.set('adjustments', buildAdjustments());
  map.set('exceptions',  buildExceptions());
  map.set('candy',       buildCandy());

  _datasets = map;
  return map;
}

export async function getDataset(id: string): Promise<DatasetInfo> {
  const map = await getAllDatasets();
  return map.get(id) ?? map.values().next().value!;
}
