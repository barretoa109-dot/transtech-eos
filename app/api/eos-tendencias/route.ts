import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  const { data, error } = await supabase
    .from('eos_tendencias')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10)

  return NextResponse.json({ data, error })
}