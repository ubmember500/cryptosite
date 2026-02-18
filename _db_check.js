require('dotenv').config({ path: './server/.env' });
const prisma = require('./server/src/utils/prisma');
prisma.alert.findMany({
  where: { alertType: 'complex' },
  select: { id: true, isActive: true, triggered: true, alertType: true, conditions: true, symbols: true, market: true }
}).then(alerts => {
  for (const x of alerts) {
    const syms = JSON.parse(x.symbols || '[]');
    console.log('ID:', x.id.slice(0,8), 'active:', x.isActive, 'triggered:', x.triggered, 'market:', x.market);
    console.log('  conditions:', x.conditions);
    console.log('  symbols count:', syms.length, 'first 3:', syms.slice(0,3));
  }
  if (alerts.length === 0) console.log('No complex alerts found in DB');
}).catch(e => console.error(e.message)).finally(() => prisma.$disconnect());
