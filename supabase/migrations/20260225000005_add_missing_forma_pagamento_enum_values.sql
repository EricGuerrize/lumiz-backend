ALTER TYPE forma_pagamento ADD VALUE IF NOT EXISTS 'pix';
ALTER TYPE forma_pagamento ADD VALUE IF NOT EXISTS 'debito';
ALTER TYPE forma_pagamento ADD VALUE IF NOT EXISTS 'credito_avista';
ALTER TYPE forma_pagamento ADD VALUE IF NOT EXISTS 'dinheiro';
ALTER TYPE forma_pagamento ADD VALUE IF NOT EXISTS 'misto';
