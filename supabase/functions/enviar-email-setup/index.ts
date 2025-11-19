import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

serve(async (req) => {
  try {
    const { email, nome } = await req.json()

    if (!email) {
      return new Response(
        JSON.stringify({ error: 'Email é obrigatório' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Criar cliente Supabase
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // Gerar token único
    const token = crypto.randomUUID()
    const expiraEm = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 horas

    // Salvar token no banco
    const { error: tokenError } = await supabase
      .from('setup_tokens')
      .insert({
        email,
        token,
        expira_em: expiraEm.toISOString()
      })

    if (tokenError) {
      console.error('Erro ao salvar token:', tokenError)
      throw tokenError
    }

    // Gerar link de setup
    const setupLink = `https://lumiz-financeiro.vercel.app/setup-account?email=${encodeURIComponent(email)}&token=${token}`

    // Enviar email via Resend
    const emailHTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f3f4f6;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" style="width: 600px; max-width: 100%; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          
          <!-- Logo e Header -->
          <tr>
            <td align="center" style="padding: 40px 20px 20px 20px;">
              <div style="width: 80px; height: 80px; background: linear-gradient(135deg, #8b5cf6, #ec4899); border-radius: 16px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 20px;">
                <span style="color: white; font-size: 48px; font-weight: bold;">L</span>
              </div>
              <h1 style="color: #1f2937; margin: 0; font-size: 28px;">Bem-vindo ao Lumiz!</h1>
            </td>
          </tr>

          <!-- Conteúdo -->
          <tr>
            <td style="padding: 0 40px 30px 40px;">
              <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                <p style="color: #374151; margin: 0 0 15px 0; font-size: 16px;">Olá${nome ? ` ${nome}` : ''},</p>
                <p style="color: #374151; margin: 0 0 15px 0; font-size: 16px;">
                  Sua conta no <strong>Lumiz Financeiro</strong> foi criada com sucesso! 🎉
                </p>
                <p style="color: #374151; margin: 0; font-size: 16px;">
                  Para começar a usar o sistema, você precisa criar sua senha. Clique no botão abaixo:
                </p>
              </div>

              <!-- Botão CTA -->
              <table role="presentation" style="margin: 30px 0; width: 100%;">
                <tr>
                  <td align="center">
                    <a href="${setupLink}" 
                       style="display: inline-block; background: linear-gradient(135deg, #8b5cf6, #ec4899); color: white; text-decoration: none; padding: 16px 40px; border-radius: 8px; font-weight: bold; font-size: 16px;">
                      🔐 Criar Minha Senha
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Alerta -->
              <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; border-radius: 4px; margin: 20px 0;">
                <p style="color: #78350f; margin: 0; font-size: 14px;">
                  <strong>⏰ Importante:</strong> Este link é válido por 24 horas. Após esse período, você precisará solicitar um novo link.
                </p>
              </div>

              <!-- Link alternativo -->
              <p style="color: #6b7280; font-size: 14px; margin: 20px 0 0 0;">
                Caso o botão não funcione, copie e cole este link no seu navegador:
              </p>
              <p style="color: #8b5cf6; font-size: 12px; word-break: break-all; background: #f3f4f6; padding: 10px; border-radius: 4px;">
                ${setupLink}
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 40px; border-top: 1px solid #e5e7eb;">
              <p style="color: #6b7280; font-size: 14px; margin: 0 0 10px 0;">
                Se você não solicitou esta conta, pode ignorar este email com segurança.
              </p>
              <p style="color: #9ca3af; font-size: 12px; margin: 0;">
                © 2024 Lumiz Financeiro - Sistema de Gestão para Clínicas
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: 'Lumiz Financeiro <noreply@lumiz.com>',
        to: [email],
        subject: '🎉 Bem-vindo ao Lumiz! Configure sua conta',
        html: emailHTML
      })
    })

    if (!res.ok) {
      const error = await res.text()
      throw new Error(`Resend API error: ${error}`)
    }

    return new Response(
      JSON.stringify({ success: true, setupLink }),
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

