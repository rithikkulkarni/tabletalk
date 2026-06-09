import { NextResponse } from 'next/server';
import { getAllDatasets, getDataset } from '@/lib/datasets';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (id) {
    const ds = getDataset(id);
    return NextResponse.json(ds);
  }

  const map = getAllDatasets();
  const list = Array.from(map.values()).map(d => ({
    id: d.id,
    label: d.label,
    columns: d.columns,
    rows: d.rows,
  }));
  return NextResponse.json(list);
}
