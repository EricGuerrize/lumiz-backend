import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  try {
    const { email, token } = await req.json()

    if (!email || !token) {
      return new Response(
        JSON.stringify({ valid: false, message: 'Email e token são obrigatórios' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Buscar token
    const { data, error } = await supabase
      .from('setup_tokens')
      .select('*')
      .eq('email', email)
      .eq('token', token)
      .eq('usado', false)
      .gt('expira_em', new Date().toISOString())
      .single()

    if (error || !data) {
      return new Response(
        JSON.stringify({ valid: false, message: 'Token inválido ou expirado' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Marcar como usado
    await supabase
      .from('setup_tokens')
      .update({ usado: true })
      .eq('id', data.id)

    return new Response(
      JSON.stringify({ valid: true }),
      { headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Erro:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})

