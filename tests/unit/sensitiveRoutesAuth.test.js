const fs = require('fs');
const path = require('path');

describe('Sensitive route authentication contract', () => {
  test('dashboard e admin exigem authenticateToken, nao authenticateFlexible', () => {
    const dashboard = fs.readFileSync(path.join(__dirname, '../../src/routes/dashboard.routes.js'), 'utf8');
    const admin = fs.readFileSync(path.join(__dirname, '../../src/routes/admin.routes.js'), 'utf8');

    expect(dashboard).toContain('authenticateToken');
    expect(dashboard).toContain('router.use(authenticateToken)');
    expect(dashboard).not.toContain('router.use(authenticateFlexible)');

    expect(admin).toContain('authenticateToken');
    expect(admin).toContain('router.use(authenticateToken)');
    expect(admin).not.toContain('router.use(authenticateFlexible)');
  });
});
