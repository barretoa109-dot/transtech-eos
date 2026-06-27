import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  const { data, error } = await supabase
    .from('recomendaciones')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5)

  return NextResponse.json({ data, error })
}