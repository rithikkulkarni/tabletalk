/**
 * Port of SepApiService.java — REST client for Simply Easier Payments API.
 * Falls back to empty list on any error so the app always starts.
 */

const SEP_API_SECRET_KEY  = process.env.SEP_API_SECRET_KEY ?? '';
const SEP_API_ENDPOINT    = process.env.SEP_API_TEST_ENDPOINT
  ?? 'https://test.simply-easier-payments.com/PaymentApp/restSrv';

export function isSepConfigured(): boolean {
  return SEP_API_SECRET_KEY.trim().length > 0;
}

function mapItem(item: Record<string, unknown>): Record<string, unknown> {
  const customData = (item.customData as Record<string, unknown>) ?? {};
  return {
    referenceNumber: item.referenceNumber ?? '',
    billingName:     item.billingName ?? '',
    insuredName:     customData.insuredName ?? '',
    policyNumber:    customData.policyNumber ?? item.policyNumber ?? '',
    amount:          parseFloat(String(item.amount ?? '0')),
    status:          item.resultCode === '0' ? 'APPROVED' : item.resultCode === '1' ? 'DECLINED' : String(item.resultCode ?? 'UNKNOWN'),
    depositDate:     item.depositDate ?? '',
    authCode:        item.authCode ?? '',
    email:           item.billingEmail ?? '',
    message:         item.message ?? '',
    transNumber:     item.transNumber ?? '',
  };
}

export async function fetchSepTransactions(
  fromTime: string,
  toTime: string
): Promise<Record<string, unknown>[]> {
  if (!isSepConfigured()) return [];
  try {
    const credentials = Buffer.from(`${SEP_API_SECRET_KEY}:`).toString('base64');
    const res = await fetch(`${SEP_API_ENDPOINT}/v1/PaymentSrv/getTransactionList`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${credentials}`,
      },
      body: JSON.stringify({ fromTime, toTime }),
    });
    if (!res.ok) return [];
    const json = await res.json() as Record<string, unknown>;
    const listResult = json.listResult as Record<string, unknown> | undefined;
    const items = listResult?.items;
    if (!Array.isArray(items)) return [];
    return (items as Record<string, unknown>[]).map(mapItem);
  } catch {
    return [];
  }
}
