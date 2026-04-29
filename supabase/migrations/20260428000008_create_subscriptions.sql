CREATE TABLE IF NOT EXISTS subscriptions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id           UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status              VARCHAR(20) DEFAULT 'trial'
                      CHECK (status IN ('trial', 'paid', 'expired', 'cancelled')),
  trial_starts_at     TIMESTAMPTZ DEFAULT NOW(),
  trial_ends_at       TIMESTAMPTZ NOT NULL,
  plan_expires_at     TIMESTAMPTZ,
  asaas_customer_id   VARCHAR(100),
  last_payment_id     VARCHAR(100),
  payment_url         TEXT,
  reminder_7d_sent_at TIMESTAMPTZ,
  reminder_2d_sent_at TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(clinic_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_clinic_id    ON subscriptions(clinic_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status       ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_trial_ends   ON subscriptions(trial_ends_at);
